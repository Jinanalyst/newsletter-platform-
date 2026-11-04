// 페이앱(PayApp) 결제: 뉴스레터 유료 구독. Pro·Business 요금제는 plans.js 가 같은 API와 통보 주소를 쓴다.
//  - 월간은 정기결제(rebillRegist), 연간은 페이앱에 연간 주기가 없어 1년치 단건 결제(payrequest)로 처리하고 만료 전에 메일로 알린다.
//  - 결제 확정은 feedbackurl 통보로만 한다. 검증 후 'SUCCESS'를 돌려주고, 처리에 실패하면 페이앱이 다시 통보한다.
//  - 구매자 휴대폰 번호는 페이앱에 넘기기만 하고 저장하지 않는다.
//  - 독자 결제는 대금이 Lett 판매자 계정으로 들어오는 구조라, 정산 방식이 확정되기 전에는 CREATOR_PAYMENTS_ENABLED=1 일 때만 연다.
//    페이앱 문서에 분할 정산·수수료 자동 차감 기능이 없어 수수료는 장부로만 계산한다. 이미 등록된 자동 결제의 통보와 해지는 값과 무관하게 처리한다.
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, now, baseUrl } from './db.js';
import { saleFees } from './plan-limits.js';
import { sendMail } from './mail.js';
import { h } from './render.js';

const API = 'https://api.payapp.kr/oapi/v2';
const env = (k) => process.env[`PAYAPP_${k}`] || '';
export const payappConfigured = () => !!(env('USERID') && env('LINKKEY') && env('LINKVAL') && env('REQUESTKEY'));
export const MIN_PRICE = 1000; // 페이앱 결제 최소 금액
export const creatorPaymentsOn = () => process.env.CREATOR_PAYMENTS_ENABLED === '1';
export const contentPayapp = () => payappConfigured() && creatorPaymentsOn();

