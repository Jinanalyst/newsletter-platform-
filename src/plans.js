// 플랫폼 요금제(Pro · Business): 요금제 페이지, 결제 시작, PG사 콜백, 플랜 활성화
// PG사 연동은 아래 PROVIDERS 에 어댑터를 하나 추가하고 PG_PROVIDER 환경 변수로 고르면 된다. PG_PROVIDER 가 없으면 페이앱 연동 값이 있을 때 페이앱을 쓴다.
// 어댑터가 하는 일: checkout(order, user) → 결제창 주소 / callback(req) → 승인된 주문 정보. 나머지(주문 기록·플랜 활성화)는 이 파일이 처리한다.
import { Router } from 'express';
import { db, now, baseUrl } from './db.js';
import { requireUser } from './auth.js';
import { h } from './render.js';
import { PLANS, won, planCards, compareTable, PLAN_CSS } from './plan-data.js';
import { sendMail } from './mail.js';
import { payappConfigured, call as payappCall, stopRebill, monthlyCycle, onPlanFeedback, plusDays, plusMonths } from './payapp.js';
export { PLANS };

export const plans = Router();

const PERIOD_DAYS = 30;
export const planActive = (u) => !!u && !!u.plan && !!u.plan_until && u.plan_until > now();

// ---------- PG 어댑터 ----------
// 개발용 모의 결제: 운영 환경에서는 켜지지 않는다
const mockOk = () => !process.env.VERCEL && process.env.NODE_ENV !== 'production';
const PROVIDERS = {
  mock: {
    enabled: mockOk,
    checkout: async (order) => `${baseUrl()}/pay/mock/${order.id}`,
  },
  // 월 자동 결제. 결제 확정은 공통 통보 주소(/payapp/feedback)로 오므로 callback 이 없다
  payapp: {
    enabled: payappConfigured,
    phone: true, // 페이앱 요청에 구매자 휴대폰 번호가 필요하다 (저장하지 않음)
    checkout: async (order, user, phone) => {
      const feedback = `${baseUrl()}/payapp/feedback`;
      const q = await payappCall('rebillRegist', { goodname: `${order.name} 월 구독`, goodprice: order.amount, recvphone: phone, recvemail: user.email, smsuse: 'n',
        feedbackurl: feedback, failurl: feedback, returnurl: `${baseUrl()}/pricing/done`, var1: `plan:${order.id}`, ...monthlyCycle() });
      await db.prepare('UPDATE plan_orders SET rebill_no=? WHERE id=?').run(q.get('rebill_no') || '', order.id);
      return q.get('payurl');
    },
  },
  // 예) toss: { enabled: () => !!process.env.TOSS_SECRET_KEY, checkout: async (order, user) => '<결제창 URL>', callback: async (req) => ({ orderId, ref }) }
};
const providerName = () => { const n = process.env.PG_PROVIDER || ''; return PROVIDERS[n]?.enabled() ? n : PROVIDERS.payapp.enabled() ? 'payapp' : ''; };
const provider = () => PROVIDERS[providerName()] || null;

// 결제 승인 확정: 대기 중인 주문을 한 번만 paid 로 바꾸고 이용 기간을 늘린다 (중복 콜백에도 안전)
export async function confirmOrder(orderId, ref = '') {
  const o = await db.prepare('SELECT * FROM plan_orders WHERE id=?').get(orderId);
  if (!o) return false;
  const t = now();
  const claimed = (await db.prepare("UPDATE plan_orders SET status='paid', paid_at=?, provider_ref=? WHERE id=? AND status='pending'").run(t, String(ref), o.id)).changes;
  if (!claimed) return false;
  const u = await db.prepare('SELECT plan, plan_until, payapp_rebill_no FROM users WHERE id=?').get(o.user_id);
  // 자동 결제는 매월 같은 날 청구되므로 이어 붙이지 않고, 갱신 지연에 대비해 3일 유예를 둔다
  if (o.rebill_no) {
    await db.prepare('UPDATE users SET plan=?, plan_until=?, payapp_rebill_no=? WHERE id=?').run(o.plan, plusDays(plusMonths(t, 1), 3), o.rebill_no, o.user_id);
    if (u?.payapp_rebill_no && u.payapp_rebill_no !== o.rebill_no) await stopRebill(u.payapp_rebill_no).catch((e) => console.error('이전 자동 결제 해지 실패', u.payapp_rebill_no, e.message));
    return true;
  }
  // 같은 플랜을 다시 결제하면 남은 기간 뒤로 이어 붙이고, 다른 플랜으로 바꾸면 오늘부터 새로 시작한다
  const from = u?.plan === o.plan && u.plan_until && u.plan_until > t ? u.plan_until : t;
  await db.prepare('UPDATE users SET plan=?, plan_until=? WHERE id=?').run(o.plan, new Date(new Date(from).getTime() + PERIOD_DAYS * 864e5).toISOString(), o.user_id);
  return true;
}

