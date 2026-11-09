// 플랜별 기능 제한과 거래 수수료. 뉴스레터의 권한은 팀원이 아니라 소유자의 플랜으로 정한다.
//  - 플랜의 값은 plan-data.js 의 PLAN_CONFIG 한 곳에서 관리한다
//  - 결제 수단이 연결되지 않았으면(개발 환경 등) 살 방법이 없으므로 제한하지 않는다. 수수료는 이때도 실제 플랜 기준이다
//  - 제한이 도입되기 전에 가입한 계정은 유예 기간까지 Business 권한으로 쓴다 (PLAN_GRACE_CUTOFF, PLAN_GRACE_UNTIL)
import { db, now, baseUrl } from './db.js';
import { payappConfigured } from './payapp.js';
import { sendMail } from './mail.js';
import { PLAN_CONFIG } from './plan-data.js';

export const LIMITS = Object.fromEntries(Object.entries(PLAN_CONFIG).map(([k, p]) => [k, { ...p, analytics: p.stats >= 2, team: p.seats > 1 }]));

const enforced = () => payappConfigured() || !!process.env.PG_PROVIDER;
const graceCutoff = () => process.env.PLAN_GRACE_CUTOFF || '2026-11-04T15:00:00.000Z'; // 2026-11-05 00:00 (한국 시간) 이전 가입
export const graceUntil = () => process.env.PLAN_GRACE_UNTIL || '2026-12-04T15:00:00.000Z'; // 2026-12-05 00:00 (한국 시간)까지
const inGrace = (u) => now() < graceUntil() && u.created_at < graceCutoff();

// 운영자 계정: 요금제 한도 없이 모든 기능을 쓴다. UNLIMITED_EMAILS(쉼표 구분)로 바꿀 수 있고, 이메일 인증을 마친 계정만 해당된다
const unlimitedEmails = () => String(process.env.UNLIMITED_EMAILS ?? 'jangj6091@gmail.com').toLowerCase().split(/[,\s]+/).filter(Boolean);
const isUnlimited = (u) => !!u && !!u.verified && unlimitedEmails().includes(String(u.email || '').toLowerCase());

export function limitsFor(u) {
  if (isUnlimited(u)) return { ...LIMITS.business, plan: 'business', name: 'Business', subscribers: null, monthly: 1e9, seats: 100, grace: false, unlimited: true };
  const paid = u && LIMITS[u.plan] && u.plan_until && u.plan_until > now() ? u.plan : '';
  if (!enforced()) { const plan = paid || 'free'; return { ...LIMITS.business, plan, feePct: LIMITS[plan].feePct, name: LIMITS[plan].name, grace: false, open: true }; }
  if (paid) return { ...LIMITS[paid], plan: paid, grace: false };
  if (u && inGrace(u)) return { ...LIMITS.business, plan: 'business', grace: true };
  return { ...LIMITS.free, plan: 'free', grace: false };
}
// 더 올릴 요금제가 있는지 (유예 중인 계정은 실제로 결제한 플랜이 없으므로 있음)
export const hasUpgrade = (lim) => lim.grace || lim.plan !== 'business';
export const ownerLimits = async (ownerId) => limitsFor(await db.prepare('SELECT email, verified, plan, plan_until, created_at FROM users WHERE id=?').get(ownerId));

// 유료 권한이 있는 소유자만 고르는 SQL 조건 (users 별칭은 u)
export function paidOwnerSql() {
  if (!enforced()) return { sql: 'TRUE', params: [] };
  const paid = "(u.plan IN ('pro','business') AND COALESCE(u.plan_until,'')>?)", t = now();
  const un = unlimitedEmails(), owner = un.length ? ` OR (u.verified=1 AND LOWER(u.email) IN (${un.map(() => '?').join(',')}))` : '';
  return now() < graceUntil() ? { sql: `(${paid} OR u.created_at<?${owner})`, params: [t, graceCutoff(), ...un] } : { sql: `(${paid}${owner})`, params: [t, ...un] };
}

// 이번 달(한국 시간) 소유자의 모든 뉴스레터에서 보낸 메일 수
const KST = 9 * 36e5;
export const monthKey = () => new Date(Date.now() + KST).toISOString().slice(0, 7);
const monthStart = (key = monthKey()) => new Date(Date.parse(`${key}-01T00:00:00Z`) - KST).toISOString();
// 한국 시간 달력 기준 그 달의 [시작, 다음 달 시작)
export function monthRange(key = monthKey()) {
  const [y, m] = key.split('-').map(Number);
  return [monthStart(key), monthStart(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7))];
}
export const monthlySent = async (ownerId) => (await db.prepare(`SELECT COUNT(*) n FROM send_log l JOIN posts p ON p.id=l.post_id JOIN newsletters n ON n.id=p.newsletter_id
  WHERE n.owner_id=? AND l.sent_at>=? AND l.error IS NULL`).get(ownerId, monthStart())).n;

