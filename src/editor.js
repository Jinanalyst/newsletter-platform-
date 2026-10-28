// 글 작성 도구: 블록 에디터 · 자동 저장 · 버전 기록 · 템플릿 · 미리보기 · 예약 · 분류 · 외부 글 가져오기
import { Router } from 'express';
import express from 'express';
import { db, now, cleanTags } from './db.js';
import { requireUser, cooldown } from './auth.js';
import { renderPost, h } from './render.js';
import { recipientsFor, sendPost, sendTest } from './send.js';
import { smtpConfigured } from './mail.js';
import { fetchSafe, parseFeed, htmlToMd } from './importer.js';
import { fmt } from './views.js';
import { addStarterTemplates } from './seed.js';

export const ed = Router();
ed.use('/app', requireUser);

const back = (res, path, m) => res.redirect(m ? path + (path.includes('?') ? '&' : '?') + 'm=' + encodeURIComponent(m) : path);
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

ed.param('nid', async (req, res, next, id) => {
  req.nl = await db.prepare('SELECT * FROM newsletters WHERE id=? AND owner_id=?').get(id, req.user.id);
  if (!req.nl) return res.status(404).page('없음', '<p>뉴스레터를 찾을 수 없습니다. <a href="/app">내 뉴스레터</a></p>');
  next();
});

const getPost = async (req) => await db.prepare("SELECT * FROM posts WHERE id=? AND newsletter_id=? AND kind='post'").get(req.params.id, req.nl.id);
const categoriesOf = (nl) => nl.categories.split(',').map((s) => s.trim()).filter(Boolean);
const cleanCategory = (nl, v) => (categoriesOf(nl).includes(String(v || '')) ? String(v) : '');

// datetime-local 값('2026-11-01T09:00')을 브라우저의 시간대(tz = getTimezoneOffset 분)로 해석해 UTC ISO로 변환.
// 서버 시간대와 무관하게 "내가 고른 시각"에 발송되도록 한다.
function parseLocal(value, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(String(value || ''));
  if (!m) return null;
  const off = Number.isFinite(Number(tz)) ? Number(tz) : 0;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + off * 60_000);
  return isNaN(d) ? null : d.toISOString();
}

// ---------- 버전 기록 ----------
const same = (a, b) => a && a.subject === b.subject && a.preview === b.preview && a.body_md === b.body_md;
async function snapshot(postId, c, reason, force = false) {
  const last = await db.prepare('SELECT * FROM post_versions WHERE post_id=? ORDER BY id DESC LIMIT 1').get(postId);
  if (same(last, c)) return false;
  if (!force && reason === 'auto' && last && Date.now() - new Date(last.created_at).getTime() < 120_000) return false; // 자동 저장은 2분에 한 번만 기록
  await db.prepare('INSERT INTO post_versions(post_id,subject,preview,body_md,reason,created_at) VALUES(?,?,?,?,?,?)').run(postId, c.subject, c.preview, c.body_md, reason, now());
  await db.prepare('DELETE FROM post_versions WHERE post_id=? AND id NOT IN (SELECT id FROM post_versions WHERE post_id=? ORDER BY id DESC LIMIT 50)').run(postId, postId);
  return true;
}
const hasVersions = async (postId) => !!await db.prepare('SELECT 1 FROM post_versions WHERE post_id=? LIMIT 1').get(postId);

function content(b) {
  return { subject: String(b.subject || '').trim().slice(0, 200), preview: String(b.preview || '').slice(0, 300), body_md: String(b.body_md || '').slice(0, 500_000) };
}

// 변경 전 내용을 기록해 두고(처음 저장 시) 새 내용으로 갱신
async function applyContent(p, nl, b) {
  const c = content(b);
  if (!await hasVersions(p.id) && (p.subject || p.body_md)) await snapshot(p.id, { subject: p.subject, preview: p.preview, body_md: p.body_md }, 'initial', true);
  const t = now();
  await db.prepare('UPDATE posts SET subject=?, preview=?, body_md=?, category=?, tags=?, audience=?, updated_at=? WHERE id=?')
    .run(c.subject, c.preview, c.body_md, cleanCategory(nl, b.category), cleanTags(b.tags), ['paid', 'free'].includes(b.audience) ? b.audience : 'all', t, p.id);
  return { c, t };
}

