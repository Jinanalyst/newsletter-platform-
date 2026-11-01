// 홈에서 입력한 주소(<이름>.lett.live)를 로그인·가입 과정 내내 기억해 두었다가, 뉴스레터에 자동으로 지정한다
import { Router } from 'express';
import { db, baseUrl } from './db.js';
import { cookie } from './auth.js';
import { PLATFORM_DOMAIN, RESERVED, SUB_RE } from './workspace.js';

export const claim = Router();

const COOKIE = 'claim_sub';
const clear = (res) => res.clearCookie(COOKIE);
const taken = async (sub) => !!(await db.prepare('SELECT 1 FROM newsletters WHERE subdomain=?').get(sub));

// 쿠키에 담긴 주소가 지금도 쓸 수 있으면 그 값을, 아니면 빈 문자열을 돌려준다
export async function claimedSub(req) {
  const sub = String(cookie(req, COOKIE) || '').toLowerCase();
  return SUB_RE.test(sub) && !RESERVED.has(sub) && !(await taken(sub)) ? sub : '';
}
export const claimedHost = (sub) => `${sub}.${PLATFORM_DOMAIN()}`;
export const clearClaim = clear;

// 홈의 주소 입력 → 기억해 두고 로그인으로 이어 준다 (이미 로그인했으면 바로 이어서 처리)
claim.get('/claim', async (req, res) => {
  const sub = String(req.query.sub || '').trim().toLowerCase();
  const home = (m) => res.redirect('/?m=' + encodeURIComponent(m) + '#claim');
  if (!sub) return res.redirect(req.user ? '/app/new' : '/signup');
  if (!SUB_RE.test(sub) || RESERVED.has(sub)) return home('사용할 수 없는 주소예요. 영문 소문자·숫자·하이픈으로 3~30자를 입력해 주세요.');
  if (await taken(sub)) return home(`${claimedHost(sub)} 는 이미 사용 중이에요. 다른 주소를 입력해 주세요.`);
  res.cookie(COOKIE, sub, { httpOnly: true, sameSite: 'lax', secure: baseUrl().startsWith('https://'), maxAge: 3600e3 });
  res.redirect(req.user ? '/claim/continue' : '/login');
});

// 로그인·가입이 끝난 뒤: 뉴스레터가 하나뿐이고 아직 주소가 없으면 거기에 지정하고, 아니면 새 뉴스레터 만들기로 이어 준다
claim.get('/claim/continue', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const sub = await claimedSub(req);
  if (!sub) { clear(res); return res.redirect('/app'); }
  const mine = await db.prepare('SELECT id, subdomain FROM newsletters WHERE owner_id=?').all(req.user.id);
  if (mine.length === 1 && !mine[0].subdomain) {
    await db.prepare('UPDATE newsletters SET subdomain=? WHERE id=?').run(sub, mine[0].id);
    clear(res);
    return res.redirect(`/app/n/${mine[0].id}/settings/domain?m=` + encodeURIComponent(`${claimedHost(sub)} 주소가 연결되었어요.`));
  }
  res.redirect('/app/new');
});

// 로그인 직후 기본 목적지(/app)로 오면, 기억해 둔 주소가 있을 때 이어서 처리
claim.get('/app', (req, res, next) => (req.user && cookie(req, COOKIE) ? res.redirect('/claim/continue') : next()));
