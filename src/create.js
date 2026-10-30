// 크리에이트: 로그인한 사용자가 강의(영상)·디지털 상품을 만들어 가격을 정하고 게시한다.
//  - 영상·자료는 서버를 거치지 않고 저장소로 직접 올린다 (storage.js). 브라우저 쪽은 public/create.js
//  - 가격: 무료 / 1회 결제 / 월 구독. 실제 결제·수강 연결은 PG 연동 후 붙는다 (공개 페이지의 구매 버튼은 "준비 중")
import { Router } from 'express';
import express from 'express';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { db, now, feePct } from './db.js';
import { requireUser, limitHits } from './auth.js';
import { h } from './render.js';
import { won } from './plan-data.js';
import { isOwnImageUrl, createMediaUpload, signedMediaUrl, MEDIA_DIR } from './storage.js';

export const creator = Router();
creator.use('/create', requireUser);

const KINDS = { course: '강의', product: '디지털 상품' };
const PRICINGS = ['free', 'once', 'monthly'];
const MIN_PRICE = 1000, MAX_PRICE = 10_000_000;
const GB = 1024 ** 3, MB = 1024 ** 2;
// 확장자 → [종류, MIME, 최대 크기]
const FILE_TYPES = {
  mp4: ['video', 'video/mp4', 2 * GB], webm: ['video', 'video/webm', 2 * GB], mov: ['video', 'video/quicktime', 2 * GB],
  pdf: ['file', 'application/pdf', 300 * MB], zip: ['file', 'application/zip', 300 * MB], xlsx: ['file', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 300 * MB],
  pptx: ['file', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 300 * MB], docx: ['file', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 300 * MB],
  txt: ['file', 'text/plain', 300 * MB], png: ['file', 'image/png', 300 * MB], jpg: ['file', 'image/jpeg', 300 * MB],
};
const extOf = (n) => String(n || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] || '';
const storedName = (uid) => new RegExp(`^${uid}-[0-9a-f]{24}\\.[a-z0-9]{1,5}$`);

const priceLabel = (c, t = (s) => s) => (c.pricing === 'free' || !c.price ? t('무료') : c.pricing === 'monthly' ? `${won(c.price)} / ${t('월')}` : `${won(c.price)} · ${t('1회 결제')}`);

