import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db, now, baseUrl, isPaid, hasPaid, publicUrl } from './db.js';
import { enrollSubscriber } from './send.js';
import { sbEnabled } from './supabase.js';
import { recordView } from './analytics.js';
import { landingPage } from './landing.js';
import { won } from './billing.js';
import { sendMail } from './mail.js';
import { renderPost, h, personalize } from './render.js';
import { page, fmt, platformFooter } from './views.js';
import { tr } from './i18n.js';
import { NOTE_SELECT } from './feed.js';
import { snsLinks } from './sns.js';
import { readLayout, applyOrder } from './layout.js';
import { priceLabel } from './create.js';
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
  const notes = await db.prepare(`SELECT * FROM (${NOTE_SELECT}) x ORDER BY id DESC LIMIT 4`).all(0);
  // 인기 강의·상품: 아직 판매 집계가 없어 최근 게시순으로 보여준다 (결제 연동 후 판매량순으로 교체)
  const courses = await db.prepare(`SELECT c.id,c.kind,c.title,c.thumbnail,c.pricing,c.price,u.name AS author FROM courses c JOIN users u ON u.id=c.owner_id
    WHERE c.status='published' ORDER BY c.id DESC LIMIT 6`).all();
  res.send(landingPage({ user: req.user, list, notes, courses, lang: req.lang }));
});

// ---------- 회원: 이메일 가입 / 로그인 / 소셜 ----------
const authForm = (kind, msg, req, res) => {
  const signup = kind === 'signup';
  const t = req.t;
  res.page(signup ? t('가입') : t('로그인'), `<h1>${signup ? t('시작하기') : t('로그인')}</h1>
<form class="card" method="post">
${signup ? `<label>${t('이름')}</label><input name="name" required maxlength="60" autocomplete="name">` : ''}
<label>${t('이메일')}</label><input type="email" name="email" required autocomplete="email">
<label>${t('비밀번호')}${signup ? ' ' + t('(8자 이상)') : ''}</label><input type="password" name="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">
<p><button class="primary">${signup ? t('가입하기') : t('로그인')}</button></p></form>
${googleOn() || sbEnabled() ? `<p><a class="btn" href="/auth/google">${t('Google로 계속하기')}</a></p>` : `<p class="mute">${t('Google 로그인은 .env에 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET을 설정하면 활성화됩니다.')}</p>`}
<p class="mute">${signup ? `${t('이미 계정이 있나요?')} <a href="/login">${t('로그인')}</a>` : `${t('계정이 없나요?')} <a href="/signup">${t('가입하기')}</a> · <a href="/forgot">${t('비밀번호를 잊으셨나요?')}</a>`}</p>`, { msg });
};
pub.get('/signup', (req, res) => (req.user ? res.redirect('/app') : authForm('signup', req.query.m, req, res)));
pub.get('/login', (req, res) => (req.user ? res.redirect('/app') : authForm('login', req.query.m, req, res)));

