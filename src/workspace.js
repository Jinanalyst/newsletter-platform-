// 뉴스레터 설정의 확장 기능: lett.live 서브도메인 · 커스텀 도메인(Hostinger 등) · API 키와 공개 API · 팀원 초대
import { Router } from 'express';
import express from 'express';
import dns from 'node:dns/promises';
import { randomBytes, createHash } from 'node:crypto';
import { db, now, baseUrl } from './db.js';
import { requireUser } from './auth.js';
import { h } from './render.js';
import { sendMail } from './mail.js';
import { findNewsletter } from './access.js';

export const workspace = Router();

const PLATFORM_DOMAIN = () => (process.env.PLATFORM_DOMAIN || 'lett.live').toLowerCase();
const MAX_TEAM = 5, MAX_KEYS = 5;
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'mail', 'smtp', 'ftp', 'cname', 'static', 'cdn', 'blog', 'help', 'support']);
const SUB_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const back = (res, path, m) => res.redirect(m ? path + '?m=' + encodeURIComponent(m) : path);

// ---------- 도메인으로 들어온 요청을 해당 뉴스레터로 연결 ----------
// <이름>.lett.live 또는 인증이 끝난 커스텀 도메인: / → /n/<slug>, /p/1 → /n/<slug>/p/1
const HOST_PATHS = /^\/(p\/|rss\.xml$|embed$|subscribe$)/;
export async function domainRouter(req, res, next) {
  try {
    const host = String(req.hostname || '').toLowerCase();
    const base = PLATFORM_DOMAIN();
    if (!host || host === base || host === 'www.' + base || host === 'localhost' || /^[\d.:]+$/.test(host)) return next();
    const nl = host.endsWith('.' + base)
      ? await db.prepare('SELECT slug FROM newsletters WHERE subdomain=?').get(host.slice(0, -base.length - 1))
      : await db.prepare('SELECT slug FROM newsletters WHERE custom_domain=? AND domain_verified_at IS NOT NULL').get(host);
    if (!nl) return next();
    const [path, query] = req.url.split('?');
    if (path === '/' || HOST_PATHS.test(path)) req.url = `/n/${nl.slug}${path === '/' ? '' : path}${query ? '?' + query : ''}`;
    next();
  } catch (e) { next(e); }
}

// ---------- 설정 하위 화면 (소유자 전용) ----------
const owner = async (req, res, next) => {
  req.nl = await findNewsletter(req.params.nid, req.user);
  if (!req.nl) return res.status(404).page('없음', '<p>뉴스레터를 찾을 수 없습니다. <a href="/app">내 뉴스레터</a></p>');
  if (!req.nl.is_owner) return res.status(403).page('권한 없음', '<p>소유자만 할 수 있는 작업입니다. <a href="/app">내 뉴스레터</a></p>');
  next();
};
const S = '/app/n/:nid/settings';
workspace.use('/app/n/:nid/settings', requireUser, owner);

export const settingsTabs = (nl, on) => `<div class="row" style="margin:6px 0 18px;gap:6px">${[['', '일반'], ['domain', '도메인'], ['api', 'API'], ['team', '팀원']]
  .map(([p, l]) => `<a class="btn sm${on === p ? ' primary' : ''}" href="/app/n/${nl.id}/settings${p ? '/' + p : ''}">${l}</a>`).join('')}</div>`;
const shell = (req, res, on, title, body) => res.page('설정', `<h1>${title}</h1>${settingsTabs(req.nl, on)}${body}`, { nl: req.nl, active: 'settings', msg: req.query.m });
const here = (req, p) => `/app/n/${req.nl.id}/settings/${p}`;

// ----- 도메인 -----
const hostingerUrl = () => process.env.HOSTINGER_URL || 'https://www.hostinger.com/domain-name-search';
// 접속을 이 서비스(Vercel)로 연결하는 레코드 값. 다른 호스팅이면 환경 변수로 바꾼다
const dnsTarget = () => process.env.CUSTOM_DOMAIN_TARGET || 'cname.vercel-dns.com';
const dnsIp = () => process.env.CUSTOM_DOMAIN_IP || '76.76.21.21';
const dnsCheckUrl = (type, name) => `https://dnschecker.org/#${type}/${encodeURIComponent(name)}`;
const rec = (type, host, value) => `<tr><td><b>${type}</b></td><td><code>${h(host)}</code></td><td><code>${h(value)}</code></td></tr>`;