// ---------- 업로드 ----------
// 1) 브라우저가 파일 정보를 보내 업로드 주소를 받는다
creator.post('/create/upload-url', express.json({ limit: '10kb' }), async (req, res) => {
  const ext = extOf(req.body?.filename), spec = FILE_TYPES[ext], size = Number(req.body?.size);
  if (!spec) return res.status(400).json({ error: `지원하지 않는 형식입니다. (${Object.keys(FILE_TYPES).join(', ')})` });
  if (!(size > 0) || size > spec[2]) return res.status(400).json({ error: `파일은 ${spec[2] >= GB ? spec[2] / GB + 'GB' : spec[2] / MB + 'MB'} 이하여야 합니다.` });
  if (await limitHits('upload:' + req.user.id, 3600e3, 80)) return res.status(429).json({ error: '업로드가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
  const name = `${req.user.id}-${randomBytes(12).toString('hex')}.${ext}`;
  try { res.json({ name, kind: spec[0], ...(await createMediaUpload(name, spec[1])) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) 로컬 개발 전용: 저장소 설정이 없을 때 파일을 data/media 에 바로 저장
creator.put('/create/upload/:name', async (req, res) => {
  const ext = extOf(req.params.name), spec = FILE_TYPES[ext];
  if (process.env.VERCEL || !spec || !storedName(req.user.id).test(req.params.name)) return res.status(400).json({ error: '잘못된 요청입니다.' });
  const file = path.join(MEDIA_DIR, req.params.name);
  let bytes = 0;
  const cap = async function* (src) { for await (const chunk of src) { bytes += chunk.length; if (bytes > spec[2]) throw new Error('too large'); yield chunk; } };
  try { await pipeline(req, cap, createWriteStream(file)); res.json({ ok: true }); }
  catch { await unlink(file).catch(() => {}); res.status(400).json({ error: '업로드에 실패했습니다.' }); }
});

// ---------- 목록 ----------
creator.get('/create', async (req, res) => {
  const list = await db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM course_items i WHERE i.course_id=c.id) AS n FROM courses c WHERE owner_id=? ORDER BY id DESC`).all(req.user.id);
  const t = req.t;
  const card = (c) => `<a class="card ccard" href="/create/${c.id}">
<div class="cthumb"${c.thumbnail ? ` style="background-image:url('${h(c.thumbnail)}')"` : ''}>${c.thumbnail ? '' : '<span>▶</span>'}</div>
<div class="cbody"><span class="badge ${c.status === 'published' ? 'active' : ''}">${c.status === 'published' ? t('판매 중') : t('작성 중')} · ${t(KINDS[c.kind] || '강의')}</span>
<b>${h(c.title) || `<span class="mute">${t('제목 없음')}</span>`}</b><span class="mute">${priceLabel(c, t)} · ${t('콘텐츠')} ${c.n}</span></div></a>`;
  res.page(t('크리에이트'), `${CSS}
<div class="row"><div class="grow"><h1>${t('크리에이트')}</h1><p class="mute" style="margin:0">${t('강의와 디지털 상품을 직접 만들고 가격을 정해 판매하세요.')}</p></div></div>
<form method="post" action="/create/new" class="kindpick">
${Object.entries(KINDS).map(([k, label]) => `<button name="kind" value="${k}" class="card kbtn"><span class="kico">${k === 'course' ? '🎬' : '📦'}</span><b>${t(label)} ${t('만들기')}</b>
<span class="mute">${k === 'course' ? t('영상을 올려 강의를 구성하세요') : t('템플릿·전자책·자료 파일을 판매하세요')}</span></button>`).join('')}
</form>
${list.length ? `<h2>${t('내 콘텐츠')}</h2><div class="grid">${list.map(card).join('')}</div>` : ''}`, { wide: true, active: 'create', msg: req.query.m });
});

creator.post('/create/new', async (req, res) => {
  const kind = KINDS[req.body.kind] ? req.body.kind : 'course';
  const id = Number((await db.prepare('INSERT INTO courses(owner_id,kind,pricing,price,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(req.user.id, kind, 'once', 0, now(), now())).lastInsertRowid);
  res.redirect(`/create/${id}`);
});

creator.param('cid', async (req, res, next, id) => {
  req.course = await db.prepare('SELECT * FROM courses WHERE id=? AND owner_id=?').get(id, req.user.id);
  if (!req.course) return res.status(404).page('없음', '<p>콘텐츠를 찾을 수 없습니다. <a href="/create">크리에이트</a></p>');
  next();
});

// ---------- 편집 화면 ----------
creator.get('/create/:cid', async (req, res) => {
  const c = req.course, t = req.t;
  const items = await db.prepare('SELECT id,title,kind,file,file_name,size FROM course_items WHERE course_id=? ORDER BY pos,id').all(c.id);
  const data = { id: c.id, kind: c.kind, title: c.title, summary: c.summary, description: c.description, thumbnail: c.thumbnail, pricing: c.pricing, price: c.price, status: c.status, items, fee: feePct(),
    limits: { min: MIN_PRICE, max: MAX_PRICE }, types: Object.fromEntries(Object.entries(FILE_TYPES).map(([e, v]) => [e, v[0]])) };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  res.page(c.title || t('새 콘텐츠'), `${CSS}
<p class="mute"><a href="/create">← ${t('크리에이트')}</a></p>
<div class="cedit">
<div class="cmain">
<div class="card">
  <h3>${t('기본 정보')}</h3>
  <label>${t('유형')}</label>
  <div class="seg" id="kindSeg">${Object.entries(KINDS).map(([k, l]) => `<button type="button" data-k="${k}">${t(l)}</button>`).join('')}</div>
  <label for="title">${t('제목')}</label><input id="title" maxlength="80" placeholder="${t('예) 하루 30분, 영상 편집 입문')}">
  <label for="summary">${t('한 줄 소개')}</label><input id="summary" maxlength="140" placeholder="${t('목록과 공유 카드에 표시됩니다')}">
  <label>${t('썸네일')}</label>
  <label class="dropzone cthumbdrop" id="thumbDrop"><input type="file" id="thumbFile" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
    <div class="cthumb big" id="thumbPrev"><span>${t('이미지를 끌어다 놓거나 클릭해서 선택')}</span></div></label>
  <label for="description">${t('상세 설명')}</label><textarea id="description" rows="8" maxlength="5000" placeholder="${t('어떤 내용을 배울 수 있는지, 누구에게 필요한지 자유롭게 적어 주세요')}"></textarea>
</div>

<div class="card">
  <div class="row"><h3 class="grow" style="margin:0" id="itemsTitle"></h3><span class="mute" id="itemsSum"></span></div>
  <div id="items"></div>
  <label class="dropzone" id="drop"><input type="file" id="fileInput" multiple hidden>
    <b id="dropMain"></b><br><span class="mute" id="dropSub"></span></label>
</div>

<div class="card">
  <h3>${t('가격 설정')}</h3>
  <div class="paygrid" id="payGrid">
    <button type="button" class="paybtn" data-p="free"><b>${t('무료')}</b><span>${t('누구나 무료로 제공')}</span></button>
    <button type="button" class="paybtn" data-p="once"><b>${t('1회 결제')}</b><span>${t('한 번 결제하면 계속 이용')}</span></button>
    <button type="button" class="paybtn" data-p="monthly"><b>${t('월 구독')}</b><span>${t('매월 자동 결제, 구독 중에만 이용')}</span></button>
  </div>
  <div id="priceBox">
    <label for="price" id="priceLabel"></label>
    <div class="pricein"><span>₩</span><input id="price" inputmode="numeric" placeholder="29,000" autocomplete="off"><em id="priceUnit"></em></div>
    <div class="chips" id="quick" style="margin-top:10px"></div>
    <p class="mute" id="payout"></p>
  </div>
</div>
</div>

<aside class="cside"><div class="card cstick">
  <span class="badge" id="stBadge"></span>
  <div class="cpreview"><div class="cthumb" id="sideThumb"></div><b id="sideTitle"></b><span class="mute" id="sidePrice"></span></div>
  <ul class="check" id="checks"></ul>
  <p class="msg" id="err" hidden></p>
  <button class="primary" id="publish" type="button" style="width:100%"></button>
  <p style="margin:10px 0 0;display:flex;gap:8px"><button type="button" id="save" style="flex:1">${t('저장')}</button><a class="btn" id="viewLink" href="/c/${c.id}" target="_blank" style="flex:1;text-align:center">${t('미리보기')} ↗</a></p>
  <p style="margin:8px 0 0"><button type="button" id="unpublish" class="sm" hidden>${t('판매 중지(작성 중으로 전환)')}</button></p>
  <p class="mute" id="saveState" style="margin:10px 0 0"></p>
  <form method="post" action="/create/${c.id}/delete" onsubmit="return confirm('${t('삭제하면 되돌릴 수 없습니다. 삭제할까요?')}')" style="margin:14px 0 0"><button class="danger sm">${t('삭제')}</button></form>
</div></aside>
</div>
<script type="application/json" id="cdata">${json}</script>
<script src="/static/create.js?v=1"></script>`, { wide: true, active: 'create' });
});

// ---------- 저장 · 게시 ----------
creator.post('/create/:cid/save', express.json({ limit: '300kb' }), async (req, res) => {
  const c = req.course, b = req.body || {}, uid = req.user.id;
  const fail = (m) => res.status(400).json({ error: m });
  const str = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
  const kind = KINDS[b.kind] ? b.kind : c.kind;
  const pricing = PRICINGS.includes(b.pricing) ? b.pricing : 'once';
  const price = pricing === 'free' ? 0 : Math.round(Number(b.price) || 0);
  const thumbnail = b.thumbnail && isOwnImageUrl(b.thumbnail) ? String(b.thumbnail) : '';
  const nameRe = storedName(uid);
  const rows = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((i) => {
    const file = nameRe.test(String(i.file || '')) ? String(i.file) : '';
    return { title: str(i.title, 100), file, file_name: str(i.file_name, 200), kind: file ? FILE_TYPES[extOf(file)]?.[0] || 'file' : 'video', size: file ? Math.max(0, Math.round(Number(i.size) || 0)) : 0 };
  });
  const title = str(b.title, 80);
  const publish = b.status === 'published';
  if (pricing !== 'free' && price && (price < MIN_PRICE || price > MAX_PRICE)) return fail(`가격은 ${won(MIN_PRICE)} ~ ${won(MAX_PRICE)} 사이여야 합니다.`);
  if (publish) {
    if (!title) return fail('제목을 입력해 주세요.');
    if (!rows.length || rows.some((r) => !r.file)) return fail(rows.length ? '업로드가 끝나지 않은 콘텐츠가 있습니다.' : '영상이나 파일을 하나 이상 올려 주세요.');
    if (pricing !== 'free' && !price) return fail('가격을 입력해 주세요.');
  }
  await db.prepare('UPDATE courses SET kind=?,title=?,summary=?,description=?,thumbnail=?,pricing=?,price=?,status=?,updated_at=? WHERE id=?')
    .run(kind, title, str(b.summary, 140), str(b.description, 5000), thumbnail, pricing, price, publish ? 'published' : 'draft', now(), c.id);
  await db.prepare('DELETE FROM course_items WHERE course_id=?').run(c.id);
  for (const [pos, r] of rows.entries()) await db.prepare('INSERT INTO course_items(course_id,pos,title,kind,file,file_name,size) VALUES(?,?,?,?,?,?,?)').run(c.id, pos, r.title, r.kind, r.file, r.file_name, r.size);
  const items = await db.prepare('SELECT id,title,kind,file,file_name,size FROM course_items WHERE course_id=? ORDER BY pos,id').all(c.id);
  res.json({ ok: true, status: publish ? 'published' : 'draft', price, items });
});

creator.post('/create/:cid/delete', async (req, res) => {
  await db.prepare('DELETE FROM courses WHERE id=?').run(req.course.id);
  res.redirect('/create?m=' + encodeURIComponent(req.t('삭제했습니다.')));
});

// ---------- 소유자 미리보기: 올린 영상·파일 열기 ----------
creator.get('/create/:cid/media/:iid', async (req, res) => {
  const it = await db.prepare('SELECT * FROM course_items WHERE id=? AND course_id=?').get(req.params.iid, req.course.id);
  if (!it?.file) return res.status(404).send('not found');
  const url = await signedMediaUrl(it.file);
  if (url) return res.redirect(url);
  const file = path.resolve(MEDIA_DIR, it.file);
  if (!existsSync(file) || !statSync(file).isFile()) return res.status(404).send('not found');
  res.type(FILE_TYPES[extOf(it.file)]?.[1] || 'application/octet-stream').sendFile(file); // Range 지원 → 영상 탐색 가능
});

// ---------- 공개 상품 페이지 ----------
creator.get('/c/:id', async (req, res) => {
  const c = await db.prepare('SELECT c.*, u.name AS author, u.email AS author_email FROM courses c JOIN users u ON u.id=c.owner_id WHERE c.id=?').get(req.params.id);
  const mine = !!c && req.user?.id === c.owner_id, t = req.t;
  if (!c || (c.status !== 'published' && !mine)) return res.status(404).page(t('찾을 수 없음'), `<h1>${t('페이지를 찾을 수 없습니다')}</h1><p><a href="/">${t('홈으로')}</a></p>`);
  const items = await db.prepare('SELECT title,kind,file_name,size FROM course_items WHERE course_id=? ORDER BY pos,id').all(c.id);
  const mb = (n) => (n >= GB ? (n / GB).toFixed(1) + ' GB' : Math.max(1, Math.round(n / MB)) + ' MB');
  const author = c.author || c.author_email.split('@')[0];
  res.page(c.title || t('제목 없음'), `${CSS}
${mine && c.status !== 'published' ? `<div class="msg">${t('아직 게시되지 않은 미리보기입니다. 나만 볼 수 있어요.')} <a href="/create/${c.id}">${t('편집')}</a></div>` : ''}
<div class="cpub">
<div class="cpubmain">
<div class="cthumb big"${c.thumbnail ? ` style="background-image:url('${h(c.thumbnail)}')"` : ''}>${c.thumbnail ? '' : '<span>▶</span>'}</div>
<span class="badge active" style="margin-top:18px;display:inline-block">${t(KINDS[c.kind] || '강의')}</span>
<h1 style="margin-top:6px">${h(c.title) || t('제목 없음')}</h1>
${c.summary ? `<p class="mute" style="font-size:16px">${h(c.summary)}</p>` : ''}<p class="mute">${t('크리에이터')} · ${h(author)}</p>
${c.description ? `<h2>${t('소개')}</h2><div style="white-space:pre-wrap">${h(c.description)}</div>` : ''}
<h2>${c.kind === 'course' ? t('커리큘럼') : t('포함된 자료')} · ${items.length}</h2>
<div class="curri">${items.map((i, n) => `<div class="citem"><span class="cn">${n + 1}</span><span class="grow">${h(i.title || i.file_name) || '—'}</span><span class="mute">${i.kind === 'video' ? '🎬' : '📄'} ${i.size ? mb(i.size) : ''}</span></div>`).join('')}</div>
</div>
<aside class="cside"><div class="card cstick"><div class="cprice">${priceLabel(c, t)}</div>
<p class="mute" style="margin:2px 0 16px">${c.pricing === 'monthly' ? t('매월 자동 결제 · 언제든 해지') : c.pricing === 'once' ? t('한 번 결제로 계속 이용') : t('누구나 무료로 이용')}</p>
<button class="primary" disabled style="width:100%">${t('결제 준비 중')}</button>
<p class="mute" style="margin:10px 0 0;font-size:12.5px">${t('결제일로부터 7일 이내 환불 가능')} · <a href="/refund">${t('환불 정책')}</a></p></div></aside>
</div>`, { wide: true });
});

const CSS = `<style>
.kindpick{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:22px 0 8px}
.kbtn{text-align:left;display:flex;flex-direction:column;gap:4px;border-radius:16px;padding:22px;font-size:16px;margin:0;cursor:pointer}
.kbtn:hover{border-color:var(--blue);box-shadow:0 18px 36px -24px var(--blue)}.kico{font-size:26px}
.cthumb{aspect-ratio:16/9;background:var(--soft) center/cover no-repeat;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--mute);font-size:22px}
.cthumb.big{width:100%}.cthumb span{font-size:13.5px;padding:0 12px;text-align:center}
.ccard{display:flex!important;flex-direction:column;gap:12px;padding:14px!important}.cbody{display:flex;flex-direction:column;gap:2px;padding:0 6px 6px}
.cedit,.cpub{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px;align-items:start}
.cstick{position:sticky;top:76px;margin:0}.cmain .card h3{margin:0 0 4px;font-size:17px}.cmain .card{padding:26px}
.cpreview{display:flex;flex-direction:column;gap:6px;margin:14px 0}.cpreview b{font-size:15px}
.cthumbdrop{padding:10px}.cthumbdrop .cthumb{border-radius:8px}
.citem,.curri .citem{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--line)}.citem .cn{color:var(--mute);width:22px;font-size:13px}
.iedit{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0 0 10px;background:var(--card)}
.iedit .cn{color:var(--mute);width:20px;text-align:center;font-size:13px;flex:0 0 20px}
.iedit .imain{flex:1;min-width:0}.iedit input{border:0;background:transparent;padding:2px 4px;font-weight:600}
.iedit input:focus{background:var(--soft);box-shadow:none;border:0}
.iedit .meta{font-size:12.5px;color:var(--mute);padding:0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.iedit .meta.bad{color:var(--bad)}.iedit .meta a{color:var(--blue)}
.bar{height:5px;background:var(--soft);border-radius:3px;overflow:hidden;margin:6px 4px 2px;flex-basis:100%}.bar i{display:block;height:100%;width:0;background:var(--blue);transition:width .2s}
.iedit .ibtn{border:0;background:none;color:var(--mute);padding:4px 7px;border-radius:6px}.iedit .ibtn:hover{background:var(--soft);color:var(--ink)}
.dropzone b{font-size:15px;color:var(--ink)}
.paygrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}
.paybtn{border-radius:14px;padding:14px;text-align:left;display:flex;flex-direction:column;gap:3px;border:1.5px solid var(--line)}
.paybtn span{font-size:12.5px;color:var(--mute);line-height:1.45}.paybtn.on{border-color:var(--blue);background:var(--blue-soft)}
.pricein{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:0 14px;background:var(--card);max-width:320px}
.pricein:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}
.pricein input{border:0;box-shadow:none!important;padding:10px 0;font-size:20px;font-weight:700;letter-spacing:-.02em}.pricein span,.pricein em{color:var(--mute);font-style:normal;white-space:nowrap}
.cprice{font-size:30px;font-weight:800;letter-spacing:-.04em}
.curri{margin-top:6px}.check li a{text-decoration:none}
@media(max-width:860px){.cedit,.cpub{grid-template-columns:1fr}.cstick{position:static}.cside{order:-1}.cedit .cside{order:2}.paygrid{grid-template-columns:1fr}}
</style>`;