// ---------- 페이앱 결제 통보 (검증은 payapp.js 에서 끝난 뒤 호출된다) ----------
async function planPaid(b, o) {
  const ref = String(b.mul_no);
  if (Number(b.price) !== o.amount) throw new Error(`금액 불일치: 요금제 주문 ${o.id}, 통보 ${b.price}`);
  if (await db.prepare("SELECT id FROM plan_orders WHERE provider='payapp' AND provider_ref=?").get(ref)) return; // 이미 처리한 통보
  if (o.status === 'pending') return void await confirmOrder(o.id, ref);
  // 갱신 결제: 회차마다 주문을 하나씩 남긴다
  const u = await db.prepare('SELECT payapp_rebill_no FROM users WHERE id=?').get(o.user_id);
  const id = Number((await db.prepare("INSERT INTO plan_orders(user_id,plan,amount,provider,rebill_no,created_at) VALUES(?,?,?,'payapp',?,?)").run(o.user_id, o.plan, o.amount, o.rebill_no, now())).lastInsertRowid);
  if (u?.payapp_rebill_no === o.rebill_no) return void await confirmOrder(id, ref);
  // 해지했거나 다른 플랜으로 바꾼 자동 결제의 청구: 현재 플랜은 건드리지 않고 다시 끊는다. 환불은 운영자가 처리
  console.error('환불 확인 필요: 해지된 자동 결제의 청구', ref);
  await db.prepare("UPDATE plan_orders SET status='paid', paid_at=?, provider_ref=? WHERE id=?").run(now(), ref, id);
  await stopRebill(o.rebill_no).catch((e) => console.error('자동 결제 해지 실패', o.rebill_no, e.message));
}

// 승인 취소(환불): 환불된 결제가 현재 플랜이면 권한을 회수하고 이후 자동 결제도 끊는다
async function planRefunded(b) {
  const paid = await db.prepare("SELECT * FROM plan_orders WHERE provider='payapp' AND provider_ref=? AND status='paid'").get(String(b.mul_no));
  if (!paid) return;
  await db.prepare("UPDATE plan_orders SET status='refunded' WHERE id=?").run(paid.id);
  const u = await db.prepare('SELECT plan, payapp_rebill_no FROM users WHERE id=?').get(paid.user_id);
  if (u?.plan !== paid.plan) return;
  await db.prepare("UPDATE users SET plan='', plan_until=NULL, payapp_rebill_no='' WHERE id=?").run(paid.user_id);
  if (u.payapp_rebill_no) await stopRebill(u.payapp_rebill_no).catch((e) => console.error('자동 결제 해지 실패', u.payapp_rebill_no, e.message));
}

async function planRenewalFailed(o) {
  const u = await db.prepare('SELECT email, payapp_rebill_no FROM users WHERE id=?').get(o.user_id);
  if (!u || u.payapp_rebill_no !== o.rebill_no) return;
  const url = `${baseUrl()}/pricing`;
  sendMail({ to: u.email, subject: `[lett.] ${PLANS[o.plan]?.name || o.plan} 요금제 자동 결제에 실패했습니다`, fromName: 'lett.',
    html: `<p>등록된 결제 수단으로 요금제를 결제하지 못했습니다. 이용 기간이 끝나면 <a href="${h(url)}">요금제 페이지</a>에서 다시 결제해 주세요.</p>`,
    text: `등록된 결제 수단으로 요금제를 결제하지 못했습니다. 이용 기간이 끝나면 다시 결제해 주세요: ${url}` }).catch((e) => console.error('결제 실패 메일 오류', e.message));
}

