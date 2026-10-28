import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, now, baseUrl, isPaid, hasPaid } from './db.js';
import { enrollSubscriber } from './send.js';
import { sbEnabled } from './supabase.js';
import { landingPage } from './landing.js';
import { won } from './billing.js';
import { sendMail } from './mail.js';
import { renderPost, h, personalize } from './render.js';
import { page, fmt } from './views.js';
import { hashPw, checkPw, login, cookie, tooManyTries, limitHits, requireUser, createToken, checkToken, sendVerification, sendReset, cooldown } from './auth.js';

export const pub = Router();
const newToken = () => randomBytes(18).toString('base64url');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const note = (m) => '?m=' + encodeURIComponent(m);
const googleOn = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// ---------- 플랫폼 홈 ----------
pub.get('/', async (req, res) => {
  const list = await db.prepare(`SELECT n.*, u.name AS owner,
      (SELECT COUNT(*) FROM subscribers s WHERE s.newsletter_id=n.id AND s.status='active') AS subs,
      (SELECT COUNT(*) FROM posts p WHERE p.newsletter_id=n.id AND p.status='sent') AS posts
    FROM newsletters n JOIN users u ON u.id=n.owner_id WHERE u.verified=1 ORDER BY n.id DESC LIMIT 30`).all();
  res.send(landingPage({ user: req.user, list }));
});

// ---------- 회원: 이메일 가입 / 로그인 / 소셜 ----------
const authForm = (kind, msg, res, next = '') => {
  const signup = kind === 'signup';
  res.page(signup ? '가입' : '로그인', `<h1>${signup ? '시작하기' : '로그인'}</h1>
<form class="card" method="post">
${signup ? '<label>이름</label><input name="name" required maxlength="60" autocomplete="name">' : ''}
<label>이메일</label><input type="email" name="email" required autocomplete="email">
<label>비밀번호${signup ? ' (8자 이상)' : ''}</label><input type="password" name="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">
<p><button class="primary">${signup ? '가입하기' : '로그인'}</button></p></form>
${googleOn() || sbEnabled() ? '<p><a class="btn" href="/auth/google">Google로 계속하기</a></p>' : '<p class="mute">Google 로그인은 .env에 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET을 설정하면 활성화됩니다.</p>'}
<p class="mute">${signup ? '이미 계정이 있나요? <a href="/login">로그인</a>' : '계정이 없나요? <a href="/signup">가입하기</a> · <a href="/forgot">비밀번호를 잊으셨나요?</a>'}</p>`, { msg });
};
pub.get('/signup', (req, res) => (req.user ? res.redirect('/app') : authForm('signup', req.query.m, res)));
pub.get('/login', (req, res) => (req.user ? res.redirect('/app') : authForm('login', req.query.m, res)));

pub.post('/signup', async (req, res) => {
  if (await tooManyTries(req.ip, true)) return res.status(429).send('잠시 후 다시 시도하세요.');
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.redirect('/signup' + note('이메일 형식이 올바르지 않습니다.'));
  if (pw.length < 8) return res.redirect('/signup' + note('비밀번호는 8자 이상이어야 합니다.'));
  if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.redirect('/signup' + note('이미 가입된 이메일입니다. 로그인해 주세요.'));
  const id = Number((await db.prepare('INSERT INTO users(email,name,pw_hash,created_at) VALUES(?,?,?,?)')
    .run(email, String(req.body.name || '').trim().slice(0, 60), hashPw(pw), now())).lastInsertRowid);
  await login(res, id);
  sendVerification({ id, email }).catch((e) => console.error('인증 메일 실패', e.message));
  res.redirect('/app/new' + note('가입 완료! 인증 메일을 보냈습니다. 인증 전에는 메일 발송이 제한됩니다.'));
});