pub.post('/signup', async (req, res) => {
  if (await tooManyTries(req.ip, true)) return res.status(429).send(req.t('잠시 후 다시 시도하세요.'));
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.redirect('/signup' + note(req.t('이메일 형식이 올바르지 않습니다.')));
  if (pw.length < 8) return res.redirect('/signup' + note(req.t('비밀번호는 8자 이상이어야 합니다.')));
  if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.redirect('/signup' + note(req.t('이미 가입된 이메일입니다. 로그인해 주세요.')));
  const id = Number((await db.prepare('INSERT INTO users(email,name,pw_hash,created_at) VALUES(?,?,?,?)')
    .run(email, String(req.body.name || '').trim().slice(0, 60), hashPw(pw), now())).lastInsertRowid);
  await login(res, id);
  sendVerification({ id, email }).catch((e) => console.error('인증 메일 실패', e.message));
  res.redirect('/app/new' + note(req.t('가입 완료! 인증 메일을 보냈습니다. 인증 전에는 메일 발송이 제한됩니다.')));
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
pub.get('/forgot', (req, res) => res.page(req.t('비밀번호 찾기'), `<h1>${req.t('비밀번호 재설정')}</h1><p class="mute">${req.t('가입한 이메일로 재설정 링크를 보내드립니다.')}</p>
<form class="card" method="post"><label>${req.t('이메일')}</label><input type="email" name="email" required><p><button class="primary">${req.t('링크 받기')}</button></p></form>`, { msg: req.query.m }));
pub.post('/forgot', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  // 계정 존재 여부가 드러나지 않도록 항상 같은 응답. IP·이메일별 쿨다운으로 메일 폭탄 방지
  if (await cooldown(`forgot-ip:${req.ip}`, 10_000) && await cooldown(`forgot:${email}`, 60_000)) {
    const u = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u) sendReset(u).catch((e) => console.error('재설정 메일 실패', e.message));
  }
  res.redirect('/forgot' + note(req.t('가입된 주소라면 재설정 링크를 보냈습니다. 메일함을 확인하세요.')));
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
  if (await tooManyTries(req.ip)) return res.status(429).send(req.t('시도 횟수 초과. 10분 후 다시 시도하세요.'));
  const u = await db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').trim().toLowerCase());
  if (!u || !checkPw(String(req.body.password || ''), u.pw_hash)) {
    await tooManyTries(req.ip, true);
    return res.redirect('/login' + note(req.t('이메일 또는 비밀번호가 올바르지 않습니다.')));
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
const notFound = (res) => res.status(404).page(res.req.t('없음'), `<h1>${res.req.t('찾을 수 없습니다')}</h1><p><a href="/">${res.req.t('홈으로')}</a></p>`);

// 구독 폼 (공개 페이지·임베드 공용). 추천 코드는 ?ref= 로 들어와 폼에 실려 간다
const subForm = (nl, ref, embed = false, t = tr('ko')) => `<form class="card" method="post" action="/n/${h(nl.slug)}/subscribe" ${embed ? 'target="_self"' : ''}>
<div class="honey"><input name="website" tabindex="-1" autocomplete="off"></div>
<input type="hidden" name="ref" value="${h(ref || '')}">${embed ? '<input type="hidden" name="embed" value="1">' : ''}
<div class="row"><input class="grow" type="email" name="email" required placeholder="${t('이메일 주소')}"><input class="grow" name="name" placeholder="${t('닉네임 (선택, 메일 인사말에 쓰여요)')}" maxlength="60">
<button class="primary">${t('구독하기')}</button></div>
<p class="mute" style="margin:8px 0 0">${t('언제든 메일 하단 링크로 해지할 수 있습니다.')}</p></form>`;

pub.get('/n/:slug', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return notFound(res);
  const t = req.t;
  let posts = await db.prepare("SELECT * FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent' ORDER BY sent_at DESC").all(nl.id);
  const fc = String(req.query.c || ''), ft = String(req.query.tag || '');
  if (fc) posts = posts.filter((p) => p.category === fc);
  if (ft) posts = posts.filter((p) => p.tags.split(',').includes(ft));
  // 발행자가 편집한 레이아웃(글 순서·숨김 포함). 숨긴 글은 발행자 본인에게만 (편집용으로) 내려준다
  const lay = readLayout(nl);
  const hiddenIds = new Set(lay.hidden);
  const isOwner = !!req.user && req.user.id === nl.owner_id;
  const canEdit = isOwner && !fc && !ft; // 필터를 건 상태에서는 일부 글만 보이므로 순서 편집을 막는다
  posts = applyOrder(posts, lay);
  if (!isOwner) posts = posts.filter((p) => !hiddenIds.has(p.id));
  // 발행자가 고른 강의·상품: 게시된 내 강의만, 선택한 순서대로. 편집 패널에는 내 강의 전체를 보여준다
  const myCourses = await db.prepare("SELECT id,kind,title,thumbnail,pricing,price,status FROM courses WHERE owner_id=? ORDER BY id DESC").all(nl.owner_id);
  const pickedCourses = lay.courses.map((id) => myCourses.find((c) => c.id === id)).filter((c) => c && c.status === 'published');
  const cats = nl.categories.split(',').filter(Boolean);
  const filterBar = cats.length || fc || ft
    ? `<div class="chips"><a class="chip${!fc && !ft ? ' on' : ''}" href="/n/${h(nl.slug)}">${t('전체')}</a>${cats.map((x) => `<a class="chip${x === fc ? ' on' : ''}" href="?c=${encodeURIComponent(x)}">${h(x)}</a>`).join('')}${ft ? `<a class="chip on" href="/n/${h(nl.slug)}">#${h(ft)} ✕</a>` : ''}</div>` : '';
  await recordView(req, nl, 0, 0);
  const accent = /^#[0-9a-f]{6}$/i.test(nl.accent) ? nl.accent : '#3B82F6';
  const abs = (u) => (!u ? '' : /^https?:/i.test(u) ? u : baseUrl() + u);
  const pageUrl = publicUrl(nl);
  const ogImg = abs(nl.cover || nl.logo);
  // 대표 색상 그라데이션은 커버 아래에 항상 깔아 둔다: 커버가 없거나 불러오지 못해도 회색 대신 대표 색이 보인다
  const accentBg = `linear-gradient(135deg,${accent},color-mix(in srgb,${accent} 45%,#0F172A))`;
  const bg = nl.cover
    ? `linear-gradient(rgba(15,23,42,.45),rgba(15,23,42,.75)),url('${h(nl.cover)}') ${/^\d{1,3}% \d{1,3}%$/.test(nl.cover_pos || '') ? nl.cover_pos : 'center'}/cover no-repeat,${accentBg}`
    : accentBg;
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
.lp-sns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:-8px 0 26px}
.lp-sns a{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);transition:background .15s,transform .15s}
.lp-sns a:hover{background:rgba(255,255,255,.3);transform:translateY(-2px)}
.lp-sns svg{width:20px;height:20px}
.lp-share{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:22px}
.lp-share a,.lp-share button{border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 16px;font-size:13px;text-decoration:none;cursor:pointer}
.lp-share a:hover,.lp-share button:hover{background:rgba(255,255,255,.25)}
.lp-main{max-width:680px;margin:0 auto;padding:40px 20px 72px}
#lp.lp-w-narrow .lp-main{max-width:560px}#lp.lp-w-wide .lp-main{max-width:960px}
#lp.lp-w-narrow .lp-hero .in{max-width:520px}#lp.lp-w-wide .lp-hero .in{max-width:760px}
#lp.lp-h-compact .lp-hero{padding:36px 20px 44px}#lp.lp-h-compact .lp-hero .desc{margin:14px auto 20px}
#lp.lp-h-tall .lp-hero{padding:120px 20px 140px}
#lp[class*="lp-s-"]:not(.lp-s-stack) .lp-hero .in{max-width:1000px;display:grid;grid-template-columns:1fr 1fr;gap:20px 56px;align-items:center;text-align:left}
#lp.lp-w-narrow[class*="lp-s-"]:not(.lp-s-stack) .lp-hero .in{max-width:820px}#lp.lp-w-wide[class*="lp-s-"]:not(.lp-s-stack) .lp-hero .in{max-width:1200px}
#lp.lp-s-right .lp-act{order:-1}
#lp:not(.lp-s-stack) .lp-hero .logo{margin:0 0 18px}#lp:not(.lp-s-stack) .lp-hero .desc{margin:18px 0 22px}#lp:not(.lp-s-stack) .lp-sns,#lp:not(.lp-s-stack) .lp-share{justify-content:flex-start}
@media(max-width:820px){#lp[class*="lp-s-"]:not(.lp-s-stack) .lp-hero .in{display:block;text-align:center;max-width:640px}#lp:not(.lp-s-stack) .lp-hero .logo{margin:0 auto 18px}#lp:not(.lp-s-stack) .lp-hero .desc{margin:22px auto 30px}#lp:not(.lp-s-stack) .lp-sns,#lp:not(.lp-s-stack) .lp-share{justify-content:center}}
#lp.lp-v-grid .lp-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
#lp.lp-v-grid .item{margin:0}
.item.off{opacity:.45}.item[hidden]{display:none}
.lp-editing .item{cursor:grab;outline:1px dashed var(--blue);outline-offset:3px}.lp-editing .item.over{box-shadow:0 -3px 0 var(--blue)}.lp-editing .item.over.dn{box-shadow:0 3px 0 var(--blue)}
.ictl{float:right;display:flex;gap:4px;margin-left:8px}.ictl button{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:2px 9px;font-size:12px;cursor:pointer;color:var(--ink)}
.lpbar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100;max-width:calc(100% - 24px)}
.lpbar .open{background:#0F172A;color:#fff;border:0;border-radius:999px;padding:11px 20px;font-size:14px;cursor:pointer;box-shadow:0 10px 30px -10px rgba(15,23,42,.6)}
.lpbar .open[hidden]{display:none}
.lpbar .panel{background:#0F172A;color:#fff;border-radius:18px;padding:14px 16px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:center;box-shadow:0 16px 40px -12px rgba(15,23,42,.7);font-size:13px}
.lpbar .panel[hidden]{display:none}
.lpbar .grp{display:flex;align-items:center;gap:6px}.lpbar .grp>span{opacity:.7}
.lpbar .seg2{display:inline-flex;border:1px solid rgba(255,255,255,.3);border-radius:999px;overflow:hidden}
.lpbar .seg2 button{border:0;background:none;color:#fff;padding:5px 12px;font-size:13px;cursor:pointer}.lpbar .seg2 button.on{background:#fff;color:#0F172A}
.lpbar .save{background:#3B82F6;color:#fff;border:0;border-radius:999px;padding:7px 18px;font-size:13px;cursor:pointer}.lpbar .cancel{background:none;color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:999px;padding:7px 14px;font-size:13px;cursor:pointer}
.lpbar .tip{flex-basis:100%;text-align:center;opacity:.7;font-size:12px}
.lp-main h2{margin-top:0}
.lp-courses{margin-top:48px}.lp-courses h2{margin-bottom:14px}
.lc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.lc{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:16px;background:var(--card);overflow:hidden;transition:border-color .15s,box-shadow .15s,transform .15s}
.lc:hover{border-color:var(--blue);transform:translateY(-2px);box-shadow:0 16px 32px -22px var(--blue)}
.lc .th{aspect-ratio:16/9;background:var(--soft) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--mute);font-size:22px}
.lc .bd{padding:12px 14px 14px;display:flex;flex-direction:column;gap:2px}.lc b{font-size:15px;line-height:1.4;letter-spacing:-.02em}.lc .pr{font-weight:700;margin-top:4px}
.lpbar .cpick{flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:center}.lpbar .cpick>span{opacity:.7}
.lpbar .cch{border:1px solid rgba(255,255,255,.35);background:none;color:#fff;border-radius:999px;padding:4px 12px;font-size:12.5px;cursor:pointer;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lpbar .cch.on{background:#fff;color:#0F172A}.lpbar .cch:disabled{opacity:.4;cursor:not-allowed}.lpbar .cpick a{color:#93C5FD;font-size:12.5px}
.lp-foot{text-align:center;padding:0 20px 40px}
</style>`;
  res.page(nl.name, `<div id="lp" class="lp-w-${lay.width} lp-h-${lay.hero} lp-v-${lay.view} lp-s-${lay.split}"><header class="lp-hero"><div class="in"><div class="lp-info">
${nl.logo ? `<img class="logo" src="${h(nl.logo)}" alt="" onerror="this.remove()">` : ''}
<h1>${h(nl.name)}</h1><p class="by">by ${h(nl.owner || t('발행자'))}</p>
<p class="desc">${h(nl.description)}</p>
${snsLinks(nl)}</div><div class="lp-act">
${req.query.ref ? `<p class="note">${t('친구의 추천으로 방문하셨네요')}</p>` : ''}${req.query.m ? `<p class="note">${h(req.query.m)}</p>` : ''}${subForm(nl, req.query.ref, false, t)}
<div class="lp-share"><button type="button" id="lpshare">${t('공유하기')}</button><button type="button" id="lpcopy">${t('링크 복사')}</button>
<a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${shareText}" target="_blank" rel="noopener">X</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">Facebook</a></div>
</div></header>
<main class="lp-main">
${hasPaid(nl) ? `<p class="mute">${t('유료 구독({price})으로 전용 글을 읽을 수 있어요. 무료 구독 후 <a href="{href}">유료 구독</a>에서 신청하세요.', { price: `${nl.price_monthly ? t('월 {p}', { p: won(nl.price_monthly) }) : ''}${nl.price_monthly && nl.price_yearly ? ' / ' : ''}${nl.price_yearly ? t('연 {p}', { p: won(nl.price_yearly) }) : ''}`, href: `/n/${h(nl.slug)}/upgrade` })}</p>` : ''}
<h2>${t('아카이브')}</h2>${filterBar}${posts.length ? `<div class="lp-list" id="lplist">${posts.map((p) => `<div class="item${hiddenIds.has(p.id) ? ' off" hidden data-off="1' : ''}" data-id="${p.id}"><a href="/n/${h(nl.slug)}/p/${p.id}">${h(personalize(p.subject, null, { html: false }))}</a>${p.audience === 'paid' || p.body_md.includes('[[paywall]]') ? ` <span class="badge">${t('유료')}</span>` : ''}<span class="mute">${fmt(p.sent_at, req.lang)}${p.category ? ` · ${h(p.category)}` : ''}${p.tags ? ' ' + p.tags.split(',').map((t) => `<a href="?tag=${encodeURIComponent(t)}">#${h(t)}</a>`).join(' ') : ''}</span></div>`).join('')}</div>`
    : `<p class="mute">${t('아직 발행된 글이 없습니다.')}</p>`}
${pickedCourses.length ? `<section class="lp-courses"><h2>${t('강의·상품')}</h2><div class="lc-grid">${pickedCourses.map((c) => `<a class="lc" href="/c/${c.id}"><div class="th"${c.thumbnail ? ` style="background-image:url('${h(c.thumbnail)}')"` : ''}>${c.thumbnail ? '' : '▶'}</div><div class="bd"><b>${h(c.title)}</b><span class="pr">${priceLabel(c, t)}</span></div></a>`).join('')}</div></section>` : ''}
</main>
<footer class="lp-foot mute"><a href="/n/${h(nl.slug)}/rss.xml">RSS</a> · ${t('{a}로 만든 뉴스레터', { a: '<a href="/">lett.</a>' })}</footer></div>
${platformFooter(t, req.lang)}${canEdit ? '<div style="height:72px"></div>' : ''}
${canEdit ? `<div class="lpbar" id="lpbar"><button type="button" class="open" id="lpopen">${t('✎ 레이아웃 편집')}</button>
<div class="panel" id="lppanel" hidden>
<div class="grp"><span>${t('너비')}</span><div class="seg2"><button type="button" data-k="width" data-v="narrow">${t('좁게')}</button><button type="button" data-k="width" data-v="normal">${t('보통')}</button><button type="button" data-k="width" data-v="wide">${t('넓게')}</button></div></div>
<div class="grp"><span>${t('상단 배치')}</span><div class="seg2"><button type="button" data-k="split" data-v="stack">${t('위아래')}</button><button type="button" data-k="split" data-v="left">${t('소개 왼쪽')}</button><button type="button" data-k="split" data-v="right">${t('소개 오른쪽')}</button></div></div>
<div class="grp"><span>${t('상단 높이')}</span><div class="seg2"><button type="button" data-k="hero" data-v="compact">${t('낮게')}</button><button type="button" data-k="hero" data-v="normal">${t('보통')}</button><button type="button" data-k="hero" data-v="tall">${t('높게')}</button></div></div>
<div class="grp"><span>${t('글 목록')}</span><div class="seg2"><button type="button" data-k="view" data-v="list">${t('목록')}</button><button type="button" data-k="view" data-v="grid">${t('카드')}</button></div></div>
<div class="cpick" id="lpcourses"><span>${t('강의·상품 표시')}</span>${myCourses.map((c) => `<button type="button" class="cch" data-c="${c.id}"${c.status === 'published' ? '' : ' disabled title="' + t('게시한 뒤에 선택할 수 있어요') + '"'}>${h(c.title || t('제목 없음'))}${c.status === 'published' ? '' : ' ' + t('(미게시)')}</button>`).join('')}<a href="/create" target="_blank">${myCourses.length ? t('+ 새로 만들기') : t('+ 강의·상품 만들기')}</a></div>
<div class="grp"><button type="button" class="save" id="lpsave">${t('저장')}</button><button type="button" class="cancel" id="lpcancel">${t('취소')}</button></div>
<div class="tip">${t('강의·상품은 선택한 순서대로 아카이브 아래에 표시돼요. 글을 끌어서 순서를 바꾸고(모바일은 ↑↓), 숨기기로 아카이브에서 뺄 수 있어요. 숨겨도 글 주소로는 계속 열립니다.')}</div></div></div>
<script>var LAY=${JSON.stringify({ width: lay.width, hero: lay.hero, view: lay.view, split: lay.split, courses: lay.courses, nid: nl.id })};
(function(){var root=document.getElementById('lp'),list=document.getElementById('lplist'),panel=document.getElementById('lppanel'),open=document.getElementById('lpopen'),cur={width:LAY.width,hero:LAY.hero,view:LAY.view,split:LAY.split},sel=LAY.courses.slice(),editing=false,drag=null;
function apply(){root.className='lp-w-'+cur.width+' lp-h-'+cur.hero+' lp-v-'+cur.view+' lp-s-'+cur.split;[].forEach.call(panel.querySelectorAll('[data-k]'),function(b){b.classList.toggle('on',cur[b.dataset.k]===b.dataset.v)})}
function paintC(){[].forEach.call(document.querySelectorAll('#lpcourses .cch'),function(b){b.classList.toggle('on',sel.indexOf(+b.dataset.c)>=0)})}
document.getElementById('lpcourses').addEventListener('click',function(e){var b=e.target.closest('.cch');if(!b||b.disabled)return;var id=+b.dataset.c,i=sel.indexOf(id);if(i>=0)sel.splice(i,1);else sel.push(id);paintC()});
function items(){return list?[].slice.call(list.querySelectorAll('.item')):[]}
function label(it){var b=it.querySelector('[data-a=eye]');if(b)b.textContent=it.classList.contains('off')?${JSON.stringify(t('표시'))}:${JSON.stringify(t('숨기기'))}}
function start(){editing=true;paintC();document.body.classList.add('lp-editing');open.hidden=true;panel.hidden=false;apply();
items().forEach(function(it){it.hidden=false;it.draggable=true;var c=document.createElement('span');c.className='ictl';c.innerHTML='<button type="button" data-a="up">↑</button><button type="button" data-a="dn">↓</button><button type="button" data-a="eye">${t('숨기기')}</button>';it.insertBefore(c,it.firstChild);label(it)})}
open.onclick=start;
document.getElementById('lpcancel').onclick=function(){location.reload()};
panel.addEventListener('click',function(e){var b=e.target.closest('[data-k]');if(b){cur[b.dataset.k]=b.dataset.v;apply()}});
if(list){list.addEventListener('click',function(e){if(!editing)return;var a=e.target.closest('a');if(a&&a.closest('.item'))e.preventDefault();var b=e.target.closest('[data-a]');if(!b)return;var it=b.closest('.item'),k=b.dataset.a;
if(k==='eye'){it.classList.toggle('off');label(it)}else if(k==='up'&&it.previousElementSibling)list.insertBefore(it,it.previousElementSibling);else if(k==='dn'&&it.nextElementSibling)list.insertBefore(it.nextElementSibling,it)});
list.addEventListener('dragstart',function(e){if(!editing)return;drag=e.target.closest('.item');if(drag){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',drag.dataset.id)}});
list.addEventListener('dragover',function(e){if(!drag)return;e.preventDefault();var it=e.target.closest('.item');items().forEach(function(x){x.classList.remove('over','dn')});if(it&&it!==drag){var r=it.getBoundingClientRect(),after=root.classList.contains('lp-v-grid')?e.clientX>r.left+r.width/2:e.clientY>r.top+r.height/2;it.classList.add('over');if(after)it.classList.add('dn')}});
list.addEventListener('drop',function(e){if(!drag)return;e.preventDefault();var it=e.target.closest('.item');if(it&&it!==drag){var r=it.getBoundingClientRect(),after=root.classList.contains('lp-v-grid')?e.clientX>r.left+r.width/2:e.clientY>r.top+r.height/2;list.insertBefore(drag,after?it.nextElementSibling:it)}});
list.addEventListener('dragend',function(){drag=null;items().forEach(function(x){x.classList.remove('over','dn')})})}
document.getElementById('lpsave').onclick=function(){var b=this;b.disabled=true;b.textContent=${JSON.stringify(t('저장 중…'))};
var its=items();fetch('/app/n/'+LAY.nid+'/layout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:cur.width,hero:cur.hero,view:cur.view,split:cur.split,courses:sel,order:its.map(function(i){return +i.dataset.id}),hidden:its.filter(function(i){return i.classList.contains('off')}).map(function(i){return +i.dataset.id})})})
.then(function(r){if(!r.ok)throw 0;location.reload()},function(){b.disabled=false;b.textContent=${JSON.stringify(t('저장'))};alert(${JSON.stringify(t('저장하지 못했습니다. 다시 시도해 주세요.'))})})}})();</script>` : ''}
<script>
(function(){var u=${JSON.stringify(pageUrl)},t=${JSON.stringify(nl.name)};
var s=document.getElementById('lpshare');if(!navigator.share)s.style.display='none';else s.onclick=function(){navigator.share({title:t,url:u}).catch(function(){})};
var c=document.getElementById('lpcopy');c.onclick=function(){(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){c.textContent=${JSON.stringify(t('복사됨 ✓'))}},function(){prompt(${JSON.stringify(t('링크를 복사하세요'))},u)})}})();
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
  const accent = /^#[0-9a-f]{6}$/i.test(nl.accent) ? nl.accent : '#3B82F6';
  // 공개 페이지와 같은 디자인(글꼴·둥근 모서리·알약 버튼·대표 색상). 배경은 투명해서 붙여 넣은 사이트에 자연스럽게 어울린다
  res.send(`<!doctype html><html lang="${h(req.lang || 'ko')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--ink:#0F172A;--mute:#64748B;--line:#E2E8F0;--card:#fff;--accent:${accent}}
*{box-sizing:border-box}
body{margin:0;padding:8px;background:transparent;color:var(--ink);font:15px/1.7 'Pretendard','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;letter-spacing:-.015em;-webkit-font-smoothing:antialiased}
.ttl{display:block;font-size:17px;font-weight:700;letter-spacing:-.03em;margin:0 2px 8px}
.card{border:1px solid var(--line);border-radius:16px;padding:18px;background:var(--card);margin:0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.grow{flex:1 1 160px;min-width:0}
input{width:100%;font:inherit;font-size:14.5px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
button{font:inherit;font-size:14px;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:999px;padding:9px 22px;transition:transform .15s,box-shadow .15s}
button:hover{transform:translateY(-1px);box-shadow:0 10px 22px -12px var(--accent)}
.mute{color:var(--mute);font-size:13px}.honey{position:absolute;left:-9999px}
.msg{margin:0 0 10px;padding:9px 14px;border-radius:10px;background:color-mix(in srgb,var(--accent) 10%,#fff);color:var(--ink);font-size:13.5px}</style></head>
<body><b class="ttl">${h(nl.name)}</b>${req.query.m ? `<p class="msg">${h(req.query.m)}</p>` : ''}${subForm(nl, req.query.ref, true, req.t)}</body></html>`);
});

pub.get('/n/:slug/p/:id', async (req, res) => {
  const nl = await getNl(req.params.slug);
  const post = nl && await db.prepare("SELECT * FROM posts WHERE id=? AND newsletter_id=? AND kind='post' AND status='sent'").get(req.params.id, nl.id);
  if (!post) return notFound(res);
  // 메일에서 온 구독자 토큰(?t=)이 유료 구독자이면 전체 공개
  const viewer = req.query.t && await db.prepare("SELECT * FROM subscribers WHERE token=? AND newsletter_id=? AND status='active'").get(String(req.query.t), nl.id);
  await recordView(req, nl, post.id, viewer?.id || 0);
  res.send(await renderPost(post, nl, { mode: 'web', canRead: isPaid(viewer), lang: req.lang }));
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
  const items = (await db.prepare("SELECT * FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent' ORDER BY sent_at DESC LIMIT 30").all(nl.id))
    .map((p) => `<item><title>${h(p.subject)}</title><link>${h(publicUrl(nl, '/p/' + p.id))}</link><guid>${h(publicUrl(nl, '/p/' + p.id))}</guid>
<pubDate>${new Date(p.sent_at).toUTCString()}</pubDate><description>${h(p.preview)}</description>${[p.category, ...p.tags.split(',')].filter(Boolean).map((t) => `<category>${h(t)}</category>`).join('')}</item>`).join('\n');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${h(nl.name)}</title>
<link>${h(publicUrl(nl))}</link><description>${h(nl.description)}</description>${items}</channel></rss>`);
});

// ---------- 구독 신청 / 확인 / 해지 ----------
const limited = async (ip) => await limitHits('sub:' + ip, 60_000, 5); // IP당 분당 5회 (DB 기반)

pub.post('/n/:slug/subscribe', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return notFound(res);
  const t = req.t;
  const back = (m) => res.redirect(`/n/${nl.slug}${req.body.embed ? '/embed' : ''}` + note(m));
  if (!nl.owner_verified) return back(t('이 뉴스레터는 아직 구독을 받을 준비가 되지 않았습니다.'));
  if (req.body.website) return back(t('확인 메일을 보냈습니다.')); // 허니팟
  if (await limited(req.ip)) return res.status(429).send(t('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'));
  const addr = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return back(t('이메일 형식이 올바르지 않습니다.'));
  const name = String(req.body.name || '').trim().slice(0, 80);

  let sub = await db.prepare('SELECT * FROM subscribers WHERE newsletter_id=? AND email=?').get(nl.id, addr);
  if (sub?.status === 'active') return back(t('이미 구독 중입니다.'));
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
    return back(t('확인 메일을 이미 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.'));
  if (today >= 200) return back(t('오늘은 신규 구독 신청이 많아 잠시 후 다시 시도해 주세요.'));
  await db.prepare('UPDATE subscribers SET confirm_sent_at=? WHERE id=?').run(now(), sub.id);
  const link = `${baseUrl()}/confirm/${sub.token}`;
  sendMail({
    to: addr, subject: t('[{name}] 구독 확인', { name: nl.name }), fromName: nl.name,
    html: `<p>${t('{name} 구독을 확정하려면 아래 링크를 눌러주세요.', { name: h(nl.name) })}</p><p><a href="${link}">${t('구독 확인하기')}</a></p><p>${t('본인이 요청하지 않았다면 무시하세요.')}</p>`,
    text: t('구독 확인: {link}', { link }),
  }).catch((e) => console.error('확인 메일 실패', e.message));
  back(t('확인 메일을 보냈습니다. 메일의 링크를 눌러 구독을 완료하세요.'));
});

pub.get('/confirm/:token', async (req, res) => {
  const sub = await db.prepare('SELECT s.*, n.slug, n.name AS nl_name FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE s.token=?').get(req.params.token);
  if (!sub) return res.status(404).page(req.t('확인 실패'), `<p>${req.t('유효하지 않은 링크입니다.')}</p>`);
  const first = sub.status !== 'active' && !sub.confirmed_at; // 최초 확정일 때만 자동화 시작
  await db.prepare("UPDATE subscribers SET status='active', confirmed_at=COALESCE(confirmed_at,?), unsub_at=NULL WHERE id=?").run(now(), sub.id);
  if (first) await enrollSubscriber(sub);
  const nl = await db.prepare('SELECT * FROM newsletters WHERE id=?').get(sub.newsletter_id);
  res.page(req.t('구독 완료'), `<h1>${req.t('구독이 완료되었습니다')}</h1><p>${req.t('다음 호부터 <b>{name}</b>을(를) 메일함에서 만나요.', { name: h(sub.nl_name) })}</p>
<p><a href="/n/${h(sub.slug)}">${req.t('지난 글 읽기')}</a> · <a href="/r/${h(sub.token)}">${req.t('친구에게 추천하기')}</a>${hasPaid(nl) ? ` · <a href="/n/${h(sub.slug)}/upgrade?t=${h(sub.token)}">${req.t('유료 구독하기')}</a>` : ''}</p>`);
});

pub.get('/unsubscribe/:token', async (req, res) => {
  const sub = await db.prepare('SELECT s.*, n.name AS nl_name FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE s.token=?').get(req.params.token);
  if (!sub) return res.status(404).page(req.t('구독 해지'), `<p>${req.t('유효하지 않은 링크입니다.')}</p>`);
  res.page(req.t('구독 해지'), sub.status === 'unsubscribed' ? `<h1>${req.t('이미 해지되었습니다')}</h1>`
    : `<h1>${req.t('{name} 구독을 해지할까요?', { name: h(sub.nl_name) })}</h1><p class="mute">${h(sub.email)}</p><form method="post"><button class="primary">${req.t('구독 해지')}</button></form>`);
});
// 메일 클라이언트의 원클릭 해지도 이 POST를 호출
pub.post('/unsubscribe/:token', async (req, res) => {
  const sub = await db.prepare('SELECT * FROM subscribers WHERE token=?').get(req.params.token);
  if (!sub) return res.status(404).send('invalid');
  await db.prepare("UPDATE subscribers SET status='unsubscribed', unsub_at=? WHERE id=?").run(now(), sub.id);
  res.page(req.t('구독 해지됨'), `<h1>${req.t('구독이 해지되었습니다')}</h1><p>${req.t('그동안 읽어주셔서 감사합니다.')}</p>`);
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