onPlanFeedback(async (b) => {
  const id = String(b.var1 || '').startsWith('plan:') ? String(b.var1).slice(5) : '';
  // 첫 주문을 기준으로 금액을 검증한다 (갱신 회차도 첫 주문의 금액으로 청구된다)
  const o = (id && await db.prepare('SELECT * FROM plan_orders WHERE id=?').get(id))
    || (b.rebill_no && await db.prepare('SELECT * FROM plan_orders WHERE rebill_no=? ORDER BY id').get(String(b.rebill_no)));
  if (!o) return console.warn('페이앱 통보: 요금제 주문을 찾을 수 없음', b.mul_no);
  const state = String(b.pay_state);
  if (state === '4') await planPaid(b, o);
  else if (state === '9' || state === '64') await planRefunded(b);
  else if (state === '99') await planRenewalFailed(o);
  else if (state === '8' || state === '32') await db.prepare("UPDATE plan_orders SET status='cancelled' WHERE id=? AND status='pending'").run(o.id);
  else if (state === '70' || state === '71') console.warn('페이앱 부분 취소: 요금제 결제 확인 필요', b.orig_mul_no || b.mul_no);
});

// ---------- 요금제 페이지 ----------
plans.get('/pricing', (req, res) => {
  const t = req.t, u = req.user, pv = provider(), ready = !!pv;
  const askPhone = !!u && !!pv?.phone; // 번호 입력칸은 하나만 두고, 카드의 버튼이 이 폼을 제출한다
  const cur = planActive(u) ? u.plan : '';
  const button = (key, p) => (cur === key ? `<button class="plbtn off" disabled>${t('이용 중')} · ${new Date(u.plan_until).toLocaleDateString(req.lang === 'ko' ? 'ko-KR' : 'en-CA')}</button>` : u
    ? (askPhone ? `<button class="plbtn" form="plform" name="plan" value="${key}">${p.name} ${t('시작하기')}</button>`
      : `<form method="post" action="/pricing/subscribe" style="margin:0"><input type="hidden" name="plan" value="${key}"><button class="plbtn" ${ready ? '' : 'disabled'}>${ready ? `${p.name} ${t('시작하기')}` : t('준비 중')}</button></form>`)
    : `<a class="plbtn" href="/login">${t('로그인하고 시작하기')}</a>`);
  res.page(t('요금제'), `${PLAN_CSS}
<h1>${t('요금제')}</h1><p class="mute">${t('부가세 포함 · 결제일로부터 7일 이내 환불 가능')} · <a href="/refund">${t('환불 정책')}</a></p>
${ready ? '' : `<div class="msg">${t('결제 연동 준비 중입니다. 곧 이용하실 수 있어요.')}</div>`}
${u?.payapp_rebill_no && cur ? `<div class="card" style="margin-top:18px;max-width:760px"><p style="margin-top:0">${t('매월 자동 결제 중입니다.')} <span class="mute">${t('다른 플랜을 결제하면 기존 자동 결제는 해지되고, 새 플랜이 오늘부터 시작됩니다.')}</span></p>
<form method="post" action="/pricing/cancel" style="margin:0" onsubmit="return confirm('${t('자동 결제를 해지할까요? 이미 결제한 기간까지는 계속 이용할 수 있습니다.')}')"><button>${t('자동 결제 해지')}</button></form></div>` : ''}
${askPhone ? `<form id="plform" class="card" method="post" action="/pricing/subscribe" style="margin-top:18px;max-width:760px"><label>${t('휴대폰 번호')}</label><input type="tel" name="phone" required placeholder="01012345678" autocomplete="tel">
<p class="mute" style="margin-bottom:0">${t('결제 진행을 위해 결제대행사(페이앱)에 전달하며, Lett에는 저장하지 않습니다.')} ${t('매월 자동 결제되며 언제든 해지할 수 있습니다.')}</p></form>` : ''}
${planCards(t, button)}${compareTable(t)}`, { msg: req.query.m });
});

