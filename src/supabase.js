// Supabase Auth 연동 (서버에서 REST로 호출, PKCE 흐름). 데이터(글·구독자 등)는 기존 DB에 그대로 둔다.
// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 가 있으면 가입·로그인·비밀번호 재설정·Google 로그인이 Supabase로 처리된다.
import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { db, now, baseUrl } from './db.js';
import { login, cookie, tooManyTries, cooldown } from './auth.js';

export const sbRouter = Router();
const URL_ = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = () => process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
export const sbEnabled = () => !!(URL_() && KEY());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const note = (m) => '?m=' + encodeURIComponent(m);
const secure = () => baseUrl().startsWith('https://');

async function call(path, { method = 'POST', body, token } = {}) {
  try {
    const r = await fetch(`${URL_()}/auth/v1/${path}`, {
      method,
      headers: { apikey: KEY(), 'Content-Type': 'application/json', Authorization: `Bearer ${token || KEY()}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { msg: 'network' } };
  }
}

// ---------- PKCE ----------
const b64url = (buf) => buf.toString('base64url');
function newPkce(res) {
  const verifier = b64url(randomBytes(32));
  res.cookie('sb_pkce', verifier, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 30 * 60_000 });
  return { code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 's256' };
}

// ---------- Supabase 사용자 → 로컬 사용자 ----------
// 로컬 users 테이블은 프로필/소유 관계용. 이메일이 Supabase에서 확인된 경우에만 연결한다.
async function upsertLocal(sb) {
  if (!sb?.id || !sb.email || !(sb.email_confirmed_at || sb.confirmed_at)) return null;
  const email = sb.email.toLowerCase();
  const name = String(sb.user_metadata?.name || sb.user_metadata?.full_name || '').slice(0, 60);
  let u = await db.prepare('SELECT * FROM users WHERE supabase_id=?').get(sb.id);
  let isNew = false;
  // Supabase 에서 이메일이 확인된 계정인데 로컬에 미인증으로 남아 있으면(나중에 인증 처리한 경우) 로그인할 때 맞춰 준다
  if (u && !u.verified) { await db.prepare('UPDATE users SET verified=1 WHERE id=?').run(u.id); u.verified = 1; }
  if (!u) {
    u = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (u) {
      // 미인증으로 선점된 로컬 계정이면 비밀번호를 지우고 기존 로그인을 끊는다
      if (!u.verified) await db.prepare('UPDATE users SET pw_hash=NULL, sess_ver=sess_ver+1 WHERE id=?').run(u.id);
      await db.prepare('UPDATE users SET supabase_id=?, verified=1 WHERE id=?').run(sb.id, u.id);
    } else {
      const id = Number((await db.prepare('INSERT INTO users(email,name,supabase_id,verified,created_at) VALUES(?,?,?,1,?)').run(email, name, sb.id, now())).lastInsertRowid);
      u = { id };
      isNew = true;
    }
  }
  return { id: u.id, isNew };
}

const enabled = (req, res, next) => (sbEnabled() ? next() : next('router'));

// ---------- 이메일 가입 ----------
sbRouter.post('/signup', enabled, async (req, res) => {
  if (await tooManyTries(req.ip, true)) return res.status(429).send('잠시 후 다시 시도하세요.');
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.redirect('/signup' + note('이메일 형식이 올바르지 않습니다.'));
  if (pw.length < 8) return res.redirect('/signup' + note('비밀번호는 8자 이상이어야 합니다.'));
  const r = await call(`signup?redirect_to=${encodeURIComponent(baseUrl() + '/auth/callback')}`, {
    body: { email, password: pw, data: { name: String(req.body.name || '').trim().slice(0, 60) }, ...newPkce(res) },
  });
  if (r.json?.access_token) { // 프로젝트가 이메일 확인을 끈 경우: 바로 로그인
    const u = await upsertLocal(r.json.user);
    if (u) { await login(res, u.id); return res.redirect('/app/new'); }
  }
  if (r.status === 429 || /rate|limit/i.test(r.json?.msg || r.json?.error_code || ''))
    return res.redirect('/signup' + note('인증 메일 발송 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'));
  if (r.status === 422 && /password/i.test(r.json?.msg || '')) return res.redirect('/signup' + note('비밀번호가 너무 약합니다. 더 길고 복잡하게 설정해 주세요.'));
  if (!r.ok && r.status !== 0 && r.status < 500) return res.redirect('/signup' + note('가입할 수 없습니다. 입력을 확인해 주세요.'));
  if (r.status === 0 || r.status >= 500) return res.redirect('/signup' + note('인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
  // 이미 가입된 이메일이어도 같은 응답 (계정 존재 여부 비노출)
  res.redirect('/login' + note('인증 메일을 보냈습니다. 메일의 링크를 눌러 인증하면 가입이 완료됩니다.'));
});

// ---------- 로그인 ----------
sbRouter.post('/login', enabled, async (req, res) => {
  if (await tooManyTries(req.ip)) return res.status(429).send('시도 횟수 초과. 10분 후 다시 시도하세요.');
  const r = await call('token?grant_type=password', { body: { email: String(req.body.email || '').trim().toLowerCase(), password: String(req.body.password || '') } });
  const fail = (m) => res.redirect('/login' + note(m));
  if (r.status === 0 || r.status >= 500) return fail('인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if (!r.ok) {
    if (r.json?.error_code === 'email_not_confirmed') return fail('이메일 인증이 필요합니다. 가입 시 받은 인증 메일의 링크를 눌러주세요.');
    await tooManyTries(req.ip, true);
    return fail('이메일 또는 비밀번호가 올바르지 않습니다.');
  }
  const u = await upsertLocal(r.json.user);
  if (!u) return fail('이메일 인증이 완료되지 않았습니다.');
  await login(res, u.id);
  res.redirect('/app');
});

// ---------- Google 등 소셜 로그인 (Supabase 대시보드에서 Provider를 켜야 함) ----------
let settingsCache = { at: 0, v: null };
async function providers() {
  if (Date.now() - settingsCache.at > 60_000) {
    const r = await call('settings', { method: 'GET' });
    settingsCache = { at: Date.now(), v: r.ok ? r.json.external || {} : {} };
  }
  return settingsCache.v;
}
sbRouter.get('/auth/google', enabled, async (req, res) => {
  if (!(await providers()).google) return res.redirect('/login' + note('Google 로그인은 Supabase 대시보드에서 Google Provider를 켜야 사용할 수 있습니다.'));
  const q = new URLSearchParams({ provider: 'google', redirect_to: `${baseUrl()}/auth/callback`, ...newPkce(res) });
  res.redirect(`${URL_()}/auth/v1/authorize?${q}`);
});

// 가입 확인 메일 / 소셜 로그인 공통 콜백: ?code= 를 세션으로 교환
async function exchange(req, res) {
  const code = String(req.query.code || '');
  const verifier = cookie(req, 'sb_pkce');
  res.clearCookie('sb_pkce');
  if (!code || !verifier) return null;
  const r = await call('token?grant_type=pkce', { body: { auth_code: code, code_verifier: verifier } });
  return r.ok ? r.json : null;
}
sbRouter.get('/auth/callback', enabled, async (req, res) => {
  if (req.query.error || req.query.error_description)
    return res.redirect('/login' + note('인증에 실패했거나 링크가 만료되었습니다. 다시 시도해 주세요.'));
  const s = await exchange(req, res);
  const u = s && await upsertLocal(s.user);
  if (!u) // 다른 브라우저/기기에서 메일 링크를 연 경우 등: 이메일 인증 자체는 이미 끝났을 수 있다
    return res.redirect('/login' + note('이메일 인증이 완료되었습니다. 로그인해 주세요. (다른 기기에서 열었다면 정상입니다)'));
  await login(res, u.id);
  res.redirect(u.isNew ? '/app/new' : '/app');
});

// ---------- 비밀번호 재설정 ----------
sbRouter.post('/forgot', enabled, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (EMAIL_RE.test(email) && await cooldown(`forgot-ip:${req.ip}`, 10_000) && await cooldown(`forgot:${email}`, 60_000))
    await call(`recover?redirect_to=${encodeURIComponent(baseUrl() + '/auth/recovery')}`, { body: { email, ...newPkce(res) } });
  res.redirect('/forgot' + note('가입된 주소라면 재설정 링크를 보냈습니다. 메일함을 확인하세요.'));
});
sbRouter.get('/auth/recovery', enabled, async (req, res) => {
  const s = await exchange(req, res);
  if (!s?.access_token) return res.redirect('/forgot' + note('링크가 만료되었거나 다른 브라우저에서 열었습니다. 같은 브라우저에서 다시 요청해 주세요.'));
  res.cookie('sb_recovery', s.access_token, { httpOnly: true, sameSite: 'strict', secure: secure(), maxAge: 15 * 60_000 });
  res.page('새 비밀번호', `<h1>새 비밀번호 설정</h1><form class="card" method="post" action="/auth/reset-password"><label>새 비밀번호 (8자 이상)</label>
<input type="password" name="password" minlength="8" required autocomplete="new-password"><p><button class="primary">변경하기</button></p></form>`, { msg: req.query.m });
});
sbRouter.post('/auth/reset-password', enabled, async (req, res) => {
  const token = cookie(req, 'sb_recovery');
  const pw = String(req.body.password || '');
  if (!token) return res.redirect('/forgot' + note('세션이 만료되었습니다. 다시 요청해 주세요.'));
  if (pw.length < 8) return res.redirect('/forgot' + note('비밀번호는 8자 이상이어야 합니다.'));
  const r = await call('user', { method: 'PUT', body: { password: pw }, token });
  res.clearCookie('sb_recovery');
  const u = r.ok && await upsertLocal(r.json);
  if (!u) return res.redirect('/forgot' + note('비밀번호를 변경하지 못했습니다. 다시 시도해 주세요.'));
  // 이 서비스의 기존 로그인도 모두 해제하고 새로 로그인
  await db.prepare('UPDATE users SET sess_ver=sess_ver+1 WHERE id=?').run(u.id);
  await login(res, u.id);
  res.redirect('/app' + note('비밀번호를 변경했습니다. 다른 기기의 로그인은 해제되었습니다.'));
});