// ----- 이메일 인증 -----
pub.get('/verify/:token', async (req, res) => {
  const uid = await checkToken(req.params.token, 'verify', true);
  if (!uid) return res.status(400).page('인증 실패', '<h1>링크가 만료되었거나 올바르지 않습니다</h1><p>로그인 후 인증 메일을 다시 받아주세요.</p>');
  await db.prepare('UPDATE users SET verified=1 WHERE id=?').run(uid);
  res.page('인증 완료', '<h1>이메일 인증이 완료되었습니다</h1><p><a class="btn primary" href="/app">내 뉴스레터로 이동</a></p>');
});
pub.post('/app/resend-verification', requireUser, async (req, res) => {
  if (req.user.verified) return res.redirect('/app');
  const ok = await cooldown(`verify:${req.user.id}`, 60_000);
  if (ok) sendVerification(req.user).catch((e) => console.error('인증 메일 실패', e.message));
  res.redirect('/app' + note(ok ? '인증 메일을 다시 보냈습니다.' : '잠시 후(1분) 다시 시도해 주세요.'));
});

// ----- 비밀번호 재설정 -----
pub.get('/forgot', (req, res) => res.page('비밀번호 찾기', `<h1>비밀번호 재설정</h1><p class="mute">가입한 이메일로 재설정 링크를 보내드립니다.</p>
<form class="card" method="post"><label>이메일</label><input type="email" name="email" required><p><button class="primary">링크 받기</button></p></form>`, { msg: req.query.m }));
pub.post('/forgot', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  // 계정 존재 여부가 드러나지 않도록 항상 같은 응답. IP·이메일별 쿨다운으로 메일 폭탄 방지
  if (await cooldown(`forgot-ip:${req.ip}`, 10_000) && await cooldown(`forgot:${email}`, 60_000)) {
    const u = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u) sendReset(u).catch((e) => console.error('재설정 메일 실패', e.message));
  }
  res.redirect('/forgot' + note('가입된 주소라면 재설정 링크를 보냈습니다. 메일함을 확인하세요.'));
});
pub.get('/reset/:token', async (req, res) => {
  if (!await checkToken(req.params.token, 'reset')) return res.status(400).page('재설정', '<h1>링크가 만료되었거나 올바르지 않습니다</h1><p><a href="/forgot">다시 요청하기</a></p>');
  res.page('새 비밀번호', `<h1>새 비밀번호 설정</h1><form class="card" method="post"><label>새 비밀번호 (8자 이상)</label>
<input type="password" name="password" minlength="8" required autocomplete="new-password"><p><button class="primary">변경하기</button></p></form>`, { msg: req.query.m });
});
pub.post('/reset/:token', async (req, res) => {
  const pw = String(req.body.password || '');
  if (pw.length < 8) return res.redirect(`/reset/${encodeURIComponent(req.params.token)}` + note('비밀번호는 8자 이상이어야 합니다.'));
  const uid = await checkToken(req.params.token, 'reset', true);
  if (!uid) return res.status(400).page('재설정', '<h1>링크가 만료되었거나 올바르지 않습니다</h1><p><a href="/forgot">다시 요청하기</a></p>');
  // 비밀번호 변경 + 메일함 소유 확인됨(verified) + 기존 모든 로그인 무효화(sess_ver↑) + 남은 토큰 폐기
  await db.prepare('UPDATE users SET pw_hash=?, verified=1, sess_ver=sess_ver+1 WHERE id=?').run(hashPw(pw), uid);
  await db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(uid);
  await login(res, uid);
  res.redirect('/app' + note('비밀번호를 변경했습니다. 다른 기기의 로그인은 모두 해제되었습니다.'));
});
pub.post('/login', async (req, res) => {
  if (await tooManyTries(req.ip)) return res.status(429).send('시도 횟수 초과. 10분 후 다시 시도하세요.');
  const u = await db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').trim().toLowerCase());
  if (!u || !checkPw(String(req.body.password || ''), u.pw_hash)) {
    await tooManyTries(req.ip, true);
    return res.redirect('/login' + note('이메일 또는 비밀번호가 올바르지 않습니다.'));
  }
  await login(res, u.id);
  res.redirect('/app');
});
pub.post('/logout', (req, res) => { res.clearCookie('sid'); res.redirect('/'); });