// ---------- 결제 시작 ----------
plans.post('/pricing/subscribe', requireUser, async (req, res) => {
  const p = PLANS[req.body.plan], pv = provider();
  const to = (m) => res.redirect('/pricing?m=' + encodeURIComponent(m));
  if (!p) return to(req.t('알 수 없는 요금제입니다.'));
  if (!pv) return to(req.t('결제 연동 준비 중입니다. 곧 이용하실 수 있어요.'));
  if (planActive(req.user) && req.user.plan === req.body.plan) return to(req.t('이미 이용 중인 요금제입니다.'));
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  if (pv.phone && !/^01\d{8,9}$/.test(phone)) return to(req.t('휴대폰 번호를 확인해 주세요.'));
  const id = Number((await db.prepare("INSERT INTO plan_orders(user_id,plan,amount,provider,created_at) VALUES(?,?,?,?,?)").run(req.user.id, req.body.plan, p.price, providerName(), now())).lastInsertRowid);
  try { res.redirect(303, await pv.checkout({ id, plan: req.body.plan, amount: p.price, name: `lett. ${p.name}` }, req.user, phone)); }
  catch (e) { console.error('결제 시작 실패', e.message); await db.prepare("UPDATE plan_orders SET status='failed' WHERE id=?").run(id); to(req.t('결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')); }
});

// 페이앱 자동 결제 해지: 이미 결제한 기간까지는 유지한다
plans.post('/pricing/cancel', requireUser, async (req, res) => {
  const to = (m) => res.redirect('/pricing?m=' + encodeURIComponent(m));
  if (!req.user.payapp_rebill_no) return to(req.t('자동 결제를 해지했습니다.'));
  try { await stopRebill(req.user.payapp_rebill_no); } catch (e) {
    console.error('요금제 자동 결제 해지 실패', e.message);
    return to(req.t('자동 결제를 해지하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
  }
  await db.prepare("UPDATE users SET payapp_rebill_no='' WHERE id=?").run(req.user.id);
  to(req.t('자동 결제를 해지했습니다.'));
});

// 페이앱 결제창에서 돌아오는 주소 (POST 로 올 수 있다). 결제 확정은 통보로 처리된다
plans.all('/pricing/done', (req, res) => res.redirect(303, '/pricing?m=' + encodeURIComponent(req.t('결제가 확인되면 곧 요금제가 적용됩니다.'))));

// PG사가 승인 결과를 알려 오는 주소 (어댑터의 callback 이 서명 검증·주문 식별을 맡는다)
plans.all('/pay/callback/:provider', async (req, res) => {
  const pv = PROVIDERS[req.params.provider];
  if (!pv?.enabled() || !pv.callback) return res.status(404).send('not found');
  try {
    const r = await pv.callback(req);
    if (r?.orderId) await confirmOrder(r.orderId, r.ref);
    res.json({ ok: true });
  } catch (e) { console.error('결제 콜백 오류', e.message); res.status(400).json({ ok: false }); }
});

// ---------- 개발용 모의 결제창 ----------
plans.get('/pay/mock/:id', requireUser, async (req, res) => {
  if (!mockOk()) return res.status(404).send('not found');
  const o = await db.prepare("SELECT * FROM plan_orders WHERE id=? AND user_id=? AND status='pending'").get(req.params.id, req.user.id);
  if (!o) return res.redirect('/pricing');
  res.page('모의 결제', `<h1>모의 결제 (개발용)</h1><p>${h(PLANS[o.plan]?.name || o.plan)} · ${won(o.amount)}</p><p class="mute">실제 결제가 일어나지 않습니다. PG사 연동 후에는 이 화면 대신 PG 결제창이 열립니다.</p>
<form method="post" action="/pay/mock/${o.id}/complete"><button class="primary">결제 완료 처리</button></form>`);
});
plans.post('/pay/mock/:id/complete', requireUser, async (req, res) => {
  if (!mockOk()) return res.status(404).send('not found');
  const o = await db.prepare('SELECT id FROM plan_orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (o) await confirmOrder(o.id, 'mock-' + o.id);
  res.redirect('/pricing?m=' + encodeURIComponent(req.t('요금제가 적용되었습니다.')));
});
