import { Router } from 'express';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { saveImage, isOwnImageUrl } from './storage.js';
import { db, now, isPaid, dailySendLimit, sentLast24h, cleanTags } from './db.js';
import { renderPost, h } from './render.js';
import { recipientsFor, sendPost, sendTest } from './send.js';
import { smtpConfigured } from './mail.js';
import { requireUser } from './auth.js';
import { seedNewsletter } from './seed.js';
import { page, fmt, pct } from './views.js';
import { snsFields, parseSns } from './sns.js';
import { parseSubscribers } from './csv.js';
import { viewStats, postViewStats } from './analytics.js';

export const dash = Router();
dash.use('/app', requireUser);

const note = (m) => '?m=' + encodeURIComponent(m);
const back = (res, path, m) => res.redirect(m ? path + (path.includes('?') ? '&' : '?') + 'm=' + encodeURIComponent(m) : path);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// /app/n/:nid/... 는 소유자만 접근
dash.param('nid', async (req, res, next, id) => {
  req.nl = await db.prepare('SELECT * FROM newsletters WHERE id=? AND owner_id=?').get(id, req.user.id);
  if (!req.nl) return res.status(404).page('없음', '<p>뉴스레터를 찾을 수 없습니다. <a href="/app">내 뉴스레터</a></p>');
  next();
});

