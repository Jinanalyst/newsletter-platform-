// 플랜별 기능 제한. 뉴스레터의 권한은 팀원이 아니라 소유자의 플랜으로 정한다.
//  - 결제 수단이 연결되지 않았으면(개발 환경 등) 살 방법이 없으므로 제한하지 않는다
//  - 제한이 도입되기 전에 가입한 계정은 유예 기간까지 Business 권한으로 쓴다 (PLAN_GRACE_CUTOFF, PLAN_GRACE_UNTIL)
import { db, now } from './db.js';
import { payappConfigured } from './payapp.js';

// automation: 0 없음, 1 기본(메일 단계·며칠 뒤 발송), 2 고급(조건부 발송·일시정지·날짜 지정)
export const LIMITS = {
  free: { monthly: 1000, analytics: false, domain: false, automation: 0, team: false, api: false, branding: false },
  pro: { monthly: 10000, analytics: true, domain: true, automation: 1, team: false, api: false, branding: true },
  business: { monthly: 50000, analytics: true, domain: true, automation: 2, team: true, api: true, branding: true },
};

const enforced = () => payappConfigured() || !!process.env.PG_PROVIDER;
const graceCutoff = () => process.env.PLAN_GRACE_CUTOFF || '2026-11-04T15:00:00.000Z'; // 2026-11-05 00:00 (한국 시간) 이전 가입
export const graceUntil = () => process.env.PLAN_GRACE_UNTIL || '2026-12-04T15:00:00.000Z'; // 2026-12-05 00:00 (한국 시간)까지
const inGrace = (u) => now() < graceUntil() && u.created_at < graceCutoff();

export function limitsFor(u) {
  if (!enforced()) return { ...LIMITS.business, plan: 'business', grace: false };
  if (u && LIMITS[u.plan] && u.plan_until && u.plan_until > now()) return { ...LIMITS[u.plan], plan: u.plan, grace: false };
  if (u && inGrace(u)) return { ...LIMITS.business, plan: 'business', grace: true };
  return { ...LIMITS.free, plan: 'free', grace: false };
}
export const ownerLimits = async (ownerId) => limitsFor(await db.prepare('SELECT plan, plan_until, created_at FROM users WHERE id=?').get(ownerId));

// 유료 권한이 있는 소유자만 고르는 SQL 조건 (users 별칭은 u)
export function paidOwnerSql() {
  if (!enforced()) return { sql: 'TRUE', params: [] };
  const paid = "(u.plan IN ('pro','business') AND COALESCE(u.plan_until,'')>?)", t = now();
  return now() < graceUntil() ? { sql: `(${paid} OR u.created_at<?)`, params: [t, graceCutoff()] } : { sql: paid, params: [t] };
}

// 이번 달(한국 시간) 소유자의 모든 뉴스레터에서 보낸 메일 수
const KST = 9 * 36e5;
export const monthKey = () => new Date(Date.now() + KST).toISOString().slice(0, 7);
const monthStart = () => new Date(Date.parse(`${monthKey()}-01T00:00:00Z`) - KST).toISOString();
export const monthlySent = async (ownerId) => (await db.prepare(`SELECT COUNT(*) n FROM send_log l JOIN posts p ON p.id=l.post_id JOIN newsletters n ON n.id=p.newsletter_id
  WHERE n.owner_id=? AND l.sent_at>=? AND l.error IS NULL`).get(ownerId, monthStart())).n;

// 커스텀 도메인 권한이 끝난 뉴스레터는 연결만 푼다. 주소는 남아 있어 다시 결제한 뒤 "연결 확인"으로 복구할 수 있다
export async function releaseLapsedDomains() {
  if (!enforced()) return 0;
  const { sql, params } = paidOwnerSql();
  return (await db.prepare(`UPDATE newsletters SET domain_verified_at=NULL WHERE domain_verified_at IS NOT NULL
    AND owner_id IN (SELECT u.id FROM users u WHERE NOT ${sql})`).run(...params)).changes;
}

export const upsell = (title, desc) => `<div class="card"><b>${title}</b><p class="mute">${desc}</p><a class="btn primary" href="/pricing">요금제 보기</a></div>`;