// ---------- 구독자 한도 (소유자의 모든 뉴스레터 합계) ----------
export const subscriberCount = async (ownerId) => (await db.prepare(`SELECT COUNT(*) n FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE n.owner_id=? AND s.status='active'`).get(ownerId)).n;
export async function subscriberRoom(ownerId) {
  const lim = await ownerLimits(ownerId);
  return lim.subscribers === null ? Infinity : Math.max(0, lim.subscribers - await subscriberCount(ownerId));
}
// 구독자 한도에 닿으면 소유자에게 한 달에 한 번 알린다. 이미 있는 구독자는 그대로 두고 새 구독만 막는다
export async function notifySubscriberLimit(ownerId) {
  const m = monthKey();
  if (!(await db.prepare('UPDATE users SET sub_notice_month=? WHERE id=? AND sub_notice_month<>?').run(m, ownerId, m)).changes) return;
  const u = await db.prepare('SELECT email FROM users WHERE id=?').get(ownerId), url = `${baseUrl()}/pricing`;
  const lim = await ownerLimits(ownerId), up = hasUpgrade(lim), cap = lim.subscribers?.toLocaleString('ko-KR');
  sendMail({ to: u.email, subject: '[lett.] 구독자 한도에 도달했습니다', fromName: 'lett.',
    html: `<p>현재 요금제의 구독자 한도 ${cap}명에 도달해 새 구독을 받지 못하고 있습니다. 기존 구독자와 뉴스레터는 그대로 유지됩니다.${up ? ` <a href="${url}">요금제</a>를 올리면 바로 다시 받을 수 있습니다.` : ''}</p>`,
    text: `현재 요금제의 구독자 한도 ${cap}명에 도달해 새 구독을 받지 못하고 있습니다.${up ? ` 요금제를 올리면 바로 다시 받을 수 있습니다: ${url}` : ''}` }).catch((e) => console.error('구독자 한도 안내 메일 오류', e.message));
}

// 한도의 80%를 넘으면 운영 화면에 보여 주는 안내
export async function usageNotice(ownerId) {
  const lim = await ownerLimits(ownerId);
  if (lim.open) return '';
  const subs = await subscriberCount(ownerId), sent = await monthlySent(ownerId), notes = [];
  if (lim.subscribers !== null && subs >= lim.subscribers) notes.push(`구독자 한도 ${lim.subscribers.toLocaleString('ko-KR')}명에 도달해 새 구독을 받을 수 없습니다.`);
  else if (lim.subscribers !== null && subs >= lim.subscribers * 0.8) notes.push(`구독자 ${subs.toLocaleString('ko-KR')}명으로 한도 ${lim.subscribers.toLocaleString('ko-KR')}명에 가까워졌습니다.`);
  if (sent >= lim.monthly) notes.push(`이번 달 이메일 발송량 ${lim.monthly.toLocaleString('ko-KR')}건을 모두 사용했습니다.`);
  else if (sent >= lim.monthly * 0.8) notes.push(`이번 달 이메일을 ${sent.toLocaleString('ko-KR')}건 보내 한도 ${lim.monthly.toLocaleString('ko-KR')}건에 가까워졌습니다.`);
  return notes.length ? `<div class="msg">${notes.join(' ')}${hasUpgrade(lim) ? ' <a href="/pricing">상위 요금제 보기</a>' : ''}</div>` : '';
}

// ---------- 거래 수수료 ----------
// 결제대행(PG) 수수료율은 계약마다 다르고 페이앱 통보에도 금액이 오지 않는다. PG_FEE_PCT 를 넣기 전에는 계산하지 않고 "별도"로 표시한다
export const pgFeePct = () => { const v = Number(process.env.PG_FEE_PCT); return process.env.PG_FEE_PCT && v >= 0 && v <= 50 ? v : null; };
// 결제 시점의 요금제로 수수료를 정해 기록한다
export async function saleFees(ownerId, amount) {
  const lim = await ownerLimits(ownerId), pg = pgFeePct();
  return { fee: Math.round((amount * lim.feePct) / 100), fee_pct: lim.feePct, creator_plan: lim.plan, pg_fee: pg === null ? 0 : Math.round((amount * pg) / 100) };
}
// 크리에이터의 기간 매출: 총매출(gross), Lett 수수료(fee), 결제 수수료(pg), 예상 정산금액(net)
export async function creatorSales(ownerId, [from, to]) {
  const r = await db.prepare(`SELECT COALESCE(SUM(amount),0) gross, COALESCE(SUM(fee),0) fee, COALESCE(SUM(pg_fee),0) pg, COUNT(*) n FROM (
    SELECT p.amount, p.fee, p.pg_fee FROM payments p JOIN newsletters n ON n.id=p.newsletter_id WHERE n.owner_id=? AND p.created_at>=? AND p.created_at<?
    UNION ALL SELECT amount, fee, pg_fee FROM course_sales WHERE owner_id=? AND created_at>=? AND created_at<?) x`).get(ownerId, from, to, ownerId, from, to);
  return { ...r, net: r.gross - r.fee - r.pg };
}

// 커스텀 도메인 권한이 끝난 뉴스레터는 연결만 푼다. 주소는 남아 있어 다시 결제한 뒤 "연결 확인"으로 복구할 수 있다
export async function releaseLapsedDomains() {
  if (!enforced()) return 0;
  const { sql, params } = paidOwnerSql();
  return (await db.prepare(`UPDATE newsletters SET domain_verified_at=NULL WHERE domain_verified_at IS NOT NULL
    AND owner_id IN (SELECT u.id FROM users u WHERE NOT ${sql})`).run(...params)).changes;
}

export const upsell = (title, desc) => `<div class="card"><b>${title}</b><p class="mute">${desc}</p><a class="btn primary" href="/pricing">요금제 보기</a></div>`;