// 결제 결과 기록 (운영자 화면용). 같은 통보가 다시 와도 한 번만 남고, 기록 실패가 결제 처리를 막지 않는다
export const logPayment = ({ kind, state, ref, userId = null, newsletterId = null, amount = 0, message = '' }) =>
  db.prepare('INSERT OR IGNORE INTO payment_events(kind,state,ref,user_id,newsletter_id,amount,message,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(kind, state, String(ref), userId, newsletterId, Number(amount) || 0, String(message).slice(0, 200), now()).catch((e) => console.error('결제 기록 오류', e.message));
const failRef = (b, no) => String(b.mul_no || `${no}:${now().slice(0, 10)}`); // 자동 결제 실패 통보에는 결제 번호가 없을 수 있다
export const startCheckoutFailed = (kind, orderId, userId, newsletterId, amount, e) => logPayment({ kind, state: 'failed', ref: `order:${orderId}`, userId, newsletterId, amount, message: `결제 시작 실패: ${e.message}` });

const KST = 9 * 36e5;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const stamp = () => new Date(Date.now() + KST).toISOString().replace(/\D/g, '').slice(0, 14); // yyyymmddhhiiss (한국 시간)
const kstDate = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
export const plusDays = (iso, d) => new Date(new Date(iso).getTime() + d * 864e5).toISOString();
export function plusMonths(iso, n) { // 말일을 넘기지 않는다 (1/31 + 1개월 → 2/28)
  const d = new Date(iso), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString();
}

// 응답은 JSON이 아니라 쿼리 문자열이다
export async function call(cmd, params) {
  const userid = env('USERID'), requestdate = stamp();
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ cmd, userid, linkkey: env('LINKKEY'), requestdate, hash: sha256(userid + requestdate + env('REQUESTKEY')), ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const q = new URLSearchParams(await r.text());
  if (!r.ok || q.get('state') !== '1') throw new Error(q.get('errorMessage') || `페이앱 오류 (HTTP ${r.status})`);
  return q;
}

// 매월 자동 결제 주기
export const monthlyCycle = () => {
  const day = new Date(Date.now() + KST).getUTCDate();
  return {
    rebillCycleType: 'Month',
    rebillCycleMonth: day >= 29 ? 90 : day, // 29~31일에 시작하면 짧은 달에도 빠지지 않도록 말일(90)로
    rebillExpire: kstDate(Date.now() + 3650 * 864e5), // 필수 값이라 충분히 먼 날짜로 둔다
  };
};

const goodName = (name) => String(name).replace(/(https?:\/\/|www\.)\S*/gi, '').trim() || '뉴스레터'; // 상품명에는 URL을 넣을 수 없다
const upgradeUrl = (slug, token) => `${baseUrl()}/n/${slug}/upgrade?t=${token}`;

// ---------- 결제 시작 ----------
// 결제창 주소를 돌려준다. 주문에 금액을 남겨 두어, 발행자가 가격을 바꿔도 기존 자동 결제의 통보를 검증할 수 있게 한다
export async function startCheckout(nl, sub, plan, phone) {
  const amount = plan === 'yearly' ? nl.price_yearly : nl.price_monthly;
  await cancelRebill(sub); // 결제 실패로 만료된 자동 결제가 남아 있으면 이중 청구되지 않도록 먼저 끊는다
  const id = Number((await db.prepare('INSERT INTO payapp_orders(subscriber_id,plan,amount,created_at) VALUES(?,?,?,?)').run(sub.id, plan, amount, now())).lastInsertRowid);
  const common = {
    goodname: `${goodName(nl.name)} 유료 구독 (${plan === 'yearly' ? '연간' : '월간'})`,
    recvphone: phone,
    recvemail: sub.email,
    smsuse: 'n', // 결제창으로 바로 보내므로 결제 요청 문자는 보내지 않는다
    feedbackurl: `${baseUrl()}/payapp/feedback`,
    returnurl: `${baseUrl()}/n/${nl.slug}/upgrade/done`,
    var1: String(id),
  };
  try {
    if (plan === 'yearly') {
      const q = await call('payrequest', { ...common, price: amount, checkretry: 'y' });
      await db.prepare('UPDATE payapp_orders SET mul_no=? WHERE id=?').run(q.get('mul_no') || '', id);
      return q.get('payurl');
    }
    const q = await call('rebillRegist', { ...common, goodprice: amount, ...monthlyCycle(), failurl: `${baseUrl()}/payapp/feedback` });
    await db.prepare('UPDATE payapp_orders SET rebill_no=? WHERE id=?').run(q.get('rebill_no') || '', id);
    return q.get('payurl');
  } catch (e) {
    await db.prepare("UPDATE payapp_orders SET status='failed' WHERE id=?").run(id);
    await startCheckoutFailed('content', id, nl.owner_id, nl.id, amount, e);
    throw e;
  }
}

// ---------- 자동 결제 해지 ----------
// 이미 결제한 기간(paid_until)은 유지한다. 실패하면 예외를 던지므로 호출하는 쪽에서 처리한다
export async function stopRebill(rebillNo) {
  await call('rebillCancel', { rebill_no: rebillNo });
  await db.prepare("UPDATE payapp_orders SET status='cancelled' WHERE rebill_no=?").run(rebillNo);
}
export async function cancelRebill(sub) {
  if (!sub?.payapp_rebill_no) return;
  await stopRebill(sub.payapp_rebill_no);
  await db.prepare("UPDATE subscribers SET payapp_rebill_no='', plan='' WHERE id=?").run(sub.id);
}
export async function cancelNewsletterRebills(newsletterId) {
  const subs = await db.prepare("SELECT id, payapp_rebill_no FROM subscribers WHERE newsletter_id=? AND payapp_rebill_no!=''").all(newsletterId);
  for (const s of subs) await cancelRebill(s);
}

// 연간 구독은 자동 갱신이 없으므로 만료 30일 전부터 연장 결제를 받는다
export const renewable = (sub) => sub.plan === 'yearly' && !sub.stripe_sub && !sub.payapp_rebill_no && !!sub.paid_until && sub.paid_until <= plusDays(now(), 30);

// ---------- 결제 통보 (feedbackurl) ----------
const same = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };
const RESPONSE_MAX_AGE = 24 * 36e5; // 페이앱의 재통보(최대 10회)도 받아야 하므로 요청 API의 ±15분보다 넉넉하게 둔다
function verified(b) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(b.responsedate || ''));
  if (!m) return false;
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - KST;
  if (Math.abs(Date.now() - at) > RESPONSE_MAX_AGE) return false;
  return same(b.userid, env('USERID')) && same(b.linkkey, env('LINKKEY')) && same(b.linkval, env('LINKVAL'))
    && same(String(b.hash || '').toLowerCase(), sha256(env('USERID') + b.responsedate + env('REQUESTKEY')));
}

