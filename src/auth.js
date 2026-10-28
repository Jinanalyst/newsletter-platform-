import { createHmac, createHash, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { db, baseUrl } from './db.js';
import { sendMail } from './mail.js';

const SECRET = process.env.SECRET || randomBytes(32).toString('hex'); // 미설정 시 재시작마다 로그아웃됨
const sign = (v) => createHmac('sha256', SECRET).update(v).digest('base64url');
const eq = (a, b) => {
  const x = createHmac('sha256', 'k').update(String(a)).digest();
  const y = createHmac('sha256', 'k').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export const hashPw = (pw) => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
};
export const checkPw = (pw, stored) => {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  return timingSafeEqual(scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex'));
};

export const cookie = (req, name) =>
  (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

const secure = () => baseUrl().startsWith('https://');
// 세션 쿠키에 사용자의 sess_ver를 포함 → 비밀번호 변경 시 sess_ver를 올려 기존 로그인을 모두 무효화
export function login(res, userId) {
  const ver = db.prepare('SELECT sess_ver FROM users WHERE id=?').get(userId)?.sess_ver ?? 0;
  const body = `${userId}.${Date.now() + 14 * 864e5}.${ver}`;
  res.cookie('sid', `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 14 * 864e5 });
}

// 모든 요청에 req.user 부착
export function loadUser(req, res, next) {
  req.user = null;
  const [uid, exp, ver, sig] = (cookie(req, 'sid') || '').split('.');
  if (uid && exp && ver && sig && eq(sig, sign(`${uid}.${exp}.${ver}`)) && Number(exp) > Date.now()) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    if (u && u.sess_ver === Number(ver)) req.user = u;
  }
  next();
}

// ---------- 이메일 인증 / 비밀번호 재설정 토큰 ----------
const sha = (v) => createHash('sha256').update(v).digest('hex');
export function createToken(userId, kind, ttlMs) {
  db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND kind=?').run(userId, kind); // 최신 1개만 유효
  const raw = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES(?,?,?,?)')
    .run(userId, kind, sha(raw), new Date(Date.now() + ttlMs).toISOString());
  return raw;
}
// 유효하면 사용자 ID 반환. consume=true면 1회용으로 폐기
export function checkToken(raw, kind, consume = false) {
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?').get(sha(String(raw || '')), kind);
  if (!row || row.expires_at < new Date().toISOString()) return null;
  if (consume) db.prepare('DELETE FROM auth_tokens WHERE id=?').run(row.id);
  return row.user_id;
}

const PLATFORM = () => process.env.PLATFORM_NAME || 'lett.';
export async function sendVerification(user) {
  const link = `${baseUrl()}/verify/${createToken(user.id, 'verify', 48 * 3600e3)}`;
  await sendMail({ to: user.email, subject: `[${PLATFORM()}] 이메일 인증`, fromName: PLATFORM(),
    html: `<p>가입해 주셔서 감사합니다. 아래 링크를 눌러 이메일을 인증해 주세요. (48시간 유효)</p><p><a href="${link}">이메일 인증하기</a></p><p>본인이 가입하지 않았다면 무시하세요.</p>`,
    text: `이메일 인증: ${link}` });
}
export async function sendReset(user) {
  const link = `${baseUrl()}/reset/${createToken(user.id, 'reset', 3600e3)}`;
  await sendMail({ to: user.email, subject: `[${PLATFORM()}] 비밀번호 재설정`, fromName: PLATFORM(),
    html: `<p>비밀번호를 재설정하려면 아래 링크를 눌러주세요. (1시간 유효)</p><p><a href="${link}">비밀번호 재설정</a></p><p>요청하지 않았다면 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.</p>`,
    text: `비밀번호 재설정: ${link}` });
}

// 사용자별 쿨다운 (인증/재설정 메일 남용 방지)
const cool = new Map();
export function cooldown(key, ms) {
  const t = Date.now();
  if (t - (cool.get(key) || 0) < ms) return false;
  cool.set(key, t);
  return true;
}
export const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

// 로그인 시도 제한 (IP당 10분 8회)
const tries = new Map();
export function tooManyTries(ip, add = false) {
  const t = Date.now();
  const arr = (tries.get(ip) || []).filter((x) => t - x < 600_000);
  if (add) arr.push(t);
  tries.set(ip, arr);
  return arr.length >= 8;
}