// ================= 글 목록 · 새 글 =================
ed.get('/app/n/:nid/posts', async (req, res) => {
  const nl = req.nl;
  const { c = '', tag = '' } = req.query;
  let rows = await db.prepare("SELECT * FROM posts WHERE newsletter_id=? AND kind='post' ORDER BY id DESC").all(nl.id);
  if (c) rows = rows.filter((p) => p.category === c);
  if (tag) rows = rows.filter((p) => p.tags.split(',').includes(tag));
  const tpls = await db.prepare('SELECT id,name FROM templates WHERE newsletter_id=? ORDER BY id').all(nl.id);
  const cats = categoriesOf(nl);
  res.page('글', `<div class="row"><h1 class="grow">글</h1><a class="btn" href="/app/n/${nl.id}/import">가져오기</a>
<form method="post" action="/app/n/${nl.id}/posts/new" class="row">${tpls.length ? `<select name="template_id" style="width:auto"><option value="">빈 글</option>${tpls.map((t) => `<option value="${t.id}">${h(t.name)}</option>`).join('')}</select>` : ''}
<button class="primary">+ 새 글</button></form></div>
${cats.length || c || tag ? `<p class="mute">분류: <a href="/app/n/${nl.id}/posts">전체</a>${cats.map((x) => ` · <a href="?c=${encodeURIComponent(x)}"${x === c ? ' style="font-weight:600"' : ''}>${h(x)}</a>`).join('')}${tag ? ` · #${h(tag)} <a href="/app/n/${nl.id}/posts">✕</a>` : ''}</p>` : ''}
<div class="card"><table><tr><th>제목</th><th>분류</th><th>상태</th><th>일시</th><th></th></tr>${rows.map((p) => `<tr>
<td><a href="/app/n/${nl.id}/posts/${p.id}">${h(p.subject || '(제목 없음)')}</a></td>
<td class="mute">${h(p.category)}${p.tags ? ` ${p.tags.split(',').map((t) => `<a href="?tag=${encodeURIComponent(t)}">#${h(t)}</a>`).join(' ')}` : ''}</td>
<td><span class="badge ${p.status}">${p.status}</span></td>
<td class="mute">${fmt(p.sent_at || p.scheduled_at || p.created_at)}</td><td><a href="/app/n/${nl.id}/posts/${p.id}/stats">통계</a></td></tr>`).join('')
    || '<tr><td colspan="5" class="mute">아직 없습니다.</td></tr>'}</table></div>
<p class="mute"><a href="/app/n/${nl.id}/templates">템플릿 관리</a></p>`, { nl, active: 'posts', wide: true, msg: req.query.m });
});

ed.post('/app/n/:nid/posts/new', async (req, res) => {
  const t = req.body.template_id && await db.prepare('SELECT * FROM templates WHERE id=? AND newsletter_id=?').get(req.body.template_id, req.nl.id);
  const id = Number((await db.prepare('INSERT INTO posts(newsletter_id,subject,preview,body_md,category,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.nl.id, t?.subject || '', t?.preview || '', t?.body_md || '', t ? cleanCategory(req.nl, t.category) : '', t?.tags || '', now(), now())).lastInsertRowid);
  res.redirect(`/app/n/${req.nl.id}/posts/${id}`);
});

// ================= 에디터 =================
ed.get('/app/n/:nid/posts/:id', async (req, res) => {
  const nl = req.nl, p = await getPost(req);
  if (!p) return res.redirect(`/app/n/${nl.id}/posts`);
  if (p.status === 'sent' || p.status === 'sending') return res.redirect(`/app/n/${nl.id}/posts/${p.id}/stats`);
  const n = (await recipientsFor(p)).length;
  const cats = categoriesOf(nl);
  const verCount = (await db.prepare('SELECT COUNT(*) n FROM post_versions WHERE post_id=?').get(p.id)).n;
  const tpls = await db.prepare('SELECT id,name,subject,preview,body_md FROM templates WHERE newsletter_id=? ORDER BY id').all(nl.id);
  const cfg = { nid: nl.id, id: p.id, status: p.status, rev: p.updated_at || '', body_md: p.body_md, scheduled_at: p.scheduled_at || '',
    templates: tpls, sample: { name: req.user.name || '', email: req.user.email }, from: nl.name };
  res.page('글 쓰기', `<div class="row"><h1 class="grow">글 쓰기 <span class="badge ${p.status}">${p.status}</span></h1>
<span class="mute" id="savestate">${p.status === 'scheduled' ? '예약됨 — 수정하면 예약이 해제됩니다' : ''}</span></div>
<form method="post" id="f"><input type="hidden" name="tz" id="tz"><input type="hidden" name="body_md" id="body">
<div class="editor"><div>
<label>제목</label><input name="subject" value="${h(p.subject)}" maxlength="200" placeholder="제목에도 {{name}} 을 쓸 수 있어요">
<label>미리보기 문구 (받은편지함에서 제목 옆에 표시)</label><input name="preview" value="${h(p.preview)}" maxlength="300">
<div class="row"><div class="grow"><label>카테고리</label><select name="category"><option value="">없음</option>${cats.map((x) => `<option ${p.category === x ? 'selected' : ''}>${h(x)}</option>`).join('')}</select>
${cats.length ? '' : `<span class="mute"><a href="/app/n/${nl.id}/settings">설정</a>에서 카테고리를 만들 수 있어요</span>`}</div>
<div class="grow"><label>태그 (쉼표로 구분)</label><input name="tags" value="${h(p.tags)}" placeholder="예: 에세이, 일상"></div></div>
<label>본문</label>
<div class="tools" id="tools"><button type="button" class="sm" data-fmt="b">굵게</button><button type="button" class="sm" data-fmt="i">기울임</button><button type="button" class="sm" data-fmt="a">링크</button>
<select id="merge" class="sm-select"><option value="">메일 머지 ▾</option><option value="{{name}}">{{name}} 닉네임</option><option value="{{name|독자}}">{{name|독자}} 없으면 '독자'</option><option value="{{email}}">{{email}} 이메일</option></select>
<select id="tplsel" class="sm-select"><option value="">템플릿 ▾</option>${tpls.map((t) => `<option value="${t.id}">${h(t.name)}</option>`).join('')}</select>
<button type="button" class="sm" id="savetpl">템플릿으로 저장</button><button type="button" class="sm" id="rawtoggle">마크다운</button></div>
<div id="blocks" class="blocks"></div><textarea id="raw" hidden rows="24"></textarea>
<p class="mute">빈 줄에서 <code>/</code>를 입력하면 블록 메뉴가 열립니다. <code>#</code> <code>-</code> <code>1.</code> <code>&gt;</code> <code>---</code> 단축 입력도 지원합니다.</p>
</div>
<div class="pvcol"><div class="row" style="margin-bottom:8px"><div class="seg" id="pvmode"><button type="button" class="on" data-m="web">웹</button><button type="button" data-m="email">이메일</button></div>
<div class="seg" id="pvdev"><button type="button" class="on" data-d="d">데스크톱</button><button type="button" data-d="m">모바일</button></div></div>
<div id="inbox" class="inbox" hidden></div><div class="pvwrap" id="pvwrap"><iframe id="pv" sandbox=""></iframe></div></div></div>
<div class="card"><div class="row"><div><label>발송 대상</label><select name="audience">
<option value="all" ${p.audience === 'all' ? 'selected' : ''}>모든 구독자</option><option value="paid" ${p.audience === 'paid' ? 'selected' : ''}>유료 구독자만 (유료 전용 글)</option>
<option value="free" ${p.audience === 'free' ? 'selected' : ''}>무료 구독자만</option></select></div>
<div><label>예약 시각 <span id="tzname"></span></label><input type="datetime-local" name="scheduled_at" id="sched"></div>
<div style="align-self:flex-end"><button type="button" class="sm" data-q="tomorrow9">내일 오전 9시</button> <button type="button" class="sm" data-q="plus1h">1시간 뒤</button></div></div>
<p class="mute">지금 발송하면 확정된 구독자 <b>${n}명</b>에게 전송됩니다. 유료 구간은 본문에 <code>[[paywall]]</code> 블록(“/유료”)을 넣으세요.</p>
<div class="row"><button name="action" value="save">임시 저장</button><button name="action" value="test">테스트 발송 (내 메일로)</button>
<button name="action" value="schedule">${p.status === 'scheduled' ? '예약 변경' : '예약 발송'}</button>${p.status === 'scheduled' ? '<button name="action" value="cancel">예약 취소</button>' : ''}
<button class="primary" name="action" value="send" onclick="return confirm('${n}명에게 지금 발송합니다. 계속할까요?')">지금 발송</button></div></div></form>
<div class="row"><a class="btn" href="/app/n/${nl.id}/posts/${p.id}/versions">버전 기록${verCount ? ` (${verCount})` : ''}</a>
<form method="post" action="/app/n/${nl.id}/posts/${p.id}/delete" onsubmit="return confirm('삭제할까요?')"><button class="danger sm">이 글 삭제</button></form></div>
<script type="application/json" id="cfg">${jsonForScript(cfg)}</script><script src="/static/editor.js"></script>`,
  { nl, active: 'posts', wide: true, msg: req.query.m });
});

// ---------- 미리보기 (웹 / 이메일) ----------
ed.post('/app/n/:nid/preview', async (req, res) => {
  const b = req.body;
  const post = { id: 0, subject: String(b.subject || ''), preview: String(b.preview || ''), body_md: String(b.body_md || ''), category: cleanCategory(req.nl, b.category),
    tags: cleanTags(b.tags), audience: ['paid', 'free'].includes(b.audience) ? b.audience : 'all' };
  const sample = { name: String(b.sample_name || '').slice(0, 60), email: String(b.sample_email || '').slice(0, 100), token: '' };
  // 이메일 미리보기는 유료 구간까지 모두 보여주는 'test' 모드(실제 발송 모양)
  res.send(await renderPost(post, req.nl, b.mode === 'email' ? { mode: 'test', sub: sample } : { mode: 'web', canRead: true }));
});

// ---------- 자동 저장 ----------
ed.post('/app/n/:nid/posts/:id/autosave', express.json({ limit: '2mb' }), async (req, res) => {
  const p = await getPost(req);
  if (!p) return res.status(404).json({ error: '글을 찾을 수 없습니다.' });
  if (p.status !== 'draft') return res.status(409).json({ error: '임시 저장 상태에서만 자동 저장됩니다.' });
  if ((req.body.rev || '') !== (p.updated_at || '')) return res.status(409).json({ error: '다른 창에서 이 글이 수정되었습니다. 새로고침해 주세요.', conflict: true });
  const { c, t } = await applyContent(p, req.nl, req.body);
  const versioned = await snapshot(p.id, c, 'auto');
  res.json({ ok: true, rev: t, at: t, versioned });
});

// ================= 저장 · 테스트 · 예약 · 발송 =================
ed.post('/app/n/:nid/posts/:id', async (req, res) => {
  const nl = req.nl, p = await getPost(req);
  if (!p || !['draft', 'scheduled'].includes(p.status)) return res.redirect(`/app/n/${nl.id}/posts`);
  const b = req.body;
  const go = (m) => back(res, `/app/n/${nl.id}/posts/${p.id}`, m);
  const { c } = await applyContent(p, nl, b);
  await snapshot(p.id, c, 'manual', true);
  const when = parseLocal(b.scheduled_at, b.tz);
  await db.prepare('UPDATE posts SET scheduled_at=? WHERE id=?').run(when, p.id);
  const fresh = await getPost(req);
  if (['test', 'schedule', 'send'].includes(b.action) && !req.user.verified) return go('이메일 인증 후 발송할 수 있습니다. 상단의 "인증 메일 다시 받기"를 눌러주세요.');

  if (b.action === 'test') {
    if (!fresh.subject || !fresh.body_md) return go('제목과 본문을 입력하세요.');
    try { return go(`${await sendTest(fresh, nl, req.user)} 로 테스트 메일을 보냈습니다.` + (smtpConfigured() ? '' : ' (outbox 폴더 확인)')); }
    catch (e) { return go('테스트 실패: ' + e.message); }
  }
  if (b.action === 'schedule' || b.action === 'send') {
    if (!fresh.subject || !fresh.body_md) return go('제목과 본문을 입력하세요.');
    if (b.action === 'schedule') {
      if (!fresh.scheduled_at) return go('예약 시각을 선택하세요.');
      if (new Date(fresh.scheduled_at) <= new Date(Date.now() + 60_000)) return go('예약 시각은 현재보다 1분 이상 이후여야 합니다.');
      await db.prepare("UPDATE posts SET status='scheduled' WHERE id=?").run(p.id);
      return back(res, `/app/n/${nl.id}/posts`, `${fmt(fresh.scheduled_at)}에 발송 예약됨`);
    }
    // 요청 안에서 시간 예산(기본 20초)만큼 먼저 발송하고, 남은 수신자는 주기 작업(크론)이 이어서 보낸다
    try { await sendPost(p.id); } catch (e) { console.error('발송 오류', e); }
    return res.redirect(`/app/n/${nl.id}/posts/${p.id}/stats`);
  }
  // 저장/예약 취소: 예약 상태였다면 초안으로 되돌린다
  if (fresh.status === 'scheduled') await db.prepare("UPDATE posts SET status='draft' WHERE id=?").run(p.id);
  go(b.action === 'cancel' ? '예약을 취소했습니다.' : '임시 저장했습니다.');
});

ed.post('/app/n/:nid/posts/:id/delete', async (req, res) => {
  await db.prepare("DELETE FROM posts WHERE id=? AND newsletter_id=? AND status IN ('draft','scheduled')").run(req.params.id, req.nl.id);
  back(res, `/app/n/${req.nl.id}/posts`, '삭제했습니다.');
});

// ================= 버전 기록 =================
const REASON = { auto: '자동 저장', manual: '직접 저장', restore: '복구 직전', initial: '최초 상태' };
ed.get('/app/n/:nid/posts/:id/versions', async (req, res) => {
  const nl = req.nl, p = await getPost(req);
  if (!p) return res.redirect(`/app/n/${nl.id}/posts`);
  const vs = await db.prepare('SELECT * FROM post_versions WHERE post_id=? ORDER BY id DESC').all(p.id);
  const editable = ['draft', 'scheduled'].includes(p.status);
  res.page('버전 기록', `<h1>버전 기록</h1><p class="mute">${h(p.subject || '(제목 없음)')} · 최근 50개까지 보관됩니다. 복구하면 현재 내용은 "복구 직전" 버전으로 남습니다.</p>
<div class="card">${vs.length ? vs.map((v, i) => {
    const older = vs[i + 1];
    const delta = older ? v.body_md.length - older.body_md.length : v.body_md.length;
    return `<details style="border-bottom:1px solid var(--line);padding:12px 0"><summary style="cursor:pointer;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap">
<b style="font-weight:500">${fmt(v.created_at)}</b><span class="mute">${REASON[v.reason] || v.reason}</span><span class="mute">${v.body_md.length.toLocaleString()}자 (${delta >= 0 ? '+' : ''}${delta})</span>
<span>${h(v.subject || '(제목 없음)')}</span></summary>
<pre style="white-space:pre-wrap;font:13px/1.65 ui-monospace,Consolas,monospace;background:var(--soft);padding:14px;border-radius:6px;max-height:320px;overflow:auto;margin:12px 0">${h(v.body_md) || '(빈 본문)'}</pre>
${editable ? `<form method="post" action="/app/n/${nl.id}/posts/${p.id}/versions/${v.id}/restore" onsubmit="return confirm('이 버전으로 되돌릴까요?')"><button class="sm">이 버전으로 복구</button></form>` : ''}</details>`;
  }).join('') : '<p class="mute">아직 기록이 없습니다. 글을 저장하면 버전이 쌓입니다.</p>'}</div>
<p><a href="/app/n/${nl.id}/posts/${p.id}">← 에디터로</a></p>`, { nl, active: 'posts', wide: true, msg: req.query.m });
});
ed.post('/app/n/:nid/posts/:id/versions/:vid/restore', async (req, res) => {
  const nl = req.nl, p = await getPost(req);
  const v = p && await db.prepare('SELECT * FROM post_versions WHERE id=? AND post_id=?').get(req.params.vid, p.id);
  if (!p || !v || !['draft', 'scheduled'].includes(p.status)) return back(res, `/app/n/${nl.id}/posts`, '복구할 수 없습니다.');
  await snapshot(p.id, { subject: p.subject, preview: p.preview, body_md: p.body_md }, 'restore', true);
  await db.prepare("UPDATE posts SET subject=?, preview=?, body_md=?, updated_at=?, status='draft' WHERE id=?").run(v.subject, v.preview, v.body_md, now(), p.id);
  back(res, `/app/n/${nl.id}/posts/${p.id}`, `${fmt(v.created_at)} 버전으로 복구했습니다.`);
});

// ================= 템플릿 =================
ed.get('/app/n/:nid/templates', async (req, res) => {
  const nl = req.nl;
  const rows = await db.prepare('SELECT * FROM templates WHERE newsletter_id=? ORDER BY id').all(nl.id);
  res.page('템플릿', `<h1>템플릿</h1><p class="mute">반복해서 쓰는 글 구조를 저장해 두고, 새 글을 만들 때 불러옵니다. 에디터의 "템플릿으로 저장"으로도 추가할 수 있어요.</p>
<div class="card"><table><tr><th>이름</th><th>제목</th><th>수정</th><th></th></tr>${rows.map((t) => `<tr><td>${h(t.name)}</td><td class="mute">${h(t.subject)}</td><td class="mute">${fmt(t.created_at)}</td>
<td class="row"><form method="post" action="/app/n/${nl.id}/templates/${t.id}/use" style="margin:0"><button class="sm primary">이 템플릿으로 새 글</button></form>
<form method="post" action="/app/n/${nl.id}/templates/${t.id}/delete" style="margin:0" onsubmit="return confirm('템플릿을 삭제할까요?')"><button class="sm danger">삭제</button></form></td></tr>`).join('')
    || '<tr><td colspan="4" class="mute">템플릿이 없습니다.</td></tr>'}</table></div>
<form method="post" action="/app/n/${nl.id}/templates/defaults"><button>기본 템플릿 3종 추가</button></form>`, { nl, active: 'posts', wide: true, msg: req.query.m });
});
ed.post('/app/n/:nid/templates', express.json({ limit: '2mb' }), async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: '템플릿 이름을 입력하세요.' });
  if ((await db.prepare('SELECT COUNT(*) n FROM templates WHERE newsletter_id=?').get(req.nl.id)).n >= 50) return res.status(400).json({ error: '템플릿은 50개까지 만들 수 있습니다.' });
  const c = content(req.body);
  const id = Number((await db.prepare('INSERT INTO templates(newsletter_id,name,subject,preview,body_md,category,tags,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.nl.id, name, c.subject, c.preview, c.body_md, cleanCategory(req.nl, req.body.category), cleanTags(req.body.tags), now())).lastInsertRowid);
  res.json({ ok: true, id, name, subject: c.subject, preview: c.preview, body_md: c.body_md });
});
ed.post('/app/n/:nid/templates/defaults', async (req, res) => { await addStarterTemplates(req.nl.id); back(res, `/app/n/${req.nl.id}/templates`, '기본 템플릿을 추가했습니다.'); });
ed.post('/app/n/:nid/templates/:tid/use', async (req, res) => {
  const t =await db.prepare('SELECT * FROM templates WHERE id=? AND newsletter_id=?').get(req.params.tid, req.nl.id);
  if (!t) return back(res, `/app/n/${req.nl.id}/templates`, '템플릿을 찾을 수 없습니다.');
  const id = Number((await db.prepare('INSERT INTO posts(newsletter_id,subject,preview,body_md,category,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.nl.id, t.subject, t.preview, t.body_md, cleanCategory(req.nl, t.category), t.tags, now(), now())).lastInsertRowid);
  res.redirect(`/app/n/${req.nl.id}/posts/${id}`);
});
ed.post('/app/n/:nid/templates/:tid/delete', async (req, res) => {
  await db.prepare('DELETE FROM templates WHERE id=? AND newsletter_id=?').run(req.params.tid, req.nl.id);
  back(res, `/app/n/${req.nl.id}/templates`, '삭제했습니다.');
});

// ================= 외부 글 가져오기 =================
const HINTS = 'Substack: <code>https://이름.substack.com/feed</code> · Medium: <code>https://medium.com/feed/@이름</code> · 워드프레스: <code>/feed</code> · 티스토리: <code>/rss</code> · 네이버 블로그: <code>https://rss.blog.naver.com/아이디</code>';
ed.get('/app/n/:nid/import', (req, res) => {
  const nl = req.nl;
  res.page('가져오기', `<h1>다른 플랫폼에서 글 가져오기</h1>
<h2>RSS / Atom 주소로 가져오기</h2>
<form class="card" method="post" action="/app/n/${nl.id}/import/rss"><label>피드 주소</label><input name="url" type="url" required placeholder="https://example.substack.com/feed">
<p class="mute" style="margin-top:8px">${HINTS}</p>
<div class="row"><div><label>가져올 개수</label><select name="limit" style="width:auto"><option>10</option><option selected>20</option><option>50</option></select></div>
<div><label>가져온 뒤</label><select name="mode" style="width:auto"><option value="draft">초안으로 (발송 전 검토)</option><option value="archive">웹 아카이브에만 게시 (메일 발송 안 함)</option></select></div></div>
<p><button class="primary">가져오기</button></p>
<p class="mute">피드가 제공하는 최근 글만 가져옵니다(플랫폼마다 10~50개). 이미 가져온 글은 건너뜁니다. 이미지는 원본 주소를 그대로 사용하므로 원본 사이트가 사라지면 보이지 않을 수 있습니다.
전체 글 이전은 해당 플랫폼의 내보내기 파일을 HTML/마크다운으로 변환해 아래 "붙여넣기"를 이용하세요.</p></form>
<h2>HTML · 마크다운 붙여넣기</h2>
<form class="card" method="post" action="/app/n/${nl.id}/import/paste"><label>제목</label><input name="subject" maxlength="200">
<label>본문 (HTML 또는 마크다운) <input type="file" id="pf" accept=".md,.markdown,.html,.htm,.txt" style="margin-left:8px"></label>
<textarea name="body" id="pb" rows="12" required></textarea>
<p><button class="primary">초안으로 만들기</button></p></form>
<script>document.getElementById('pf').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>2e6){alert('2MB 이하 파일만 가능합니다');return}document.getElementById('pb').value=await f.text();const s=document.querySelector('[name=subject]');if(!s.value)s.value=f.name.replace(/\\.[^.]+$/,'')}</script>`,
  { nl, active: 'posts', msg: req.query.m });
});

ed.post('/app/n/:nid/import/rss', async (req, res) => {
  const nl = req.nl, url = String(req.body.url || '').trim();
  const out = (m) => back(res, `/app/n/${nl.id}/import`, m);
  if (!/^https?:\/\//i.test(url) || url.length > 500) return out('http(s)로 시작하는 올바른 주소를 입력하세요.');
  if (!await cooldown(`import:${req.user.id}`, 5_000)) return out('잠시 후 다시 시도해 주세요.');
  try {
    const items = parseFeed(await fetchSafe(url), url).slice(0, Math.min(50, Math.max(1, Number(req.body.limit) || 20)));
    if (!items.length) return out('가져올 글을 찾지 못했습니다. RSS/Atom 피드 주소가 맞는지 확인하세요.');
    const archive = req.body.mode === 'archive';
    let added = 0, skipped = 0;
    for (const it of items.reverse()) { // 오래된 글부터 넣어 목록 순서를 유지
      if (it.url && await db.prepare('SELECT 1 FROM posts WHERE newsletter_id=? AND source_url=?').get(nl.id, it.url)) { skipped++; continue; }
      await db.prepare('INSERT INTO posts(newsletter_id,subject,body_md,tags,status,sent_at,source_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(nl.id, it.title.slice(0, 200), it.body_md.slice(0, 500_000), cleanTags(it.tags.join(',')), archive ? 'sent' : 'draft', archive ? it.date || now() : null, it.url || null, now(), now());
      added++;
    }
    back(res, `/app/n/${nl.id}/posts`, `${added}개를 가져왔습니다${skipped ? ` (이미 있는 ${skipped}개 건너뜀)` : ''}. ${archive ? '웹 아카이브에 게시되었고 메일은 발송되지 않았습니다.' : '초안을 검토한 뒤 발송하세요.'}`);
  } catch (e) {
    out('가져오지 못했습니다: ' + String(e.message || e).slice(0, 150));
  }
});

ed.post('/app/n/:nid/import/paste', async (req, res) => {
  const raw = String(req.body.body || '').slice(0, 2_000_000);
  const isHtml = /<(p|div|h[1-6]|br|ul|ol|li|a|img|blockquote|strong|em)\b/i.test(raw);
  const body = isHtml ? htmlToMd(raw) : raw;
  const id = Number((await db.prepare('INSERT INTO posts(newsletter_id,subject,body_md,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(req.nl.id, String(req.body.subject || '').trim().slice(0, 200), body, now(), now())).lastInsertRowid);
  res.redirect(`/app/n/${req.nl.id}/posts/${id}`);
});
