import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, now, baseUrl, isPaid, hasPaid, feePct } from './db.js';
import { sendMail } from './mail.js';
import { h } from './render.js';
import { page } from './views.js';

export const billing = Router();
export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;
const CURRENCY = (process.env.STRIPE_CURRENCY || 'krw').toLowerCase();
const won = (n) => (CURRENCY === 'krw' ? `₩${Number(n).toLocaleString('ko-KR')}` : `${n} ${CURRENCY.toUpperCase()}`);
export { won };

// Stripe의 중첩 파라미터(a[b][0][c]=v)로 평탄화
function flat(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else if (v !== undefined && v !== null && v !== '') out.append(key, String(v));
  }
  return out;
}
async function stripe(path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: flat(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Stripe 오류');
  return j;
}

const getNl = async (slug) => await db.prepare('SELECT * FROM newsletters WHERE slug=?').get(slug);
const activeSub = async (nl, token) =>
  token ? await db.prepare("SELECT * FROM subscribers WHERE token=? AND newsletter_id=? AND status='active'").get(String(token), nl.id) : null;
const gone = (res) => res.status(404).page('없음', '<h1>찾을 수 없습니다</h1><p><a href="/">홈으로</a></p>');

// ---------- 유료 구독 신청 ----------
billing.get('/n/:slug/upgrade', async (req, res) => {
  const t = req.t, loc = req.lang === 'zh' ? 'zh-CN' : req.lang;
  const nl = await getNl(req.params.slug);
  if (!nl) return gone(res);
  const back = `<p><a href="/n/${h(nl.slug)}">← ${h(nl.name)}</a></p>`;
  if (!hasPaid(nl)) return res.page(t('유료 구독'), `<h1>${h(nl.name)}</h1><p>${t('이 뉴스레터는 아직 유료 구독을 운영하지 않습니다.')}</p>${back}`);
  const sub = await activeSub(nl, req.query.t);
  if (!sub) {
    return res.page(t('유료 구독'), `<h1>${t('유료 구독')}</h1><p>${t('구독 중인 이메일 주소로 전용 링크를 보내드립니다.')}</p>
<form class="card" method="post" action="/n/${h(nl.slug)}/upgrade/link"><label>${t('이메일')}</label><input type="email" name="email" required>
<p><button class="primary">${t('링크 받기')}</button></p></form><p class="mute">${t('아직 구독 전이라면 먼저 {a}해 주세요.', { a: `<a href="/n/${h(nl.slug)}">${t('무료로 구독')}</a>` })}</p>${back}`, { msg: req.query.m });
  }
  if (isPaid(sub)) {
    return res.page(t('유료 구독'), `<h1>${t('유료 구독 중입니다')}</h1>
<p class="mute">${sub.paid_until ? t('이용 기간: {d}까지', { d: new Date(sub.paid_until).toLocaleDateString(loc) }) : t('발행자가 유료 혜택을 제공했습니다.')}</p>
${sub.stripe_customer && stripeConfigured() ? `<form method="post" action="/n/${h(nl.slug)}/billing"><input type="hidden" name="t" value="${h(sub.token)}"><button>${t('결제 관리 / 해지')}</button></form>` : ''}${back}`);
  }
  const plan = (p, price, label, note) => price > 0 ? `<form class="card" method="post" action="/n/${h(nl.slug)}/checkout"><input type="hidden" name="t" value="${h(sub.token)}">
<input type="hidden" name="plan" value="${p}"><b>${label}</b> <span style="font-size:22px">${won(price)}</span> <span class="mute">${note}</span>
<p><button class="primary" ${stripeConfigured() ? '' : 'disabled'}>${t('{label}로 구독', { label })}</button></p></form>` : '';
  res.page(t('유료 구독'), `<h1>${t('{name} 유료 구독', { name: h(nl.name) })}</h1><p>${t('유료 구독자 전용 글을 읽고, 발행자를 직접 응원할 수 있습니다.')}</p>
${stripeConfigured() ? '' : `<div class="msg">${t('결제 시스템이 아직 연결되지 않았습니다.')} (STRIPE_SECRET_KEY)</div>`}
${plan('monthly', nl.price_monthly, t('월간'), '/ ' + t('월'))}${plan('yearly', nl.price_yearly, t('연간'), '/ ' + t('년'))}${back}`, { msg: req.query.m });
});

// 이메일 열거 방지: 항상 같은 응답
billing.post('/n/:slug/upgrade/link', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return gone(res);
  const sub = await db.prepare("SELECT * FROM subscribers WHERE newsletter_id=? AND email=? AND status='active'").get(nl.id, String(req.body.email || '').trim().toLowerCase());
  if (sub) sendMail({ to: sub.email, subject: `[${nl.name}] 유료 구독 링크`, fromName: nl.name,
    html: `<p><a href="${baseUrl()}/n/${h(nl.slug)}/upgrade?t=${sub.token}">유료 구독 페이지 열기</a></p>`, text: `${baseUrl()}/n/${nl.slug}/upgrade?t=${sub.token}` }).catch(() => {});
  res.redirect(`/n/${nl.slug}/upgrade?m=` + encodeURIComponent('구독 중인 주소라면 링크를 메일로 보냈습니다.'));
});