async function onPaid(b, order) {
  if (Number(b.price) !== order.amount) throw new Error(`금액 불일치: 주문 ${order.id}, 통보 ${b.price}`);
  const sub = await db.prepare('SELECT * FROM subscribers WHERE id=?').get(order.subscriber_id);
  if (!sub) { // 구독자·뉴스레터가 삭제된 뒤 결제된 경우: 더 청구되지 않게 끊고 환불은 운영자가 처리
    console.error('환불 확인 필요: 삭제된 구독자의 결제', b.mul_no);
    if (order.rebill_no) await stopRebill(order.rebill_no);
    return;
  }
  const invoice = `payapp:${b.mul_no}`;
  const { owner_id: ownerId } = await db.prepare('SELECT owner_id FROM newsletters WHERE id=?').get(sub.newsletter_id);
  const fees = await saleFees(ownerId, order.amount);
  const claimed = (await db.prepare('INSERT OR IGNORE INTO payments(newsletter_id,subscriber_id,invoice_id,plan,amount,fee,fee_pct,creator_plan,pg_fee,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(sub.newsletter_id, sub.id, invoice, order.plan, order.amount, fees.fee, fees.fee_pct, fees.creator_plan, fees.pg_fee, 'krw', now())).changes;
  if (!claimed) return; // 이미 처리한 통보
  try {
    // 해지·수신 거부 뒤에 들어온 자동 결제면 기간만 반영하고 다음 결제를 끊는다
    const stop = order.rebill_no && (order.status === 'cancelled' || sub.status !== 'active');
    const t = now();
    const until = order.plan === 'yearly'
      ? plusMonths(sub.paid_until && sub.paid_until > t ? sub.paid_until : t, 12)
      : plusDays(plusMonths(t, 1), 3); // 갱신 지연 대비 3일 유예
    await db.prepare("UPDATE subscribers SET tier='paid', plan=?, paid_until=?, payapp_rebill_no=?, renew_notice_at=NULL WHERE id=?")
      .run(stop ? '' : order.plan, until, stop ? '' : order.rebill_no, sub.id);
    await db.prepare("UPDATE payapp_orders SET status=CASE WHEN status='cancelled' THEN status ELSE 'paid' END, mul_no=? WHERE id=?").run(String(b.mul_no), order.id);
    const old = sub.payapp_rebill_no && sub.payapp_rebill_no !== order.rebill_no ? sub.payapp_rebill_no : '';
    for (const no of [stop && order.rebill_no, old]) if (no) await stopRebill(no).catch((e) => console.error('자동 결제 해지 실패', no, e.message));
    await logPayment({ kind: 'content', state: 'paid', ref: b.mul_no, userId: ownerId, newsletterId: sub.newsletter_id, amount: order.amount });
  } catch (e) {
    await db.prepare('DELETE FROM payments WHERE invoice_id=?').run(invoice); // 재통보 때 다시 처리되도록 되돌린다
    throw e;
  }
}

// 승인 취소(환불): 정산 대상에서 빼고 유료 권한을 회수하며 이후 자동 결제도 끊는다
async function onRefunded(b, order) {
  const removed = (await db.prepare('DELETE FROM payments WHERE invoice_id=?').run(`payapp:${b.mul_no}`)).changes;
  if (!removed) return;
  await db.prepare("UPDATE subscribers SET tier='free', paid_until=NULL, plan='', payapp_rebill_no='' WHERE id=?").run(order.subscriber_id);
  await db.prepare("UPDATE payapp_orders SET status='cancelled' WHERE id=?").run(order.id);
  if (order.rebill_no) await stopRebill(order.rebill_no).catch((e) => console.error('자동 결제 해지 실패', order.rebill_no, e.message));
  const nl = await db.prepare('SELECT n.id, n.owner_id FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE s.id=?').get(order.subscriber_id);
  await logPayment({ kind: 'content', state: 'refunded', ref: b.mul_no, userId: nl?.owner_id, newsletterId: nl?.id, amount: order.amount });
}

async function onRenewalFailed(order, b) {
  const sub = await db.prepare('SELECT s.*, n.name nl_name, n.slug nl_slug, n.owner_id FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE s.id=?').get(order.subscriber_id);
  if (!sub) return;
  await logPayment({ kind: 'content', state: 'failed', ref: failRef(b, order.rebill_no), userId: sub.owner_id, newsletterId: sub.newsletter_id, amount: order.amount, message: '자동 결제 실패' });
  const url = upgradeUrl(sub.nl_slug, sub.token);
  sendMail({ to: sub.email, subject: `[${sub.nl_name}] 자동 결제에 실패했습니다`, fromName: sub.nl_name,
    html: `<p>등록된 결제 수단으로 유료 구독료를 결제하지 못했습니다. 이용 기간이 끝나면 <a href="${h(url)}">유료 구독 페이지</a>에서 다시 결제해 주세요.</p>`,
    text: `등록된 결제 수단으로 유료 구독료를 결제하지 못했습니다. 이용 기간이 끝나면 다시 결제해 주세요: ${url}` }).catch((e) => console.error('결제 실패 메일 오류', e.message));
}

let planHandler = null; // 요금제 결제 통보는 plans.js 가 처리한다
export const onPlanFeedback = (fn) => { planHandler = fn; };
export { failRef };

async function handleFeedback(b) {
  const forPlan = String(b.var1 || '').startsWith('plan:')
    || (b.rebill_no && await db.prepare('SELECT id FROM plan_orders WHERE rebill_no=?').get(String(b.rebill_no)));
  if (forPlan) return planHandler(b);
  const order = (b.rebill_no && await db.prepare('SELECT * FROM payapp_orders WHERE rebill_no=? ORDER BY id DESC').get(String(b.rebill_no)))
    || (b.var1 && await db.prepare('SELECT * FROM payapp_orders WHERE id=?').get(String(b.var1)));
  if (!order) return console.warn('페이앱 통보: 주문을 찾을 수 없음', b.mul_no); // 공통 통보 URL로 들어온 다른 결제일 수 있다
  const state = String(b.pay_state);
  if (state === '4') await onPaid(b, order);
  else if (state === '9' || state === '64') await onRefunded(b, order);
  else if (state === '99') await onRenewalFailed(order, b);
  else if (state === '8' || state === '32') await db.prepare("UPDATE payapp_orders SET status='cancelled' WHERE id=? AND status='pending'").run(order.id);
  else if (state === '70' || state === '71') {
    console.warn('페이앱 부분 취소: 정산 금액 확인 필요', b.orig_mul_no || b.mul_no);
    await logPayment({ kind: 'content', state: 'partial', ref: b.mul_no, amount: b.price, message: '부분 취소: 정산 금액 확인 필요' });
  }
}

export async function payappFeedback(req, res) {
  const b = req.body ?? {};
  if (!payappConfigured() || !verified(b)) {
    console.warn('페이앱 통보 검증 실패', b.mul_no);
    return res.status(400).type('text').send('FAIL');
  }
  try { await handleFeedback(b); } catch (e) {
    console.error('페이앱 통보 처리 오류', e.message);
    await logPayment({ kind: 'unknown', state: 'error', ref: b.mul_no || b.rebill_no || '', amount: b.price, message: e.message });
    return res.status(500).type('text').send('FAIL');
  }
  res.type('text').send('SUCCESS');
}

// ---------- 연간 구독 만료 안내 (주기 작업) ----------
export async function sendRenewalNotices() {
  if (!contentPayapp()) return 0;
  const t = now();
  const subs = await db.prepare(`SELECT s.*, n.name nl_name, n.slug nl_slug, n.price_yearly FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id
    WHERE s.tier='paid' AND s.plan='yearly' AND s.status='active' AND s.stripe_sub='' AND s.payapp_rebill_no='' AND s.renew_notice_at IS NULL AND s.paid_until>? AND s.paid_until<=? LIMIT 50`).all(t, plusDays(t, 14));
  let sent = 0;
  for (const s of subs) {
    if (!s.price_yearly) continue;
    const claimed = (await db.prepare('UPDATE subscribers SET renew_notice_at=? WHERE id=? AND renew_notice_at IS NULL').run(t, s.id)).changes;
    if (!claimed) continue; // 다른 인스턴스가 먼저 보냄
    const url = upgradeUrl(s.nl_slug, s.token), until = kstDate(new Date(s.paid_until).getTime());
    try {
      await sendMail({ to: s.email, subject: `[${s.nl_name}] 연간 구독이 ${until}에 끝납니다`, fromName: s.nl_name,
        html: `<p>연간 구독은 자동으로 갱신되지 않습니다. 계속 이용하려면 <a href="${h(url)}">유료 구독 페이지</a>에서 연장해 주세요. 남은 기간은 그대로 이어집니다.</p>`,
        text: `연간 구독은 자동으로 갱신되지 않습니다. 계속 이용하려면 연장해 주세요. 남은 기간은 그대로 이어집니다: ${url}` });
      sent++;
    } catch (e) {
      console.error('연간 구독 안내 메일 오류', e.message);
      await db.prepare('UPDATE subscribers SET renew_notice_at=NULL WHERE id=?').run(s.id);
    }
  }
  return sent;
}