// Google OAuth (환경변수 설정 시에만 동작)
pub.get('/auth/google', (req, res) => {
  if (!googleOn()) return res.redirect('/login' + note('Google 로그인이 설정되지 않았습니다.'));
  const state = newToken();
  res.cookie('oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600_000 });
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${baseUrl()}/auth/google/callback`,
    response_type: 'code', scope: 'openid email profile', state });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
});
pub.get('/auth/google/callback', async (req, res) => {
  try {
    if (!googleOn() || !req.query.code || req.query.state !== cookie(req, 'oauth_state')) throw new Error('state');
    res.clearCookie('oauth_state');
    const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: req.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${baseUrl()}/auth/google/callback`, grant_type: 'authorization_code' }) })).json();
    const p = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    if (!p.sub || !p.email || !p.email_verified) throw new Error('profile');
    let u = await db.prepare('SELECT * FROM users WHERE google_id=?').get(p.sub) || await db.prepare('SELECT * FROM users WHERE email=?').get(p.email.toLowerCase());
    // 미인증 상태로 선점된 계정(비밀번호를 아는 제3자)에 연결되지 않도록 비밀번호를 지우고 기존 로그인을 끊는다
    if (u && !u.verified) await db.prepare('UPDATE users SET pw_hash=NULL, sess_ver=sess_ver+1 WHERE id=?').run(u.id);
    if (u) await db.prepare('UPDATE users SET google_id=?, verified=1 WHERE id=?').run(p.sub, u.id); // Google이 이메일 소유를 확인함
    else u = { id: Number((await db.prepare('INSERT INTO users(email,name,google_id,verified,created_at) VALUES(?,?,?,1,?)').run(p.email.toLowerCase(), p.name || '', p.sub, now())).lastInsertRowid) };
    await login(res, u.id);
    res.redirect('/app');
  } catch {
    res.redirect('/login' + note('Google 로그인에 실패했습니다.'));
  }
});

// ---------- 뉴스레터 공개 페이지 ----------
const getNl = async (slug) => await db.prepare('SELECT n.*, u.name AS owner, u.bio AS owner_bio, u.verified AS owner_verified FROM newsletters n JOIN users u ON u.id=n.owner_id WHERE n.slug=?').get(slug);
const notFound = (res) => res.status(404).page('없음', '<h1>찾을 수 없습니다</h1><p><a href="/">홈으로</a></p>');

// 구독 폼 (공개 페이지·임베드 공용). 추천 코드는 ?ref= 로 들어와 폼에 실려 간다
const subForm = (nl, ref, embed = false) => `<form class="card" method="post" action="/n/${h(nl.slug)}/subscribe" ${embed ? 'target="_self"' : ''}>
<div class="honey"><input name="website" tabindex="-1" autocomplete="off"></div>
<input type="hidden" name="ref" value="${h(ref || '')}">${embed ? '<input type="hidden" name="embed" value="1">' : ''}
<div class="row"><input class="grow" type="email" name="email" required placeholder="이메일 주소"><input class="grow" name="name" placeholder="닉네임 (선택, 메일 인사말에 쓰여요)" maxlength="60">
<button class="primary">구독하기</button></div>
<p class="mute" style="margin:8px 0 0">언제든 메일 하단 링크로 해지할 수 있습니다.</p></form>`;

