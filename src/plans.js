// 플랫폼 요금제(Pro · Business): 요금제 페이지, 결제 시작, PG사 콜백, 플랜 활성화
// PG사 연동은 아래 PROVIDERS 에 어댑터를 하나 추가하고 PG_PROVIDER 환경 변수로 고르면 된다.
// 어댑터가 하는 일: checkout(order, user) → 결제창 주소 / callback(req) → 승인된 주문 정보. 나머지(주문 기록·플랜 활성화)는 이 파일이 처리한다.
import { Router } from 'express';
import { db, now, baseUrl } from './db.js';
import { requireUser } from './auth.js';
import { h } from './render.js';
import { PLANS, won, planCards, PLAN_CSS } from './plan-data.js';
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
  // 예) toss: { enabled: () => !!process.env.TOSS_SECRET_KEY, checkout: async (order, user) => '<결제창 URL>', callback: async (req) => ({ orderId, ref }) }
};
const provider = () => { const p = PROVIDERS[process.env.PG_PROVIDER || '']; return p?.enabled() ? p : null; };
const providerName = () => (provider() ? process.env.PG_PROVIDER : '');

// 결제 승인 확정: 대기 중인 주문을 한 번만 paid 로 바꾸고 이용 기간을 늘린다 (중복 콜백에도 안전)
export async function confirmOrder(orderId, ref = '') {
  const o = await db.prepare('SELECT * FROM plan_orders WHERE id=?').get(orderId);
  if (!o) return false;
  const t = now();
  const claimed = (await db.prepare("UPDATE plan_orders SET status='paid', paid_at=?, provider_ref=? WHERE id=? AND status='pending'").run(t, String(ref), o.id)).changes;
  if (!claimed) return false;
  const u = await db.prepare('SELECT plan, plan_until FROM users WHERE id=?').get(o.user_id);
  // 같은 플랜을 다시 결제하면 남은 기간 뒤로 이어 붙이고, 다른 플랜으로 바꾸면 오늘부터 새로 시작한다
  const from = u?.plan === o.plan && u.plan_until && u.plan_until > t ? u.plan_until : t;
  await db.prepare('UPDATE users SET plan=?, plan_until=? WHERE id=?').run(o.plan, new Date(new Date(from).getTime() + PERIOD_DAYS * 864e5).toISOString(), o.user_id);
  return true;
}

// ---------- 요금제 페이지 ----------
plans.get('/pricing', (req, res) => {
  const t = req.t, u = req.user, ready = !!provider();
  const cur = planActive(u) ? u.plan : '';
  const button = (key, p) => (cur === key ? `<button class="plbtn off" disabled>${t('이용 중')} · ${new Date(u.plan_until).toLocaleDateString(req.lang === 'ko' ? 'ko-KR' : 'en-CA')}</button>` : u
    ? `<form method="post" action="/pricing/subscribe" style="margin:0"><input type="hidden" name="plan" value="${key}"><button class="plbtn" ${ready ? '' : 'disabled'}>${ready ? `${p.name} ${t('시작하기')}` : t('준비 중')}</button></form>`
    : `<a class="plbtn" href="/login">${t('로그인하고 시작하기')}</a>`);
  res.page(t('요금제'), `${PLAN_CSS}
<h1>${t('요금제')}</h1><p class="mute">${t('부가세 포함 · 결제일로부터 7일 이내 환불 가능')} · <a href="/refund">${t('환불 정책')}</a></p>
${ready ? '' : `<div class="msg">${t('결제 연동 준비 중입니다. 곧 이용하실 수 있어요.')}</div>`}
${planCards(t, button)}`, { msg: req.query.m });
});

// ---------- 결제 시작 ----------
plans.post('/pricing/subscribe', requireUser, async (req, res) => {
  const p = PLANS[req.body.plan], pv = provider();
  const to = (m) => res.redirect('/pricing?m=' + encodeURIComponent(m));
  if (!p) return to(req.t('알 수 없는 요금제입니다.'));
  if (!pv) return to(req.t('결제 연동 준비 중입니다. 곧 이용하실 수 있어요.'));
  const id = Number((await db.prepare("INSERT INTO plan_orders(user_id,plan,amount,provider,created_at) VALUES(?,?,?,?,?)").run(req.user.id, req.body.plan, p.price, providerName(), now())).lastInsertRowid);
  try { res.redirect(303, await pv.checkout({ id, plan: req.body.plan, amount: p.price, name: `lett. ${p.name}` }, req.user)); }
  catch (e) { console.error('결제 시작 실패', e.message); await db.prepare("UPDATE plan_orders SET status='failed' WHERE id=?").run(id); to(req.t('결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')); }
});

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
