// 운영자 화면(/admin): 요금제별 가입자·이용 현황, 구독료·수수료 매출, 크리에이터 매출, 결제 성공·실패 내역
// 접근 권한은 settlement.js 의 adminOnly (ADMIN_EMAILS 에 등록된 인증 계정)
import { Router } from 'express';
import { db, now } from './db.js';
import { h } from './render.js';
import { fmt } from './views.js';
import { PLAN_CONFIG, won } from './plan-data.js';
import { monthKey, monthRange } from './plan-limits.js';
import { adminOnly } from './settlement.js';
import { creatorPaymentsOn, payappConfigured } from './payapp.js';

export const admin = Router();

const PLAN_SQL = "CASE WHEN u.plan IN ('pro','business') AND COALESCE(u.plan_until,'')>? THEN u.plan ELSE 'free' END";
const STATE = { paid: '결제 성공', failed: '결제 실패', refunded: '환불', cancelled: '요청 취소', partial: '부분 취소', error: '처리 오류' };
const KIND = { plan: '요금제', content: '유료 콘텐츠', unknown: '확인 필요' };
const pastMonths = (key, n) => { const [y, m] = key.split('-').map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7)); };
const n0 = (n) => Number(n || 0).toLocaleString('ko-KR');

admin.get('/admin', adminOnly, async (req, res) => {
  const t = now(), cur = monthKey(), key = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month || '') && req.query.month <= cur ? req.query.month : cur;
  const [from, to] = monthRange(key);
  const usage = await db.prepare(`SELECT ${PLAN_SQL} AS plan, COUNT(*) users, COALESCE(SUM((SELECT COUNT(*) FROM subscribers s JOIN newsletters n ON n.id=s.newsletter_id WHERE n.owner_id=u.id AND s.status='active')),0) subs,
    COALESCE(SUM((SELECT COUNT(*) FROM send_log l JOIN posts p ON p.id=l.post_id JOIN newsletters n ON n.id=p.newsletter_id WHERE n.owner_id=u.id AND l.error IS NULL AND l.sent_at>=? AND l.sent_at<?)),0) sent
    FROM users u GROUP BY 1`).all(t, from, to);
  const planFee = await db.prepare("SELECT COALESCE(SUM(amount),0) g, COUNT(*) n FROM plan_orders WHERE status='paid' AND paid_at>=? AND paid_at<?").get(from, to);
  const sales = await db.prepare(`SELECT COALESCE(SUM(amount),0) g, COALESCE(SUM(fee),0) f, COUNT(*) n FROM (SELECT amount, fee FROM payments WHERE created_at>=? AND created_at<?
    UNION ALL SELECT amount, fee FROM course_sales WHERE created_at>=? AND created_at<?) x`).get(from, to, from, to);
  const fails = (await db.prepare("SELECT COUNT(*) n FROM payment_events WHERE state IN ('failed','error') AND created_at>=? AND created_at<?").get(from, to)).n;
  // 월별 추이 (최근 12개월, 한국 시간 달력 기준)
  const trend = [];
  for (const m of pastMonths(cur, 12)) {
    const [a, b] = monthRange(m);
    const p = await db.prepare("SELECT COALESCE(SUM(amount),0) g FROM plan_orders WHERE status='paid' AND paid_at>=? AND paid_at<?").get(a, b);
    const s = await db.prepare(`SELECT COALESCE(SUM(amount),0) g, COALESCE(SUM(fee),0) f FROM (SELECT amount, fee FROM payments WHERE created_at>=? AND created_at<?
      UNION ALL SELECT amount, fee FROM course_sales WHERE created_at>=? AND created_at<?) x`).get(a, b, a, b);
    trend.push({ m, plan: p.g, gross: s.g, fee: s.f });
  }
  // 크리에이터별 매출·수수료: 선택한 달과 누적
  const creators = await db.prepare(`SELECT u.id, u.email, u.name, ${PLAN_SQL} AS plan, x.g, x.f, x.mg, x.mf, x.c FROM users u JOIN (
    SELECT owner_id, SUM(amount) g, SUM(fee) f, SUM(CASE WHEN created_at>=? AND created_at<? THEN amount ELSE 0 END) mg, SUM(CASE WHEN created_at>=? AND created_at<? THEN fee ELSE 0 END) mf, COUNT(*) c FROM (
      SELECT n.owner_id, p.amount, p.fee, p.created_at FROM payments p JOIN newsletters n ON n.id=p.newsletter_id
      UNION ALL SELECT owner_id, amount, fee, created_at FROM course_sales) y GROUP BY owner_id) x ON x.owner_id=u.id
    ORDER BY x.mg DESC, x.g DESC LIMIT 100`).all(t, from, to, from, to);
  const only = ['failed', 'paid', 'refunded'].includes(req.query.state) ? req.query.state : '';
  const events = await db.prepare(`SELECT e.*, u.email FROM payment_events e LEFT JOIN users u ON u.id=e.user_id ${only === 'failed' ? "WHERE e.state IN ('failed','error')" : only ? 'WHERE e.state=?' : ''} ORDER BY e.id DESC LIMIT 100`)
    .all(...(only && only !== 'failed' ? [only] : []));
  const byPlan = (k) => usage.find((r) => r.plan === k) || { users: 0, subs: 0, sent: 0 };
  const monthOpts = pastMonths(cur, 12).map((m) => `<option value="${m}"${m === key ? ' selected' : ''}>${m}</option>`).join('');
  const link = (s, l) => `<a class="chip${only === s ? ' on' : ''}" href="?month=${key}${s ? `&state=${s}` : ''}">${l}</a>`;
  res.page('운영자', `<div class="row"><h1 class="grow">운영자</h1><form method="get" class="row"><select name="month" style="width:auto" onchange="this.form.submit()" aria-label="조회할 달">${monthOpts}</select></form><a class="btn sm" href="/admin/payouts">정산 처리</a></div>
<p class="mute">금액은 한국 시간 달력 기준이며 환불은 제외했습니다. 페이앱 ${payappConfigured() ? '연동 값 설정됨' : '<b>연동 값 없음</b>'} · 독자 결제·정산 ${creatorPaymentsOn() ? '켜짐' : '<b>꺼짐</b>'}</p>
<div class="stats"><div class="stat"><b>${won(planFee.g)}</b>월 구독료 매출 (${n0(planFee.n)}건)</div><div class="stat"><b>${won(sales.f)}</b>플랫폼 거래 수수료 매출</div>
<div class="stat"><b>${won(sales.g)}</b>전체 크리에이터 매출 (${n0(sales.n)}건)</div><div class="stat"><b>${n0(fails)}</b>결제 실패·오류</div></div>
<h2>요금제별 가입자 · 이용 현황</h2><div class="card"><table><tr><th>요금제</th><th>가입자</th><th>활성 구독자 합계</th><th>이번 기간 발송</th><th>가입자당 평균 발송</th></tr>
${Object.entries(PLAN_CONFIG).map(([k, p]) => { const r = byPlan(k); return `<tr><td><b>${p.name}</b> <span class="mute">${won(p.price)} · 수수료 ${p.feePct}%</span></td><td>${n0(r.users)}</td><td>${n0(r.subs)}</td><td>${n0(r.sent)}</td><td>${r.users ? n0(Math.round(r.sent / r.users)) : 0}</td></tr>`; }).join('')}</table></div>
<p class="mute">유예 기간(Business 권한)인 기존 계정은 실제 결제 기준으로 Free에 집계됩니다.</p>
<h2>월별 매출 · 최근 12개월</h2><div class="card" style="overflow-x:auto"><table><tr><th>월</th><th>월 구독료</th><th>거래 수수료</th><th>Lett 수익 합계</th><th>크리에이터 매출</th></tr>
${trend.map((r) => `<tr><td>${r.m}</td><td>${won(r.plan)}</td><td>${won(r.fee)}</td><td><b>${won(r.plan + r.fee)}</b></td><td>${won(r.gross)}</td></tr>`).join('')}</table></div>
<h2>크리에이터별 수수료 내역 · ${key}</h2><div class="card" style="overflow-x:auto"><table><tr><th>크리에이터</th><th>요금제</th><th>해당 월 매출</th><th>해당 월 수수료</th><th>누적 매출</th><th>누적 수수료</th></tr>
${creators.map((c) => `<tr><td>${h(c.name || '')}<br><span class="mute">${h(c.email)}</span></td><td>${PLAN_CONFIG[c.plan]?.name || c.plan}</td><td>${won(c.mg)}</td><td><b>${won(c.mf)}</b></td><td>${won(c.g)}</td><td>${won(c.f)}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">아직 매출이 없습니다.</td></tr>'}</table></div>
<p class="mute">수수료는 결제 당시의 요금제로 계산해 기록한 금액입니다. 실제 징수 여부는 정산 방식 확정 후 별도로 확인해야 합니다.</p>
<h2>결제 내역</h2><div class="chips">${link('', '전체')}${link('paid', '성공')}${link('failed', '실패')}${link('refunded', '환불')}</div>
<div class="card" style="overflow-x:auto"><table><tr><th>일시</th><th>구분</th><th>결과</th><th>계정</th><th>금액</th><th>참조 · 사유</th></tr>
${events.map((e) => `<tr><td class="mute">${fmt(e.created_at)}</td><td>${KIND[e.kind] || h(e.kind)}</td><td>${STATE[e.state] || h(e.state)}</td><td>${h(e.email || '—')}</td><td>${won(e.amount)}</td><td class="mute" style="word-break:break-all">${h(e.ref)}${e.message ? ` · ${h(e.message)}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">기록이 없습니다.</td></tr>'}</table></div>`,
  { wide: true, msg: req.query.m });
});