pub.get('/n/:slug', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return notFound(res);
  let posts = await db.prepare("SELECT * FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent' ORDER BY sent_at DESC").all(nl.id);
  const fc = String(req.query.c || ''), ft = String(req.query.tag || '');
  if (fc) posts = posts.filter((p) => p.category === fc);
  if (ft) posts = posts.filter((p) => p.tags.split(',').includes(ft));
  const cats = nl.categories.split(',').filter(Boolean);
  const filterBar = cats.length || fc || ft
    ? `<p class="mute"><a href="/n/${h(nl.slug)}"${!fc && !ft ? ' style="font-weight:600"' : ''}>전체</a>${cats.map((x) => ` · <a href="?c=${encodeURIComponent(x)}"${x === fc ? ' style="font-weight:600"' : ''}>${h(x)}</a>`).join('')}${ft ? ` · #${h(ft)}` : ''}</p>` : '';
  const accent = /^#[0-9a-f]{6}$/i.test(nl.accent) ? nl.accent : '#3B82F6';
  const abs = (u) => (!u ? '' : /^https?:/i.test(u) ? u : baseUrl() + u);
  const pageUrl = `${baseUrl()}/n/${nl.slug}`;
  const ogImg = abs(nl.cover || nl.logo);
  const bg = nl.cover
    ? `linear-gradient(rgba(15,23,42,.5),rgba(15,23,42,.8)),url('${h(nl.cover)}') center/cover`
    : `linear-gradient(135deg,${accent},color-mix(in srgb,${accent} 45%,#0F172A))`;
  const shareText = encodeURIComponent(`${nl.name} — ${nl.description}`.slice(0, 200));
  const lpCss = `<style>
body{background:var(--bg)}
.lp-hero{background:${bg};color:#fff;padding:72px 20px 88px;text-align:center}
.lp-hero .in{max-width:640px;margin:0 auto}
.lp-hero .logo{width:84px;height:84px;border-radius:22px;margin:0 auto 18px;display:block;border:2px solid rgba(255,255,255,.55)}
.lp-hero h1{font-size:clamp(30px,6vw,46px);margin:0;color:#fff;letter-spacing:-.03em}
.lp-hero .by{opacity:.8;margin:6px 0 0;font-size:14px}
.lp-hero .desc{font-size:18px;line-height:1.7;margin:22px auto 30px;max-width:540px;opacity:.95;white-space:pre-line}
.lp-hero form.card{text-align:left;margin:0;box-shadow:0 20px 50px -20px rgba(0,0,0,.5)}
.lp-hero .primary{background:${accent};border-color:${accent};color:#fff}
.lp-hero .note{opacity:.85;font-size:14px;margin:0 0 14px}
.lp-share{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:22px}
.lp-share a,.lp-share button{border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 16px;font-size:13px;text-decoration:none;cursor:pointer}
.lp-share a:hover,.lp-share button:hover{background:rgba(255,255,255,.25)}
.lp-main{max-width:680px;margin:0 auto;padding:40px 20px 72px}
.lp-main h2{margin-top:0}
.lp-foot{text-align:center;padding:0 20px 40px}
</style>`;
  res.page(nl.name, `<header class="lp-hero"><div class="in">
${nl.logo ? `<img class="logo" src="${h(nl.logo)}" alt="">` : ''}
<h1>${h(nl.name)}</h1><p class="by">by ${h(nl.owner || '발행자')}</p>
<p class="desc">${h(nl.description)}</p>
${req.query.ref ? '<p class="note">친구의 추천으로 방문하셨네요</p>' : ''}${req.query.m ? `<p class="note">${h(req.query.m)}</p>` : ''}${subForm(nl, req.query.ref)}
<div class="lp-share"><button type="button" id="lpshare">공유하기</button><button type="button" id="lpcopy">링크 복사</button>
<a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${shareText}" target="_blank" rel="noopener">X</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">Facebook</a></div>
</div></header>
<main class="lp-main">
${hasPaid(nl) ? `<p class="mute">유료 구독(${nl.price_monthly ? `월 ${won(nl.price_monthly)}` : ''}${nl.price_monthly && nl.price_yearly ? ' / ' : ''}${nl.price_yearly ? `연 ${won(nl.price_yearly)}` : ''})으로 전용 글을 읽을 수 있어요. 무료 구독 후 <a href="/n/${h(nl.slug)}/upgrade">유료 구독</a>에서 신청하세요.</p>` : ''}
<h2>아카이브</h2>${filterBar}${posts.length ? posts.map((p) => `<p><a href="/n/${h(nl.slug)}/p/${p.id}">${h(personalize(p.subject, null, { html: false }))}</a>${p.audience === 'paid' || p.body_md.includes('[[paywall]]') ? ' <span class="badge">유료</span>' : ''}<br><span class="mute">${fmt(p.sent_at)}${p.category ? ` · ${h(p.category)}` : ''}${p.tags ? ' ' + p.tags.split(',').map((t) => `<a href="?tag=${encodeURIComponent(t)}">#${h(t)}</a>`).join(' ') : ''}</span></p>`).join('')
    : '<p class="mute">아직 발행된 글이 없습니다.</p>'}
</main>
<footer class="lp-foot mute"><a href="/n/${h(nl.slug)}/rss.xml">RSS</a> · <a href="/">lett.</a>로 만든 뉴스레터</footer>
<script>
(function(){var u=${JSON.stringify(pageUrl)},t=${JSON.stringify(nl.name)};
var s=document.getElementById('lpshare');if(!navigator.share)s.style.display='none';else s.onclick=function(){navigator.share({title:t,url:u}).catch(function(){})};
var c=document.getElementById('lpcopy');c.onclick=function(){(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){c.textContent='복사됨 ✓'},function(){prompt('링크를 복사하세요',u)})}})();
</script>`,
  { bare: true, head: `${lpCss}<link rel="alternate" type="application/rss+xml" href="/n/${h(nl.slug)}/rss.xml">
<link rel="canonical" href="${h(pageUrl)}"><meta name="description" content="${h(nl.description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="lett."><meta property="og:url" content="${h(pageUrl)}">
<meta property="og:title" content="${h(nl.name)}"><meta property="og:description" content="${h(nl.description)}">${ogImg ? `<meta property="og:image" content="${h(ogImg)}">` : ''}
<meta name="twitter:card" content="${nl.cover ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${h(nl.name)}"><meta name="twitter:description" content="${h(nl.description)}">${ogImg ? `<meta name="twitter:image" content="${h(ogImg)}">` : ''}
<meta name="theme-color" content="${accent}">` });
});

