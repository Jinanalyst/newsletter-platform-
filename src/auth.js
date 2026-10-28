import { createHmac, createHash, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { db, baseUrl } from './db.js';
import { sendMail } from './mail.js';

// 세션 서명 키. 서버리스에서는 인스턴스마다 값이 달라지면 로그인이 풀리므로 배포 환경에서는 반드시 설정해야 한다
if (!process.env.SECRET && (process.env.VERCEL || process.env.NODE_ENV === 'production')) throw new Error('SECRET 환경 변수가 필요합니다 (긴 랜덤 문자열).');
const SECRET = process.env.SECRET || randomBytes(32).toString('hex'); // 로컬 개발: 미설정 시 재시작마다 로그아웃됨
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
export async function login(res, userId) {
  const ver = (await db.prepare('SELECT sess_ver FROM users WHERE id=?').get(userId))?.sess_ver ?? 0;
  const body = `${userId}.${Date.now() + 14 * 864e5}.${ver}`;
  res.cookie('sid', `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 14 * 864e5 });
}

// 모든 요청에 req.user 부착
export async function loadUser(req, res, next) {
  req.user = null;
  const [uid, exp, ver, sig] = (cookie(req, 'sid') || '').split('.');
  if (uid && exp && ver && sig && eq(sig, sign(`${uid}.${exp}.${ver}`)) && Number(exp) > Date.now()) {
    const u = await db.prepare('SELECT * FROM users WHERE id=?').get(uid);
    if (u && u.sess_ver === Number(ver)) req.user = u;
  }
  next();
}

// ---------- 이메일 인증 / 비밀번호 재설정 토큰 ----------
const sha = (v) => createHash('sha256').update(v).digest('hex');
export async function createToken(userId, kind, ttlMs) {
  await db.prepare('DELETE FROM auth_tokens WHERE user_id=? AND kind=?').run(userId, kind); // 최신 1개만 유효
  const raw = randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES(?,?,?,?)')
    .run(userId, kind, sha(raw), new Date(Date.now() + ttlMs).toISOString());
  return raw;
}
// 유효하면 사용자 ID 반환. consume=true면 1회용으로 폐기
export async function checkToken(raw, kind, consume = false) {
  const row = await db.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?').get(sha(String(raw || '')), kind);
  if (!row || row.expires_at < new Date().toISOString()) return null;
  if (consume) await db.prepare('DELETE FROM auth_tokens WHERE id=?').run(row.id);
  return row.user_id;
}

const PLATFORM = () => process.env.PLATFORM_NAME || 'lett.';
export async function sendVerification(user) {
  const link = `${baseUrl()}/verify/${await createToken(user.id, 'verify', 48 * 3600e3)}`;
  await sendMail({ to: user.email, subject: `[${PLATFORM()}] 이메일 인증`, fromName: PLATFORM(),
    html: `<p>가입해 주셔서 감사합니다. 아래 링크를 눌러 이메일을 인증해 주세요. (48시간 유효)</p><p><a href="${link}">이메일 인증하기</a></p><p>본인이 가입하지 않았다면 무시하세요.</p>`,
    text: `이메일 인증: ${link}` });
}
export async function sendReset(user) {
  const link = `${baseUrl()}/reset/${await createToken(user.id, 'reset', 3600e3)}`;
  await sendMail({ to: user.email, subject: `[${PLATFORM()}] 비밀번호 재설정`, fromName: PLATFORM(),
    html: `<p>비밀번호를 재설정하려면 아래 링크를 눌러주세요. (1시간 유효)</p><p><a href="${link}">비밀번호 재설정</a></p><p>요청하지 않았다면 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.</p>`,
    text: `비밀번호 재설정: ${link}` });
}

// 사용자별 쿨다운 (인증/재설정 메일 남용 방지)
// ---------- 요청 제한 (DB 기반: 서버리스에서는 인스턴스마다 메모리가 달라 메모리 방식은 우회됨) ----------
const addHit = async (key) => {
  await db.prepare('INSERT INTO rate_hits(k,t) VALUES(?,?)').run(key, Date.now());
  if (Math.random() < 0.02) await db.prepare('DELETE FROM rate_hits WHERE t<?').run(Date.now() - 864e5); // 가끔 오래된 기록 정리
};
const countHits = async (key, windowMs) => (await db.prepare('SELECT COUNT(*) n FROM rate_hits WHERE k=? AND t>?').get(key, Date.now() - windowMs)).n;

// 사용자별 쿨다운 (인증/재설정 메일 남용 방지): 허용되면 true 를 돌려주고 기록
export async function cooldown(key, ms) {
  if ((await countHits(key, ms)) > 0) return false;
  await addHit(key);
  return true;
}
export const requireUser = (req, res, next) => (req.user ? next() : res.redirect('/login'));

// 로그인 시도 제한 (IP당 10분 8회)
export async function tooManyTries(ip, add = false) {
  const key = 'login:' + ip;
  if (add) await addHit(key);
  return (await countHits(key, 600_000)) >= 8;
}
// 임의 키의 분당 횟수 제한 (구독 신청 등). 한도를 넘으면 true
export async function limitHits(key, windowMs, max) {
  await addHit(key);
  return (await countHits(key, windowMs)) > max;
}