billing.post('/n/:slug/checkout', async (req, res) => {
  const nl = await getNl(req.params.slug);
  if (!nl) return gone(res);
  const sub = await activeSub(nl, req.body.t);
  const plan = req.body.plan === 'yearly' ? 'yearly' : 'monthly';
  const price = plan === 'yearly' ? nl.price_yearly : nl.price_monthly;
  const fail = (m) => res.redirect(`/n/${nl.slug}/upgrade?t=${encodeURIComponent(req.body.t || '')}&m=` + encodeURIComponent(m));
  if (!sub || !price || !stripeConfigured()) return fail('결제를 시작할 수 없습니다.');
  try {
    const base = baseUrl();
    const s = await stripe('checkout/sessions', {
      mode: 'subscription',
      client_reference_id: sub.id,
      customer: sub.stripe_customer || undefined,
      customer_email: sub.stripe_customer ? undefined : sub.email,
      line_items: [{ quantity: 1, price_data: { currency: CURRENCY, unit_amount: price,
        recurring: { interval: plan === 'yearly' ? 'year' : 'month' },
        product_data: { name: `${nl.name} 유료 구독 (${plan === 'yearly' ? '연간' : '월간'})` } } }],
      metadata: { subscriber_id: sub.id, newsletter_id: nl.id, plan },
      subscription_data: {
        metadata: { subscriber_id: sub.id, newsletter_id: nl.id, plan },
        // 발행자가 Stripe Connect 계정을 연결했다면 수수료를 떼고 자동 정산
        application_fee_percent: nl.stripe_account ? feePct() : undefined,
        transfer_data: nl.stripe_account ? { destination: nl.stripe_account } : undefined,
      },
      success_url: `${base}/n/${nl.slug}/upgrade/done`,
      cancel_url: `${base}/n/${nl.slug}/upgrade?t=${sub.token}`,
    });
    res.redirect(303, s.url);
  } catch (e) {
    console.error('checkout 실패', e.message);
    fail('결제 페이지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

billing.post('/n/:slug/billing', async (req, res) => {
  const nl = await getNl(req.params.slug);
  const sub = nl && await activeSub(nl, req.body.t);
  if (!sub || !sub.stripe_customer || !stripeConfigured()) return gone(res);
  try {
    const s = await stripe('billing_portal/sessions', { customer: sub.stripe_customer, return_url: `${baseUrl()}/n/${nl.slug}/upgrade?t=${sub.token}` });
    res.redirect(303, s.url);
  } catch (e) { res.redirect(`/n/${nl.slug}/upgrade?t=${sub.token}&m=` + encodeURIComponent('결제 관리 페이지를 열지 못했습니다.')); }
});

billing.get('/n/:slug/upgrade/done', (req, res) =>
  res.page(req.t('결제 완료'), `<h1>${req.t('감사합니다')}</h1><p>${req.t('결제가 확인되면 곧 유료 구독이 활성화됩니다. (보통 몇 초 이내)')}</p>`));

// ---------- Stripe 웹훅 (app.js에서 raw body로 연결) ----------
export function verifySignature(raw, header, secret, tolerance = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > tolerance || !parts.v1) return false;
  const expect = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const a = Buffer.from(expect), b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

const plusDays = (iso, d) => new Date(new Date(iso).getTime() + d * 864e5).toISOString();

export async function handleEvent(ev) {
  const o = ev.data.object;
  if (ev.type === 'checkout.session.completed') {
    const sub = await db.prepare('SELECT * FROM subscribers WHERE id=?').get(o.client_reference_id || o.metadata?.subscriber_id);
    if (!sub) return;
    const plan = o.metadata?.plan === 'yearly' ? 'yearly' : 'monthly';
    // 정확한 기간은 invoice.paid에서 갱신. 우선 임시로 열어둔다.
    await db.prepare("UPDATE subscribers SET tier='paid', plan=?, stripe_customer=?, stripe_sub=?, paid_until=? WHERE id=?")
      .run(plan, o.customer || '', o.subscription || '', plusDays(now(), plan === 'yearly' ? 370 : 35), sub.id);
  } else if (ev.type === 'invoice.paid') {
    const subId = o.subscription || o.parent?.subscription_details?.subscription;
    const meta = o.subscription_details?.metadata || o.parent?.subscription_details?.metadata || {};
    const sub = (subId && await db.prepare('SELECT * FROM subscribers WHERE stripe_sub=?').get(subId)) ||
      (meta.subscriber_id && await db.prepare('SELECT * FROM subscribers WHERE id=?').get(meta.subscriber_id));
    if (!sub || !(o.amount_paid > 0)) return;
    const end = o.lines?.data?.[0]?.period?.end;
    const until = plusDays(end ? new Date(end * 1000).toISOString() : now(), 3); // 갱신 지연 대비 3일 유예
    await db.prepare("UPDATE subscribers SET tier='paid', paid_until=?, stripe_sub=COALESCE(NULLIF(?,''),stripe_sub), stripe_customer=COALESCE(NULLIF(?,''),stripe_customer) WHERE id=?")
      .run(until, subId || '', o.customer || '', sub.id);
    await db.prepare('INSERT OR IGNORE INTO payments(newsletter_id,subscriber_id,invoice_id,plan,amount,fee,currency,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(sub.newsletter_id, sub.id, o.id, meta.plan || sub.plan, o.amount_paid, Math.round((o.amount_paid * feePct()) / 100), o.currency || CURRENCY, now());
  } else if (ev.type === 'customer.subscription.deleted') {
    // 즉시 끊지 않고 이미 낸 기간(paid_until)까지는 유지
    await db.prepare("UPDATE subscribers SET stripe_sub='', plan='' WHERE stripe_sub=?").run(o.id);
  }
}

export async function stripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!secret || !verifySignature(raw, req.headers['stripe-signature'], secret)) return res.status(400).send('bad signature');
  try { await handleEvent(JSON.parse(raw)); } catch (e) { console.error('웹훅 처리 오류', e); return res.status(500).send('error'); }
  res.json({ received: true });
}