// 외부 사이트에 iframe으로 넣는 구독 폼
pub.get('/n/:slug/embed', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return notFound(res);
  res.send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;padding:8px;font:15px -apple-system,'Segoe UI','Malgun Gothic',sans-serif}.card{border:1px solid #e8e3db;border-radius:12px;padding:14px}
.row{display:flex;gap:8px;flex-wrap:wrap}.grow{flex:1 1 160px}input{padding:9px;border:1px solid #ccc;border-radius:8px;font:inherit}
button{padding:9px 16px;border:0;border-radius:8px;background:#c2410c;color:#fff;font:inherit;cursor:pointer}.mute{color:#888;font-size:13px}.honey{position:absolute;left:-9999px}</style></head>
<body><b>${h(nl.name)}</b>${req.query.m ? `<p style="color:#c2410c">${h(req.query.m)}</p>` : ''}${subForm(nl, req.query.ref, true)}</body></html>`);
});

pub.get('/n/:slug/p/:id', async (req, res) => {
  const nl = await getNl(req.params.slug);
  const post = nl && await db.prepare("SELECT * FROM posts WHERE id=? AND newsletter_id=? AND kind='post' AND status='sent'").get(req.params.id, nl.id);
  if (!post) return notFound(res);
  // 메일에서 온 구독자 토큰(?t=)이 유료 구독자이면 전체 공개
  const viewer = req.query.t && await db.prepare("SELECT * FROM subscribers WHERE token=? AND newsletter_id=? AND status='active'").get(String(req.query.t), nl.id);
  res.send(await renderPost(post, nl, { mode: 'web', canRead: isPaid(viewer) }));
});

// 구독자 개인 페이지: 추천 링크와 현황
const ensureRef = async (sub) => {
  if (sub.ref_code) return sub.ref_code;
  const code = randomBytes(5).toString('hex');
  await db.prepare('UPDATE subscribers SET ref_code=? WHERE id=?').run(code, sub.id);
  return code;
};
pub.get('/r/:token', async (req, res) => {
  const sub = await db.prepare('SELECT * FROM subscribers WHERE token=?').get(req.params.token);
  const nl = sub && await db.prepare('SELECT * FROM newsletters WHERE id=?').get(sub.newsletter_id);
  if (!nl) return notFound(res);
  const link = `${baseUrl()}/n/${nl.slug}?ref=${await ensureRef(sub)}`;
  const n = (await db.prepare("SELECT COUNT(*) n FROM subscribers WHERE referred_by=? AND status='active'").get(sub.id)).n;
  const tiers = nl.rewards.split('\n').map((l) => { const i = l.indexOf(':'); return [Number(l.slice(0, i)), l.slice(i + 1)]; }).filter((t) => t[0] > 0).sort((a, b) => a[0] - b[0]);
  res.page('친구 추천', `<h1>${h(nl.name)} 친구 추천</h1><p>아래 링크로 친구가 구독하면 추천 수가 올라갑니다.</p>
<div class="card"><input readonly value="${h(link)}" onclick="this.select()"><p style="margin-bottom:0"><b style="font-size:28px">${n}</b>명 추천 완료</p></div>
${tiers.length ? `<h2>보상</h2><div class="card">${tiers.map(([k, v]) => `<p>${n >= k ? '✅' : '⬜'} 추천 ${k}명 — ${h(v)}${n >= k ? '' : ` <span class="mute">(${k - n}명 남음)</span>`}</p>`).join('')}</div>` : ''}
<p><a href="/n/${h(nl.slug)}">← ${h(nl.name)}</a></p>`);
});

pub.get('/n/:slug/rss.xml', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return notFound(res);
  const base = baseUrl();
  const items = (await db.prepare("SELECT * FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent' ORDER BY sent_at DESC LIMIT 30").all(nl.id))
    .map((p) => `<item><title>${h(p.subject)}</title><link>${base}/n/${h(nl.slug)}/p/${p.id}</link><guid>${base}/n/${h(nl.slug)}/p/${p.id}</guid>
<pubDate>${new Date(p.sent_at).toUTCString()}</pubDate><description>${h(p.preview)}</description>${[p.category, ...p.tags.split(',')].filter(Boolean).map((t) => `<category>${h(t)}</category>`).join('')}</item>`).join('\n');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${h(nl.name)}</title>
<link>${base}/n/${h(nl.slug)}</link><description>${h(nl.description)}</description>${items}</channel></rss>`);
});