workspace.get(S + '/domain', (req, res) => {
  const nl = req.nl, base = PLATFORM_DOMAIN();
  const verified = !!nl.domain_verified_at;
  const target = dnsTarget(), ip = dnsIp();
  shell(req, res, 'domain', '도메인', `
<form class="card" method="post" action="${here(req, 'domain/subdomain')}">
<b>${base} 주소</b><p class="mute">별도 도메인 없이 바로 쓸 수 있는 무료 주소예요.</p>
<div class="row nowrap"><input name="subdomain" value="${h(nl.subdomain)}" placeholder="my-letter" pattern="[a-z0-9][a-z0-9\\-]{2,29}" maxlength="30" style="max-width:240px"><span class="mute">.${base}</span><button class="primary">저장</button></div>
${nl.subdomain ? `<p class="mute" style="margin:10px 0 0">현재 주소: <a href="https://${h(nl.subdomain)}.${base}" target="_blank" rel="noopener">https://${h(nl.subdomain)}.${base}</a></p>` : '<p class="mute" style="margin:10px 0 0">영문 소문자·숫자·하이픈, 3~30자. 비우고 저장하면 해제됩니다.</p>'}</form>

<div class="card"><b>커스텀 도메인</b>
<p class="mute">내가 가진 도메인(예: <code>news.mysite.com</code>)으로 공개 페이지를 열 수 있어요. 도메인이 없다면 Hostinger 같은 곳에서 구입한 뒤 아래 DNS 설정을 하면 됩니다.</p>
<p><a class="btn sm" href="${h(hostingerUrl())}" target="_blank" rel="noopener">Hostinger에서 도메인 구입 ↗</a></p>
${nl.custom_domain ? `
<div class="row" style="margin:14px 0 4px"><b>${h(nl.custom_domain)}</b>
<span class="mute">${verified ? '✓ 연결 확인됨 (' + h(nl.domain_verified_at.slice(0, 10)) + ')' : '연결 대기 중 — DNS 설정 후 확인하세요'}</span></div>
${verified ? `<p>공개 페이지: <a href="https://${h(nl.custom_domain)}" target="_blank" rel="noopener">https://${h(nl.custom_domain)}</a></p>` : ''}
<h3 style="margin:18px 0 8px">DNS 레코드 설정 (Hostinger 기준)</h3>
<ol class="mute" style="line-height:1.8;padding-left:20px;margin-top:0">
<li><a href="https://hpanel.hostinger.com/" target="_blank" rel="noopener">hPanel</a> 로그인 → <b>도메인</b> → 해당 도메인 선택 → <b>DNS / 네임서버</b> → <b>DNS 레코드</b></li>
<li>아래 레코드를 추가합니다. 같은 이름의 기존 A·CNAME 레코드가 있으면 먼저 삭제하세요.</li>
<li>저장 후 반영까지 몇 분~최대 24시간이 걸릴 수 있어요. 그 뒤 <b>연결 확인</b>을 누르세요.</li></ol>
<table><thead><tr><th>유형</th><th>이름(호스트)</th><th>값</th></tr></thead><tbody>
${rec('TXT', '_lett-verify', 'lett-verify=' + nl.domain_token)}
${nl.custom_domain.split('.').length > 2 ? rec('CNAME', nl.custom_domain.split('.')[0], target) : (ip ? rec('A', '@', ip) : '') + rec('CNAME', 'www', target)}
</tbody></table>
<p class="mute">TXT 레코드는 도메인 소유 확인용이고, ${nl.custom_domain.split('.').length > 2 ? 'CNAME은 하위 도메인을 lett.로 연결' : 'A(또는 CNAME) 레코드는 접속을 lett.로 연결'}합니다. Hostinger의 이름 칸에는 도메인 전체가 아니라 위 이름만 입력하세요.</p>
<p class="mute" style="margin:0 0 10px">DNS가 반영됐는지 전 세계 서버에서 미리 확인해 볼 수 있어요:
<a href="${dnsCheckUrl('TXT', '_lett-verify.' + nl.custom_domain)}" target="_blank" rel="noopener">TXT 확인 ↗</a> ·
<a href="${dnsCheckUrl(nl.custom_domain.split('.').length > 2 ? 'CNAME' : 'A', nl.custom_domain)}" target="_blank" rel="noopener">${nl.custom_domain.split('.').length > 2 ? 'CNAME' : 'A'} 확인 ↗</a> (dnschecker.org)</p>
<div class="row"><form method="post" action="${here(req, 'domain/verify')}" style="margin:0"><button class="primary">연결 확인</button></form>
<form method="post" action="${here(req, 'domain/remove')}" style="margin:0" onsubmit="return confirm('커스텀 도메인 연결을 해제할까요?')"><button class="danger">연결 해제</button></form></div>`
    : `<form method="post" action="${here(req, 'domain/custom')}" class="row nowrap" style="margin-top:8px"><input name="domain" placeholder="news.mysite.com" required maxlength="120" style="max-width:320px"><button class="primary">도메인 연결</button></form>
<h3 style="margin:22px 0 8px">연결 순서 (Hostinger 기준)</h3>
<ol class="mute" style="line-height:1.8;padding-left:20px;margin-top:0">
<li>위 칸에 연결할 도메인을 입력하고 <b>도메인 연결</b>을 누르세요. 그러면 내 도메인에 맞는 DNS 레코드 값이 여기에 나타납니다.</li>
<li><a href="https://hpanel.hostinger.com/" target="_blank" rel="noopener">hPanel</a> → <b>도메인</b> → 내 도메인 → <b>DNS / 네임서버</b> → <b>DNS 레코드</b>에서 아래와 같은 레코드를 추가하세요.</li>
<li>저장 후 반영까지 몇 분~24시간이 걸립니다. 이 화면으로 돌아와 <b>연결 확인</b>을 누르면 연결이 끝나요.</li></ol>
<table><thead><tr><th>용도</th><th>유형</th><th>이름(호스트)</th><th>값</th></tr></thead><tbody>
<tr><td>소유 확인</td><td><b>TXT</b></td><td><code>_lett-verify</code></td><td class="mute">도메인 입력 후 표시되는 값</td></tr>
<tr><td>하위 도메인 연결<br><span class="mute">(news.mysite.com)</span></td><td><b>CNAME</b></td><td><code>news</code></td><td><code>${h(dnsTarget())}</code></td></tr>
<tr><td>루트 도메인 연결<br><span class="mute">(mysite.com)</span></td><td><b>A</b></td><td><code>@</code></td><td><code>${h(dnsIp())}</code></td></tr></tbody></table>
<p class="mute">Hostinger의 이름 칸에는 도메인 전체가 아니라 위의 이름만 입력하세요. 같은 이름의 기존 A·CNAME 레코드가 있으면 먼저 삭제해야 합니다. 도메인이 없다면 위의 Hostinger 버튼으로 먼저 구입하세요.</p>`}
</div>`);
});

workspace.post(S + '/domain/subdomain', async (req, res) => {
  const sub = String(req.body.subdomain || '').trim().toLowerCase();
  const to = (m) => back(res, here(req, 'domain'), m);
  if (sub && (!SUB_RE.test(sub) || RESERVED.has(sub))) return to('사용할 수 없는 주소입니다. 영문 소문자·숫자·하이픈 3~30자로 입력하세요.');
  if (sub && await db.prepare('SELECT 1 FROM newsletters WHERE subdomain=? AND id<>?').get(sub, req.nl.id)) return to('이미 사용 중인 주소입니다.');
  await db.prepare('UPDATE newsletters SET subdomain=? WHERE id=?').run(sub, req.nl.id);
  to(sub ? '저장했습니다.' : '주소를 해제했습니다.');
});

workspace.post(S + '/domain/custom', async (req, res) => {
  const d = String(req.body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const to = (m) => back(res, here(req, 'domain'), m);
  if (!DOMAIN_RE.test(d)) return to('도메인 형식이 올바르지 않습니다. 예: news.mysite.com');
  const base = PLATFORM_DOMAIN();
  if (d === base || d.endsWith('.' + base)) return to(`${base} 주소는 위의 서브도메인 칸에서 설정하세요.`);
  if (await db.prepare('SELECT 1 FROM newsletters WHERE custom_domain=? AND id<>?').get(d, req.nl.id)) return to('이미 다른 뉴스레터에 연결된 도메인입니다.');
  await db.prepare('UPDATE newsletters SET custom_domain=?, domain_token=?, domain_verified_at=NULL WHERE id=?').run(d, randomBytes(12).toString('hex'), req.nl.id);
  to('도메인을 등록했습니다. 아래 DNS 레코드를 설정해 주세요.');
});

// Vercel 프로젝트에 도메인 추가/제거 (VERCEL_TOKEN·VERCEL_PROJECT_ID 가 있을 때만). 없으면 수동으로 Vercel 에 추가해야 한다
const vercelOn = () => !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
async function vercelDomain(method, domain) {
  const q = process.env.VERCEL_TEAM_ID ? '?teamId=' + encodeURIComponent(process.env.VERCEL_TEAM_ID) : '';
  const base = `https://api.vercel.com/v${method === 'POST' ? 10 : 9}/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains`;
  const r = await fetch(method === 'POST' ? base + q : `${base}/${encodeURIComponent(domain)}${q}`, {
    method, headers: { Authorization: 'Bearer ' + process.env.VERCEL_TOKEN, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ name: domain }) : undefined, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return '';
  const code = j.error?.code || '';
  if (method === 'POST' && (code === 'domain_already_in_project' || r.status === 409 && /already.*(this|your) project/i.test(j.error?.message || ''))) return '';
  if (method === 'DELETE' && r.status === 404) return '';
  console.error('Vercel 도메인 API 실패', method, domain, r.status, code, j.error?.message);
  return code === 'domain_already_in_use' || code === 'forbidden' ? (j.error?.message || code) : `Vercel 연동 오류 (${r.status} ${code})`;
}

workspace.post(S + '/domain/verify', async (req, res) => {
  const nl = req.nl, to = (m) => back(res, here(req, 'domain'), m);
  if (!nl.custom_domain) return to('연결된 도메인이 없습니다.');
  let txt = [];
  try { txt = (await dns.resolveTxt('_lett-verify.' + nl.custom_domain)).map((r) => r.join('')); }
  catch { return to('TXT 레코드를 찾지 못했습니다. DNS 반영에는 시간이 걸리니 잠시 후 다시 확인해 주세요.'); }
  if (!txt.includes('lett-verify=' + nl.domain_token)) return to('TXT 레코드 값이 일치하지 않습니다. 값을 다시 확인해 주세요.');
  if (vercelOn()) {
    const err = await vercelDomain('POST', nl.custom_domain).catch((e) => { console.error('Vercel 도메인 API 오류', e.message); return 'Vercel에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'; });
    if (err) return to('도메인 소유는 확인했지만 서버에 도메인을 추가하지 못했습니다: ' + err);
  }
  await db.prepare('UPDATE newsletters SET domain_verified_at=? WHERE id=?').run(now(), nl.id);
  to(vercelOn() ? '도메인을 연결했습니다. HTTPS 인증서 발급에 몇 분 걸릴 수 있어요.' : '도메인 소유를 확인했습니다. 이제 이 도메인으로 접속할 수 있어요.');
});

workspace.post(S + '/domain/remove', async (req, res) => {
  if (vercelOn() && req.nl.custom_domain && req.nl.domain_verified_at) await vercelDomain('DELETE', req.nl.custom_domain).catch((e) => console.error('Vercel 도메인 제거 오류', e.message));
  await db.prepare("UPDATE newsletters SET custom_domain='', domain_token='', domain_verified_at=NULL WHERE id=?").run(req.nl.id);
  back(res, here(req, 'domain'), '연결을 해제했습니다.');
});

// ----- API 키 -----
workspace.get(S + '/api', async (req, res) => {
  const keys = await db.prepare('SELECT * FROM api_keys WHERE newsletter_id=? ORDER BY id DESC').all(req.nl.id);
  const url = baseUrl();
  const newKey = req.query.k && /^lett_[A-Za-z0-9_-]+$/.test(req.query.k) ? req.query.k : '';
  shell(req, res, 'api', 'API', `
${newKey ? `<div class="card" style="border-color:#3B82F6"><b>새 API 키</b><p class="mute">이 키는 지금 한 번만 보여드려요. 안전한 곳에 복사해 두세요.</p><code style="word-break:break-all;display:block;padding:10px;background:#F1F5F9;border-radius:8px">${h(newKey)}</code></div>` : ''}
<div class="card"><b>API 키</b><p class="mute">이 뉴스레터의 구독자·글을 외부 서비스에서 읽고 추가할 수 있어요. 키는 최대 ${MAX_KEYS}개까지 만들 수 있습니다.</p>
<form method="post" action="${here(req, 'api/create')}" class="row nowrap"><input name="name" placeholder="키 이름 (예: 회원가입 연동)" maxlength="40" required style="max-width:300px"><button class="primary">키 만들기</button></form>
${keys.length ? `<table style="margin-top:14px"><thead><tr><th>이름</th><th>키</th><th>마지막 사용</th><th></th></tr></thead><tbody>${keys.map((k) => `<tr><td>${h(k.name)}</td><td><code>${h(k.prefix)}…</code></td><td class="mute">${k.last_used_at ? h(k.last_used_at.slice(0, 16).replace('T', ' ')) : '—'}</td>
<td style="text-align:right"><form method="post" action="${here(req, 'api/' + k.id + '/delete')}" style="margin:0" onsubmit="return confirm('이 키를 삭제하면 바로 사용할 수 없게 됩니다.')"><button class="danger sm">삭제</button></form></td></tr>`).join('')}</tbody></table>` : ''}</div>
<div class="card"><b>사용 방법</b><p class="mute">모든 요청에 <code>Authorization: Bearer 키</code> 헤더를 넣으세요. 응답은 JSON입니다.</p>
<pre style="overflow:auto;background:#0F172A;color:#E2E8F0;padding:14px;border-radius:10px;font-size:13px;line-height:1.6">GET  ${url}/api/v1/newsletter
GET  ${url}/api/v1/subscribers?status=active&amp;limit=100&amp;offset=0
POST ${url}/api/v1/subscribers   {"email":"a@b.com","name":"이름"}
GET  ${url}/api/v1/posts?limit=20

curl -H "Authorization: Bearer lett_..." ${url}/api/v1/subscribers</pre></div>`);
});

workspace.post(S + '/api/create', async (req, res) => {
  const n = (await db.prepare('SELECT COUNT(*) n FROM api_keys WHERE newsletter_id=?').get(req.nl.id)).n;
  if (n >= MAX_KEYS) return back(res, here(req, 'api'), `API 키는 최대 ${MAX_KEYS}개까지 만들 수 있습니다.`);
  const key = 'lett_' + randomBytes(24).toString('base64url');
  await db.prepare('INSERT INTO api_keys(newsletter_id,name,prefix,key_hash,created_at) VALUES(?,?,?,?,?)').run(req.nl.id, String(req.body.name || '').trim().slice(0, 40) || '이름 없음', key.slice(0, 10), sha(key), now());
  res.redirect(here(req, 'api') + '?k=' + key);
});
workspace.post(S + '/api/:kid/delete', async (req, res) => {
  await db.prepare('DELETE FROM api_keys WHERE id=? AND newsletter_id=?').run(req.params.kid, req.nl.id);
  back(res, here(req, 'api'), '키를 삭제했습니다.');
});

// ----- 팀원 -----
const inviteLink = (t) => `${baseUrl()}/team/accept/${t}`;
workspace.get(S + '/team', async (req, res) => {
  const list = await db.prepare(`SELECT m.*, u.name AS uname FROM team_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.newsletter_id=? ORDER BY m.id`).all(req.nl.id);
  shell(req, res, 'team', '팀원', `
<div class="card"><b>팀원 초대</b><p class="mute">초대한 팀원은 글 작성·발송, 구독자·자동화 관리 등 운영 화면을 쓸 수 있어요. 설정(도메인·API·팀)과 삭제는 소유자만 할 수 있습니다. 소유자 외 최대 ${MAX_TEAM}명.</p>
<form method="post" action="${here(req, 'team/invite')}" class="row nowrap"><input type="email" name="email" placeholder="초대할 이메일" required style="max-width:320px"><button class="primary">초대 보내기</button></form></div>
<div class="card"><b>팀원 (${list.length}/${MAX_TEAM})</b>
${list.length ? `<table style="margin-top:10px"><tbody>${list.map((m) => `<tr><td>${h(m.email)}${m.uname ? ` <span class="mute">${h(m.uname)}</span>` : ''}</td>
<td class="mute">${m.status === 'active' ? '참여 중' : `초대 대기 중 · <a href="${h(inviteLink(m.token))}">초대 링크</a>`}</td>
<td style="text-align:right"><form method="post" action="${here(req, 'team/' + m.id + '/remove')}" style="margin:0"><button class="danger sm">${m.status === 'active' ? '내보내기' : '초대 취소'}</button></form></td></tr>`).join('')}</tbody></table>` : '<p class="mute">아직 팀원이 없습니다.</p>'}</div>`);
});

workspace.post(S + '/team/invite', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const to = (m) => back(res, here(req, 'team'), m);
  if (!EMAIL_RE.test(email)) return to('이메일 형식이 올바르지 않습니다.');
  if (email === req.user.email.toLowerCase()) return to('본인은 이미 소유자입니다.');
  if (await db.prepare('SELECT 1 FROM team_members WHERE newsletter_id=? AND email=?').get(req.nl.id, email)) return to('이미 초대한 이메일입니다.');
  if ((await db.prepare('SELECT COUNT(*) n FROM team_members WHERE newsletter_id=?').get(req.nl.id)).n >= MAX_TEAM) return to(`팀원은 최대 ${MAX_TEAM}명까지 초대할 수 있습니다.`);
  const token = randomBytes(24).toString('base64url');
  await db.prepare('INSERT INTO team_members(newsletter_id,email,token,created_at) VALUES(?,?,?,?)').run(req.nl.id, email, token, now());
  const link = inviteLink(token);
  try {
    await sendMail({ to: email, subject: `[lett.] ${req.nl.name} 팀 초대`, fromName: 'lett.',
      html: `<p>${h(req.user.name || req.user.email)}님이 <b>${h(req.nl.name)}</b> 뉴스레터 팀에 초대했어요.</p><p><a href="${link}">초대 수락하기</a></p><p>이 이메일(${h(email)})로 가입·로그인한 계정에서만 수락할 수 있습니다.</p>`,
      text: `${req.nl.name} 팀 초대: ${link}` });
    to('초대 메일을 보냈습니다.');
  } catch (e) { console.error('초대 메일 실패', e.message); to('초대를 만들었지만 메일 발송에 실패했어요. 아래 초대 링크를 직접 전달해 주세요.'); }
});
workspace.post(S + '/team/:mid/remove', async (req, res) => {
  await db.prepare('DELETE FROM team_members WHERE id=? AND newsletter_id=?').run(req.params.mid, req.nl.id);
  back(res, here(req, 'team'), '처리했습니다.');
});

// 초대 수락: 초대받은 이메일의 계정으로 로그인해야 한다. GET 은 확인 화면만, 실제 수락은 POST
const invite = async (token) => await db.prepare(`SELECT m.*, n.name AS nl_name FROM team_members m JOIN newsletters n ON n.id=m.newsletter_id WHERE m.token=?`).get(String(token));
workspace.get('/team/accept/:token', async (req, res) => {
  const m = await invite(req.params.token);
  if (!m) return res.status(404).page('초대', '<h1>초대를 찾을 수 없습니다</h1><p class="mute">취소되었거나 잘못된 링크예요.</p>');
  if (!req.user) return res.page('초대', `<h1>${h(m.nl_name)} 팀 초대</h1><p class="mute">초대받은 이메일(${h(m.email)})로 로그인하거나 가입한 뒤, 이 링크를 다시 열어 주세요.</p><p><a class="btn primary" href="/login">로그인</a> <a class="btn" href="/signup">가입</a></p>`);
  if (req.user.email.toLowerCase() !== m.email) return res.status(403).page('초대', `<h1>다른 계정으로 로그인되어 있어요</h1><p class="mute">이 초대는 ${h(m.email)} 주소로 보낸 거예요. 현재 계정: ${h(req.user.email)}</p>`);
  if (m.status === 'active') return res.redirect(`/app/n/${m.newsletter_id}`);
  res.page('초대', `<h1>${h(m.nl_name)} 팀 초대</h1><p class="mute">수락하면 이 뉴스레터의 글·구독자·자동화를 함께 운영할 수 있어요.</p>
<form method="post" action="/team/accept/${h(req.params.token)}"><button class="primary">초대 수락</button></form>`);
});
workspace.post('/team/accept/:token', requireUser, async (req, res) => {
  const m = await invite(req.params.token);
  if (!m || req.user.email.toLowerCase() !== m.email) return res.status(403).page('초대', '<h1>수락할 수 없는 초대입니다</h1>');
  await db.prepare("UPDATE team_members SET status='active', user_id=? WHERE id=?").run(req.user.id, m.id);
  res.redirect(`/app/n/${m.newsletter_id}`);
});

// ---------- 공개 API (/api/v1) ----------
export const api = Router();
api.use('/api/v1', express.json({ limit: '100kb' }));
api.use('/api/v1', async (req, res, next) => {
  const key = (/^Bearer (lett_[A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '') || [])[1];
  const row = key && await db.prepare('SELECT k.id, n.* FROM api_keys k JOIN newsletters n ON n.id=k.newsletter_id WHERE k.key_hash=?').get(sha(key));
  if (!row) return res.status(401).json({ error: 'invalid_api_key', message: 'Authorization: Bearer <API 키> 헤더가 필요합니다.' });
  req.apiNl = row;
  await db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=?').run(now(), row.id);
  next();
});
const page = (req) => ({ limit: Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50)), offset: Math.max(0, parseInt(req.query.offset, 10) || 0) });

api.get('/api/v1/newsletter', (req, res) => {
  const n = req.apiNl;
  res.json({ id: n.id, slug: n.slug, name: n.name, description: n.description, url: `${baseUrl()}/n/${n.slug}`, created_at: n.created_at });
});
api.get('/api/v1/subscribers', async (req, res) => {
  const { limit, offset } = page(req);
  const status = ['active', 'pending', 'unsubscribed'].includes(req.query.status) ? req.query.status : '';
  const args = status ? [req.apiNl.id, status, limit, offset] : [req.apiNl.id, limit, offset];
  const rows = await db.prepare(`SELECT id,email,name,status,tier,source,created_at FROM subscribers WHERE newsletter_id=?${status ? ' AND status=?' : ''} ORDER BY id LIMIT ? OFFSET ?`).all(...args);
  res.json({ data: rows, limit, offset });
});
api.post('/api/v1/subscribers', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const added = (await db.prepare("INSERT OR IGNORE INTO subscribers(newsletter_id,email,name,status,token,source,created_at,confirmed_at) VALUES(?,?,?,'active',?,?,?,?)")
    .run(req.apiNl.id, email, String(req.body?.name || '').slice(0, 80), randomBytes(18).toString('base64url'), 'api', now(), now())).changes;
  res.status(added ? 201 : 200).json({ email, created: !!added });
});
api.get('/api/v1/posts', async (req, res) => {
  const { limit, offset } = page(req);
  const rows = await db.prepare("SELECT id,subject,preview,category,tags,sent_at FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent' ORDER BY sent_at DESC LIMIT ? OFFSET ?").all(req.apiNl.id, limit, offset);
  res.json({ data: rows.map((p) => ({ ...p, url: `${baseUrl()}/n/${req.apiNl.slug}/p/${p.id}` })), limit, offset });
});
api.use('/api/v1', (req, res) => res.status(404).json({ error: 'not_found' }));