// ---------- 이미지 업로드 (에디터·로고 공용) ----------
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
// Vercel 은 요청 본문이 4.5MB 로 제한되므로 base64(약 1.33배)를 감안해 이미지는 3MB 까지
dash.post('/app/upload', express.json({ limit: '4.4mb' }), async (req, res) => {
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.data || '');
  const ext = m && TYPES[m[1]];
  if (!ext) return res.status(400).json({ error: 'PNG/JPG/GIF/WEBP 이미지만 올릴 수 있습니다.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: '이미지는 3MB 이하여야 합니다.' });
  try { res.json({ url: await saveImage(buf, ext, m[1]) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
const uploadJs = `
async function uploadImage(file){
  const data = await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)});
  const r = await fetch('/app/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});
  const j = await r.json(); if(!r.ok) throw new Error(j.error||'업로드 실패'); return j.url;
}`;

// ---------- 내 뉴스레터 목록 / 개설 ----------
dash.get('/app', async (req, res) => {
  const list = await db.prepare(`SELECT n.*,
    (SELECT COUNT(*) FROM subscribers s WHERE s.newsletter_id=n.id AND s.status='active') AS subs,
    (SELECT COUNT(*) FROM posts p WHERE p.newsletter_id=n.id AND p.status='sent') AS posts
    FROM newsletters n WHERE owner_id=? ORDER BY id DESC`).all(req.user.id);
  res.page('내 뉴스레터', `<div class="row"><h1 class="grow">내 뉴스레터</h1><a class="btn primary" href="/app/new">+ 새 뉴스레터</a></div>
${list.length ? `<div class="grid">${list.map((n) => `<a class="card" href="/app/n/${n.id}">
<div class="row">${n.logo ? `<img class="logo" style="width:44px;height:44px;border-radius:10px" src="${h(n.logo)}" alt="">` : ''}<b>${h(n.name)}</b></div>
<p class="mute" style="margin:8px 0 0">구독자 ${n.subs} · 발행 ${n.posts}</p></a>`).join('')}</div>`
    : '<div class="card"><p>아직 뉴스레터가 없습니다. 첫 번째 뉴스레터를 개설해 보세요.</p><a class="btn primary" href="/app/new">뉴스레터 만들기</a></div>'}`,
  { active: 'app', msg: req.query.m });
});

const nlForm = (nl = {}, isNew = true) => `<form class="card" method="post">
<label>이름</label><input name="name" value="${h(nl.name || '')}" required maxlength="60">
${isNew ? `<label>주소 (영문 소문자·숫자·하이픈, 3~30자)</label><div class="row nowrap"><span class="mute">/n/</span><input name="slug" pattern="[a-z0-9][a-z0-9\-]{2,29}" required placeholder="my-letter"></div>` : ''}
<label>소개</label><textarea name="description" rows="3" maxlength="300" style="font-family:inherit">${h(nl.description || '')}</textarea>
<label>글 카테고리 (쉼표로 구분, 최대 10개 — 글마다 하나를 고르고 공개 아카이브에서 필터로 쓰입니다)</label><input name="categories" value="${h(nl.categories || '')}" placeholder="예: 에세이, 인터뷰, 공지">
<label>SNS · 링크 (선택 — 공개 페이지 상단에 아이콘으로 표시됩니다)</label>${snsFields(nl)}
<label>로고</label><input type="hidden" name="logo" id="logo" value="${h(nl.logo || '')}">
<div class="row"><img id="lp" class="logo" ${nl.logo ? `src="${h(nl.logo)}"` : 'style="display:none"'} alt=""><input type="file" id="lf" accept="image/png,image/jpeg,image/gif,image/webp" style="width:auto"></div>
${isNew ? '' : `<label>커버(배경) 이미지 — 공개 페이지 상단 배경과 SNS 공유 미리보기에 쓰입니다 (가로로 긴 이미지 권장)</label><input type="hidden" name="cover" id="cover" value="${h(nl.cover || '')}">
<div class="row"><img id="cp" ${nl.cover ? `src="${h(nl.cover)}"` : 'style="display:none"'} alt="" style="width:160px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"><input type="file" id="cf" accept="image/png,image/jpeg,image/gif,image/webp" style="width:auto"><button type="button" class="sm" id="cx">제거</button></div>
<label>대표 색상 — 커버가 없을 때 배경과 버튼 색으로 쓰입니다</label><input type="color" name="accent" value="${h(nl.accent || '#3B82F6')}" style="width:64px;height:40px;padding:2px">`}
<div style="margin-top:28px"><button class="primary">${isNew ? '개설하기' : '저장'}</button></div></form>
<script>${uploadJs}
document.getElementById('lf').onchange=async e=>{try{const u=await uploadImage(e.target.files[0]);document.getElementById('logo').value=u;const p=document.getElementById('lp');p.src=u;p.style.display=''}catch(x){alert(x.message)}}
const cf=document.getElementById('cf');if(cf){cf.onchange=async e=>{try{const u=await uploadImage(e.target.files[0]);document.getElementById('cover').value=u;const p=document.getElementById('cp');p.src=u;p.style.display=''}catch(x){alert(x.message)}};
document.getElementById('cx').onclick=()=>{document.getElementById('cover').value='';document.getElementById('cp').style.display='none'}}</script>`;

dash.get('/app/new', (req, res) =>
  res.page('새 뉴스레터', `<h1>뉴스레터 개설</h1>${nlForm()}`, { active: 'app', msg: req.query.m }));
dash.post('/app/new', async (req, res) => {
  const b = req.body;
  const slug = String(b.slug || '').toLowerCase();
  const name = String(b.name || '').trim();
  if (!name || !/^[a-z0-9][a-z0-9-]{2,29}$/.test(slug)) return res.redirect('/app/new' + note('이름과 올바른 형식의 주소를 입력하세요.'));
  if (await db.prepare('SELECT 1 FROM newsletters WHERE slug=?').get(slug)) return res.redirect('/app/new' + note('이미 사용 중인 주소입니다.'));
  const id = Number((await db.prepare('INSERT INTO newsletters(owner_id,slug,name,description,logo,categories,sns,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.user.id, slug, name.slice(0, 60), String(b.description || '').slice(0, 300), isOwnImageUrl(b.logo) ? b.logo : '', cleanTags(b.categories), parseSns(b), now())).lastInsertRowid);
  await seedNewsletter(id, name.slice(0, 60)); // 환영 메일(켜짐) + 첫 글 초안을 기본으로 만들어 둔다
  res.redirect(`/app/n/${id}` + note('뉴스레터를 만들었습니다. 아래 체크리스트를 따라 시작해 보세요.'));
});

// ---------- 프로필 ----------
dash.get('/app/profile', (req, res) => res.page('프로필', `<h1>프로필</h1><form class="card" method="post">
<label>이메일</label><input value="${h(req.user.email)}" disabled>
<label>이름 (구독자에게 발행자로 표시)</label><input name="name" value="${h(req.user.name)}" maxlength="60">
<label>소개</label><textarea name="bio" rows="3" maxlength="300" style="font-family:inherit">${h(req.user.bio)}</textarea>
<p><button class="primary">저장</button></p></form>`, { active: 'profile', msg: req.query.m }));
dash.post('/app/profile', async (req, res) => {
  await db.prepare('UPDATE users SET name=?, bio=? WHERE id=?').run(String(req.body.name || '').trim().slice(0, 60), String(req.body.bio || '').slice(0, 300), req.user.id);
  back(res, '/app/profile', '저장했습니다.');
});

// ---------- 대시보드 ----------
dash.get('/app/n/:nid', async (req, res) => {
  const nl = req.nl;
  const c = async (s) => (await db.prepare('SELECT COUNT(*) n FROM subscribers WHERE newsletter_id=? AND status=?').get(nl.id, s)).n;
  const t = await db.prepare(`SELECT COUNT(*) sent, COUNT(l.opened_at) opened FROM send_log l JOIN posts p ON p.id=l.post_id
    WHERE p.newsletter_id=? AND l.error IS NULL`).get(nl.id);
  const clicked = (await db.prepare(`SELECT COUNT(DISTINCT c.post_id||'-'||c.subscriber_id) n FROM clicks c JOIN posts p ON p.id=c.post_id WHERE p.newsletter_id=?`).get(nl.id)).n;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push([d, (await db.prepare("SELECT COUNT(*) n FROM subscribers WHERE newsletter_id=? AND status!='pending' AND substr(created_at,1,10)=?").get(nl.id, d)).n]);
  }
  const max = Math.max(1, ...days.map((d) => d[1]));
  const vs = await viewStats(nl.id, 30);
  const vmax = Math.max(1, ...vs.daily.map((d) => d[1]));
  const recent = await Promise.all((await db.prepare("SELECT * FROM posts WHERE newsletter_id=? AND kind='post' ORDER BY id DESC LIMIT 5").all(nl.id)).map(async (p) => {
    const s = await db.prepare('SELECT COUNT(*) sent, COUNT(opened_at) opened FROM send_log WHERE post_id=? AND error IS NULL').get(p.id);
    const k = (await db.prepare('SELECT COUNT(DISTINCT subscriber_id) n FROM clicks WHERE post_id=?').get(p.id)).n;
    return `<tr><td><a href="/app/n/${nl.id}/posts/${p.id}">${h(p.subject || '(제목 없음)')}</a></td><td><span class="badge ${p.status}">${p.status}</span></td><td>${s.sent}</td><td>${pct(s.opened, s.sent)}</td><td>${pct(k, s.sent)}</td></tr>`;
  }));
  // 시작 체크리스트: 모두 끝나면 사라진다
  const firstDraft = await db.prepare("SELECT id FROM posts WHERE newsletter_id=? AND kind='post' AND status IN ('draft','scheduled') ORDER BY id LIMIT 1").get(nl.id);
  const steps = [
    ['이메일 인증', !!req.user.verified, ''],
    ['뉴스레터 소개와 로고 설정', !!(nl.description && nl.logo), `/app/n/${nl.id}/settings`],
    ['환영 메일 켜기', (await db.prepare('SELECT COUNT(*) n FROM series WHERE newsletter_id=? AND active=1').get(nl.id)).n > 0, `/app/n/${nl.id}/automation`],
    ['첫 글 발행', (await db.prepare("SELECT COUNT(*) n FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent'").get(nl.id)).n > 0,
      firstDraft ? `/app/n/${nl.id}/posts/${firstDraft.id}` : `/app/n/${nl.id}/posts`],
    ['구독 링크 공유해 첫 구독자 받기', await c('active') > 0, `/app/n/${nl.id}/growth`],
  ];
  const todo = steps.filter((s) => !s[1]).length;
  const checklist = todo ? `<h2>시작하기 · ${steps.length - todo}/${steps.length}</h2><div class="card"><ul class="check">${steps.map(([label, done, href]) =>
    `<li class="${done ? 'done' : ''}"><span class="dot"></span>${done || label === '이메일 인증' ? label : `<a href="${href}">${label}</a>`}${!done && label === '이메일 인증' ? ' <span class="mute">— 메일함의 인증 링크를 눌러주세요</span>' : ''}</li>`).join('')}</ul></div>` : '';
  res.page(nl.name, `<h1>대시보드</h1>${checklist}
${smtpConfigured() ? '' : '<div class="msg">SMTP가 설정되지 않아 메일은 <code>outbox/</code> 폴더에 파일로 저장됩니다. 실제 발송은 <code>.env</code>에 SMTP 정보를 입력하세요.</div>'}
<div class="stats"><div class="stat"><b>${await c('active')}</b>구독자</div><div class="stat"><b>${t.sent}</b>총 발송량</div>
<div class="stat"><b>${pct(t.opened, t.sent)}</b>열람률</div><div class="stat"><b>${pct(clicked, t.sent)}</b>클릭률</div>
<div class="stat"><b>${await c('pending')}</b>확인 대기</div><div class="stat"><b>${await c('unsubscribed')}</b>해지</div>
<div class="stat"><b>${Math.max(0, dailySendLimit() - await sentLast24h(nl.id))}</b>24시간 남은 발송량 (한도 ${dailySendLimit()})</div></div>
<h2>최근 30일 신규 구독</h2><div class="card"><div class="bars">${days.map(([d, n]) => `<i title="${d}: ${n}명" style="height:${Math.max(3, (n / max) * 100)}%"></i>`).join('')}</div></div>
<h2>웹 방문 · 최근 30일</h2>
<div class="stats"><div class="stat"><b>${vs.views}</b>페이지 조회</div><div class="stat"><b>${vs.visitors}</b>방문자 (하루 단위 고유)</div>
<div class="stat"><b>${vs.subViews}</b>구독자 조회</div><div class="stat"><b>${vs.views - vs.subViews}</b>신규·익명 방문</div></div>
<div class="card"><div class="bars">${vs.daily.map(([d, n]) => `<i title="${d}: ${n}회" style="height:${Math.max(3, (n / vmax) * 100)}%"></i>`).join('')}</div></div>
<div class="row" style="align-items:flex-start"><div class="grow card" style="margin:0"><b>많이 본 글</b><table>${vs.top.map((r) => `<tr><td><a href="/app/n/${nl.id}/posts/${r.post_id}/stats">${h(r.subject || '(제목 없음)')}</a></td><td>${r.n}회</td></tr>`).join('') || '<tr><td class="mute">아직 조회 기록이 없습니다.</td></tr>'}</table></div>
<div class="grow card" style="margin:0"><b>유입 경로</b><table>${vs.sources.map((r) => `<tr><td>${r.src ? h(r.src) : '직접 접속·메일'}</td><td>${r.n}회</td></tr>`).join('') || '<tr><td class="mute">아직 조회 기록이 없습니다.</td></tr>'}</table></div></div>
<p class="mute">웹 조회는 공개 페이지와 글 페이지를 연 횟수예요. 검색 로봇·미리보기 봇과 발행자 본인의 조회는 제외하고, 같은 사람이 30분 안에 다시 열어도 한 번만 세요.</p>
<div class="row"><h2 class="grow">최근 발행</h2><form method="post" action="/app/n/${nl.id}/posts/new"><button class="primary">+ 새 글</button></form></div>
<div class="card"><table><tr><th>제목</th><th>상태</th><th>발송</th><th>열람률</th><th>클릭률</th></tr>
${recent.join('') || '<tr><td colspan="5" class="mute">아직 글이 없습니다.</td></tr>'}</table></div>
<p class="mute">구독 링크: <a href="/n/${h(nl.slug)}" target="_blank">/n/${h(nl.slug)}</a> — 이 주소를 공유해 구독자를 모으세요.</p>`,
  { nl, wide: true, msg: req.query.m });
});

// 글 목록·에디터·템플릿·가져오기는 editor.js 에서 처리
const getPost = async (req) => await db.prepare('SELECT * FROM posts WHERE id=? AND newsletter_id=?').get(req.params.id, req.nl.id);

dash.get('/app/n/:nid/posts/:id/stats', async (req, res) => {
  const nl = req.nl, p = await getPost(req);
  if (!p) return res.redirect(`/app/n/${nl.id}/posts`);
  const tot = await db.prepare('SELECT COUNT(*) sent, COUNT(opened_at) opened FROM send_log WHERE post_id=? AND error IS NULL').get(p.id);
  const failed = (await db.prepare('SELECT COUNT(*) n FROM send_log WHERE post_id=? AND error IS NOT NULL').get(p.id)).n;
  const uc = (await db.prepare('SELECT COUNT(DISTINCT subscriber_id) n FROM clicks WHERE post_id=?').get(p.id)).n;
  const pv = await postViewStats(p.id);
  const links = await db.prepare(`SELECT l.url, COUNT(c.id) clicks, COUNT(DISTINCT c.subscriber_id) uniq FROM links l
    LEFT JOIN clicks c ON c.link_id=l.id WHERE l.post_id=? GROUP BY l.id ORDER BY clicks DESC`).all(p.id);
  res.page('통계', `<div class="row"><h1 class="grow">${h(p.subject)}</h1><span class="badge ${p.status}">${p.status}</span></div>
<p class="mute">${p.status === 'sending' ? '발송 중입니다. 새로고침하면 진행 상황이 갱신됩니다.' : '발송: ' + fmt(p.sent_at)}</p>
<div class="stats"><div class="stat"><b>${tot.sent}</b>발송</div><div class="stat"><b>${pct(tot.opened, tot.sent)}</b>열람률 (${tot.opened})</div>
<div class="stat"><b>${pct(uc, tot.sent)}</b>클릭률 (${uc})</div><div class="stat"><b>${failed}</b>실패</div>
<div class="stat"><b>${pv.views}</b>웹 조회</div><div class="stat"><b>${pv.visitors}</b>웹 방문자</div><div class="stat"><b>${pv.subv}</b>구독자 웹 조회</div></div>
<p class="mute">열람 추적은 이미지 차단 시 집계되지 않아 실제보다 낮게 나올 수 있습니다.</p>
<h2>링크별 클릭</h2><div class="card"><table><tr><th>URL</th><th>클릭</th><th>고유</th></tr>${links.map((l) =>
  `<tr><td style="word-break:break-all">${h(l.url)}</td><td>${l.clicks}</td><td>${l.uniq}</td></tr>`).join('') || '<tr><td colspan="3" class="mute">링크 없음</td></tr>'}</table></div>
<p><a href="/n/${h(nl.slug)}/p/${p.id}" target="_blank">웹에서 보기</a> · <a href="/app/n/${nl.id}/posts">← 글 목록</a></p>`,
  { nl, active: 'posts', wide: true });
});

// ---------- 구독자 ----------
dash.get('/app/n/:nid/subscribers', async (req, res) => {
  const nl = req.nl;
  const { q = '', status = '' } = req.query;
  let rows = await db.prepare('SELECT * FROM subscribers WHERE newsletter_id=? ORDER BY id DESC').all(nl.id);
  if (q) rows = rows.filter((s) => (s.email + s.name).toLowerCase().includes(String(q).toLowerCase()));
  if (status) rows = rows.filter((s) => s.status === status);
  res.page('구독자', `<h1>구독자 <span class="mute">${rows.length}명</span></h1>
<form class="row" method="get"><input class="grow" name="q" placeholder="이메일/이름 검색" value="${h(q)}">
<select name="status" style="width:auto"><option value="">전체 상태</option>${['active', 'pending', 'unsubscribed'].map((s) => `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
<button>검색</button><a class="btn" href="/app/n/${nl.id}/subscribers/export.csv">CSV 내보내기</a></form>
<div class="card"><table><tr><th>이메일</th><th>이름</th><th>상태</th><th>등급</th><th>가입</th><th></th></tr>
${rows.slice(0, 500).map((s) => `<tr><td>${h(s.email)}</td><td>${h(s.name)}</td><td><span class="badge ${s.status}">${s.status}</span></td>
<td>${isPaid(s) ? `<span class="badge active">유료${s.stripe_sub ? '' : '(지정)'}</span>` : '무료'}
<form method="post" action="/app/n/${nl.id}/subscribers/${s.id}/tier" style="display:inline"><button class="sm" title="결제 없이 유료 혜택을 주거나 회수합니다">${isPaid(s) ? '해제' : '유료 지정'}</button></form></td>
<td class="mute">${fmt(s.created_at)}</td><td><form method="post" action="/app/n/${nl.id}/subscribers/${s.id}/delete" style="margin:0" onsubmit="return confirm('삭제할까요?')"><button class="sm danger">삭제</button></form></td></tr>`).join('')}</table>
${rows.length > 500 ? '<p class="mute">상위 500명만 표시됩니다. 검색으로 좁혀보세요.</p>' : ''}</div>
<div class="editor"><form class="card" method="post" action="/app/n/${nl.id}/subscribers/add"><h2 style="margin-top:0">직접 추가</h2>
<label>이메일</label><input type="email" name="email" required><label>이름</label><input name="name"><p><button class="primary">추가</button></p></form>
<form class="card" method="post" action="/app/n/${nl.id}/subscribers/import"><h2 style="margin-top:0">CSV 가져오기</h2>
<label id="csvdrop" class="dropzone">CSV·텍스트 파일을 여기에 끌어다 놓거나 <u>파일 선택</u><input type="file" id="csvfile" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden></label>
<label>또는 엑셀·구글 시트에서 복사해 붙여넣기 (한 줄에 한 명)</label><textarea name="csv" id="csvtext" rows="5" placeholder="a@example.com,홍길동"></textarea>
<p class="mute" id="csvsum">이메일 열은 자동으로 찾고, 머리글 줄(이메일, 이름)과 쉼표·탭·세미콜론 구분을 모두 인식합니다. <a href="data:text/csv;charset=utf-8,%EF%BB%BFemail,name%0Aa@example.com,%ED%99%8D%EA%B8%B8%EB%8F%99" download="subscribers-sample.csv">샘플 파일</a></p>
<p class="mute">구독 동의를 받은 사람만 가져오세요. 바로 활성 상태가 됩니다.</p><p><button class="primary" id="csvgo">가져오기</button></p></form></div>
<script>(function(){var t=document.getElementById('csvtext'),s=document.getElementById('csvsum'),d=document.getElementById('csvdrop'),f=document.getElementById('csvfile'),base=s.innerHTML;
function sum(){var m=t.value.match(/[^\\s@,;"]+@[^\\s@,;"]+\\.[^\\s@,;"]+/g);s.innerHTML=m?'이메일 <b>'+new Set(m.map(function(x){return x.toLowerCase()})).size+'</b>개를 찾았습니다. 아래 버튼을 누르면 가져옵니다.':base}
function load(file){if(!file)return;if(file.size>1.5e6){alert('1.5MB 이하 파일만 가능합니다. 나눠서 올려 주세요.');return}
var r=new FileReader();r.onload=function(){t.value=r.result;sum()};r.readAsText(file)}
f.onchange=function(){load(f.files[0])};t.oninput=sum;
['dragenter','dragover'].forEach(function(e){d.addEventListener(e,function(x){x.preventDefault();d.classList.add('on')})});
['dragleave','drop'].forEach(function(e){d.addEventListener(e,function(x){x.preventDefault();d.classList.remove('on')})});
d.addEventListener('drop',function(x){load(x.dataTransfer.files[0])});
})()</script>`,
  { nl, active: 'subscribers', wide: true, msg: req.query.m });
});
dash.get('/app/n/:nid/subscribers/export.csv', async (req, res) => {
  const q = (v) => `"${String(v ?? '').replace(/^[=+\-@]/, "'$&").replace(/"/g, '""')}"`; // CSV 수식 주입 방지
  const rows = await db.prepare('SELECT * FROM subscribers WHERE newsletter_id=? ORDER BY id').all(req.nl.id);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=subscribers.csv' })
    .send('﻿email,name,status,created_at\n' + rows.map((s) => [s.email, s.name, s.status, s.created_at].map(q).join(',')).join('\n'));
});
const addSub = async (nid, email, name, source) =>
  (await db.prepare("INSERT OR IGNORE INTO subscribers(newsletter_id,email,name,status,token,source,created_at,confirmed_at) VALUES(?,?,?,'active',?,?,?,?)")
    .run(nid, email, name, randomBytes(18).toString('base64url'), source, now(), now())).changes;
dash.post('/app/n/:nid/subscribers/add', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return back(res, `/app/n/${req.nl.id}/subscribers`, '이메일 형식 오류');
  back(res, `/app/n/${req.nl.id}/subscribers`, await addSub(req.nl.id, email, String(req.body.name || '').slice(0, 80), 'admin') ? '추가했습니다.' : '이미 있는 이메일입니다.');
});
dash.post('/app/n/:nid/subscribers/import', async (req, res) => {
  const { rows, invalid, dup } = parseSubscribers(req.body.csv);
  let added = 0;
  for (const r of rows) added += await addSub(req.nl.id, r.email, r.name, 'import');
  const skip = [rows.length - added && `이미 있는 ${rows.length - added}명`, dup && `파일 안 중복 ${dup}명`, invalid && `이메일이 없는 ${invalid}줄`].filter(Boolean);
  back(res, `/app/n/${req.nl.id}/subscribers`, `${added}명을 가져왔습니다.${skip.length ? ` (건너뜀: ${skip.join(', ')})` : ''}`);
});
// 결제 없이 유료 혜택 지정/해제 (후원자·지인 등). 결제 중인 구독자는 해제하지 않는다
dash.post('/app/n/:nid/subscribers/:id/tier', async (req, res) => {
  const s = await db.prepare('SELECT * FROM subscribers WHERE id=? AND newsletter_id=?').get(req.params.id, req.nl.id);
  let m = '변경했습니다.';
  if (s && isPaid(s) && s.stripe_sub) m = '결제 중인 구독자는 Stripe에서 해지해야 합니다.';
  else if (s) await db.prepare('UPDATE subscribers SET tier=?, paid_until=NULL, plan=? WHERE id=?').run(isPaid(s) ? 'free' : 'paid', '', s.id);
  back(res, `/app/n/${req.nl.id}/subscribers`, m);
});
dash.post('/app/n/:nid/subscribers/:id/delete', async (req, res) => {
  await db.prepare('DELETE FROM subscribers WHERE id=? AND newsletter_id=?').run(req.params.id, req.nl.id);
  back(res, `/app/n/${req.nl.id}/subscribers`, '삭제했습니다.');
});

// ---------- 설정 ----------
dash.get('/app/n/:nid/settings', (req, res) =>
  res.page('설정', `<h1>뉴스레터 설정</h1><p class="mute">공개 주소: /n/${h(req.nl.slug)} (변경 불가)</p>${nlForm(req.nl, false)}
<form method="post" action="/app/n/${req.nl.id}/delete" class="card" onsubmit="return confirm('뉴스레터와 모든 글·구독자가 영구 삭제됩니다. 계속할까요?')">
<b>뉴스레터 삭제</b><p class="mute">모든 글, 구독자, 통계가 영구 삭제됩니다.</p><button class="danger">삭제</button></form>`,
  { nl: req.nl, active: 'settings', msg: req.query.m }));
dash.post('/app/n/:nid/settings', async (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim();
  if (!name) return back(res, `/app/n/${req.nl.id}/settings`, '이름을 입력하세요.');
  const logo = isOwnImageUrl(b.logo) ? b.logo : '';
  const categories = cleanTags(b.categories);
  const cover = isOwnImageUrl(b.cover) ? b.cover : '';
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : '';
  await db.prepare('UPDATE newsletters SET name=?, description=?, logo=?, categories=?, cover=?, accent=?, sns=? WHERE id=?').run(name.slice(0, 60), String(b.description || '').slice(0, 300), logo, categories, cover, accent, parseSns(b), req.nl.id);
  // 삭제된 카테고리를 쓰던 글은 분류 없음으로
  await db.prepare("UPDATE posts SET category='' WHERE newsletter_id=? AND category!='' AND strpos(','||?||',', ','||category||',')=0").run(req.nl.id, categories);
  back(res, `/app/n/${req.nl.id}/settings`, '저장했습니다.');
});
dash.post('/app/n/:nid/delete', async (req, res) => {
  await db.prepare('DELETE FROM newsletters WHERE id=?').run(req.nl.id);
  back(res, '/app', '뉴스레터를 삭제했습니다.');
});