// ---------- 구독 신청 / 확인 / 해지 ----------
const limited = async (ip) => await limitHits('sub:' + ip, 60_000, 5); // IP당 분당 5회 (DB 기반)

pub.post('/n/:slug/subscribe', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return notFound(res);
  const back = (m) => res.redirect(`/n/${nl.slug}${req.body.embed ? '/embed' : ''}` + note(m));
  if (!nl.owner_verified) return back('이 뉴스레터는 아직 구독을 받을 준비가 되지 않았습니다.');
  if (req.body.website) return back('확인 메일을 보냈습니다.'); // 허니팟
  if (await limited(req.ip)) return res.status(429).send('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  const addr = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return back('이메일 형식이 올바르지 않습니다.');
  const name = String(req.body.name || '').trim().slice(0, 80);

  let sub = await db.prepare('SELECT * FROM subscribers WHERE newsletter_id=? AND email=?').get(nl.id, addr);
  if (sub?.status === 'active') return back('이미 구독 중입니다.');
  if (sub) await db.prepare("UPDATE subscribers SET status='pending', name=COALESCE(NULLIF(?,''),name), unsub_at=NULL WHERE id=?").run(name, sub.id);
  else {
    const referrer = req.body.ref && await db.prepare('SELECT id FROM subscribers WHERE ref_code=? AND newsletter_id=?').get(String(req.body.ref).slice(0, 20), nl.id);
    await db.prepare('INSERT INTO subscribers(newsletter_id,email,name,token,created_at,referred_by) VALUES(?,?,?,?,?,?)')
      .run(nl.id, addr, name, newToken(), now(), referrer?.id ?? null);
    sub = await db.prepare('SELECT * FROM subscribers WHERE newsletter_id=? AND email=?').get(nl.id, addr);
  }
  // 남용 방지: 같은 주소에는 10분에 한 번, 뉴스레터당 하루 200통까지만 확인 메일 발송
  const since = new Date(Date.now() - 864e5).toISOString();
  const today = (await db.prepare('SELECT COUNT(*) n FROM subscribers WHERE newsletter_id=? AND confirm_sent_at>?').get(nl.id, since)).n;
  if (sub.confirm_sent_at && Date.now() - new Date(sub.confirm_sent_at).getTime() < 600_000)
    return back('확인 메일을 이미 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.');
  if (today >= 200) return back('오늘은 신규 구독 신청이 많아 잠시 후 다시 시도해 주세요.');
  await db.prepare('UPDATE subscribers SET confirm_sent_at=? WHERE id=?').run(now(), sub.id);
  const link = `${baseUrl()}/confirm/${sub.token}`;
  sendMail({
    to: addr, subject: `[${nl.name}] 구독 확인`, fromName: nl.name,
    html: `<p>${h(nl.name)} 구독을 확정하려면 아래 링크를 눌러주세요.</p><p><a href="${link}">구독 확인하기</a></p><p>본인이 요청하지 않았다면 무시하세요.</p>`,
    text: `구독 확인: ${link}`,
  }).catch((e) => console.error('확인 메일 실패', e.message));
  back('확인 메일을 보냈습니다. 메일의 링크를 눌러 구독을 완료하세요.');
});

pub.get('/confirm/:token', async (req, res) => {
  const sub = await db.prepare('SELECT s.*, n.slug, n.name AS nl_name FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE s.token=?').get(req.params.token);
  if (!sub) return res.status(404).page('확인 실패', '<p>유효하지 않은 링크입니다.</p>');
  const first = sub.status !== 'active' && !sub.confirmed_at; // 최초 확정일 때만 자동화 시작
  await db.prepare("UPDATE subscribers SET status='active', confirmed_at=COALESCE(confirmed_at,?), unsub_at=NULL WHERE id=?").run(now(), sub.id);
  if (first) await enrollSubscriber(sub);
  const nl = await db.prepare('SELECT * FROM newsletters WHERE id=?').get(sub.newsletter_id);
  res.page('구독 완료', `<h1>구독이 완료되었습니다</h1><p>다음 호부터 <b>${h(sub.nl_name)}</b>을(를) 메일함에서 만나요.</p>
<p><a href="/n/${h(sub.slug)}">지난 글 읽기</a> · <a href="/r/${h(sub.token)}">친구에게 추천하기</a>${hasPaid(nl) ? ` · <a href="/n/${h(sub.slug)}/upgrade?t=${h(sub.token)}">유료 구독하기</a>` : ''}</p>`);
});

pub.get('/unsubscribe/:token', async (req, res) => {
  const sub = await db.prepare('SELECT s.*, n.name AS nl_name FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE s.token=?').get(req.params.token);
  if (!sub) return res.status(404).page('해지', '<p>유효하지 않은 링크입니다.</p>');
  res.page('구독 해지', sub.status === 'unsubscribed' ? '<h1>이미 해지되었습니다</h1>'
    : `<h1>${h(sub.nl_name)} 구독을 해지할까요?</h1><p class="mute">${h(sub.email)}</p><form method="post"><button class="primary">구독 해지</button></form>`);
});
// 메일 클라이언트의 원클릭 해지도 이 POST를 호출
pub.post('/unsubscribe/:token', async (req, res) => {
  const sub = await db.prepare('SELECT * FROM subscribers WHERE token=?').get(req.params.token);
  if (!sub) return res.status(404).send('invalid');
  await db.prepare("UPDATE subscribers SET status='unsubscribed', unsub_at=? WHERE id=?").run(now(), sub.id);
  res.page('구독 해지됨', '<h1>구독이 해지되었습니다</h1><p>그동안 읽어주셔서 감사합니다.</p>');
});

// ---------- 추적 ----------
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
pub.get('/t/o/:tok', async (req, res) => {
  await db.prepare('UPDATE send_log SET opened_at=COALESCE(opened_at,?), open_count=open_count+1 WHERE tok=?').run(now(), req.params.tok);
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }).send(GIF);
});
pub.get('/t/c/:id/:tok', async (req, res) => {
  const link = await db.prepare('SELECT * FROM links WHERE id=?').get(req.params.id);
  if (!link) return res.status(404).send('not found');
  const log = await db.prepare('SELECT * FROM send_log WHERE tok=? AND post_id=?').get(req.params.tok, link.post_id);
  if (log) {
    await db.prepare('INSERT INTO clicks(link_id,post_id,subscriber_id,clicked_at) VALUES(?,?,?,?)').run(link.id, link.post_id, log.subscriber_id, now());
    await db.prepare('UPDATE send_log SET opened_at=COALESCE(opened_at,?) WHERE id=?').run(now(), log.id);
  }
  res.redirect(link.url); // 등록된 링크 ID만 허용 → 오픈 리다이렉트 아님
});
