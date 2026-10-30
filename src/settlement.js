// 통합 정산: 뉴스레터(유료 구독)와 크리에이트 강의·상품의 수익을 한곳에서 보고, 정산 계좌를 등록하고, 정산을 신청한다.
//  - 수익원: payments(뉴스레터 유료 구독) + course_sales(강의·상품 결제, 결제 연동 후 recordCourseSale 로 기록)
//  - Stripe Connect 로 자동 정산되는 뉴스레터는 통계에는 보이지만 정산 신청 가능 금액에는 넣지 않는다 (이미 지급됨)
//  - 정산 신청은 운영자가 /admin/payouts 에서 입금 후 "지급 완료"로 처리한다 (ADMIN_EMAILS 에 등록된 인증 계정)
import { Router } from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { db, now, feePct } from './db.js';
import { requireUser, cooldown } from './auth.js';
import { h } from './render.js';
import { won } from './plan-data.js';
import { fmt } from './views.js';

export const settle = Router();

const MIN_PAYOUT = () => Math.max(1000, Number(process.env.MIN_PAYOUT || 10000));
const BANKS = ['KB국민', '신한', '우리', '하나', 'NH농협', 'IBK기업', '카카오뱅크', '토스뱅크', '케이뱅크', 'SC제일', '부산', '대구', '광주', '전북', '경남', '제주', '새마을금고', '신협', '수협', '우체국', '산업', '씨티'];
const STATUS = { requested: '처리 대기', paid: '지급 완료', rejected: '반려' };
const isAdmin = (u) => !!u && !!u.verified && String(process.env.ADMIN_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean).includes(String(u.email).toLowerCase());

// 강의·상품 결제가 승인되면 호출한다 (PG 연동 콜백에서). ref 가 같으면 한 번만 기록된다
export async function recordCourseSale({ courseId, buyerId = null, plan = 'once', amount, ref = null }) {
  const c = await db.prepare('SELECT id,owner_id,title FROM courses WHERE id=?').get(courseId);
  if (!c || !(amount > 0)) return false;
  return !!(await db.prepare('INSERT OR IGNORE INTO course_sales(owner_id,course_id,title,buyer_id,plan,amount,fee,ref,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(c.owner_id, c.id, c.title, buyerId, plan, amount, Math.round((amount * feePct()) / 100), ref, now())).changes;
}

// ---------- 계좌번호 암호화 (AES-256-GCM, 키는 SECRET 에서 유도) ----------
const key = () => createHash('sha256').update('payout:' + (process.env.SECRET || 'dev-only-secret')).digest();
const seal = (plain) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv); const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.'); };
const unseal = (s) => { try { const [iv, tag, enc] = String(s).split('.').map((x) => Buffer.from(x, 'base64url')); const d = createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString('utf8'); } catch { return ''; } };

// ---------- 집계 ----------
async function summary(uid) {
  const nls = await db.prepare(`SELECT n.id, n.name, n.stripe_account, COUNT(p.id) c, COALESCE(SUM(p.amount),0) g, COALESCE(SUM(p.fee),0) f
    FROM newsletters n LEFT JOIN payments p ON p.newsletter_id=n.id WHERE n.owner_id=? GROUP BY n.id, n.name, n.stripe_account ORDER BY n.id`).all(uid);
  const crs = await db.prepare(`SELECT c.id, c.title, c.kind, COUNT(s.id) c, COALESCE(SUM(s.amount),0) g, COALESCE(SUM(s.fee),0) f
    FROM courses c LEFT JOIN course_sales s ON s.course_id=c.id WHERE c.owner_id=? GROUP BY c.id, c.title, c.kind ORDER BY c.id`).all(uid);
  const gone = await db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) g, COALESCE(SUM(fee),0) f FROM course_sales
    WHERE owner_id=? AND course_id NOT IN (SELECT id FROM courses WHERE owner_id=?)`).get(uid, uid);
  if (gone.c) crs.push({ id: 0, title: '삭제된 콘텐츠', kind: 'course', ...gone });

  // 최근 12개월 (이번 달 포함)
  const months = [];
  const d = new Date(); d.setUTCDate(1);
  for (let i = 11; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(x.toISOString().slice(0, 7)); }
  const since = months[0] + '-01';
  const mNl = await db.prepare(`SELECT substr(p.created_at,1,7) m, SUM(p.amount-p.fee) net FROM payments p JOIN newsletters n ON n.id=p.newsletter_id
    WHERE n.owner_id=? AND p.created_at>=? GROUP BY substr(p.created_at,1,7)`).all(uid, since);
  const mCr = await db.prepare(`SELECT substr(created_at,1,7) m, SUM(amount-fee) net FROM course_sales WHERE owner_id=? AND created_at>=? GROUP BY substr(created_at,1,7)`).all(uid, since);
  const series = months.map((m) => ({ m, nl: mNl.find((r) => r.m === m)?.net || 0, cr: mCr.find((r) => r.m === m)?.net || 0 }));

  const net = (r) => r.g - r.f;
  const manualNet = nls.filter((n) => !n.stripe_account).reduce((a, n) => a + net(n), 0) + crs.reduce((a, c) => a + net(c), 0);
  const totalNet = nls.reduce((a, n) => a + net(n), 0) + crs.reduce((a, c) => a + net(c), 0);
  const po = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('requested','paid') THEN amount ELSE 0 END),0) used,
    COALESCE(SUM(CASE WHEN status='requested' THEN amount ELSE 0 END),0) pending, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid FROM payouts WHERE user_id=?`).get(uid);
  return { nls, crs, series, totalNet, manualNet, balance: Math.max(0, manualNet - po.used), pending: po.pending, paid: po.paid };
}

// ---------- 차트 (SVG) ----------
const man = (n) => (n >= 1e8 ? +(n / 1e8).toFixed(1) + '억' : n >= 1e4 ? +(n / 1e4).toFixed(1).replace(/\.0$/, '') + '만' : String(n));
function niceMax(v) { if (v <= 0) return 10000; const p = 10 ** Math.floor(Math.log10(v)); for (const k of [2, 2.4, 3.2, 4, 6, 8, 12, 16, 20]) if (k * p >= v) return k * p; return 40 * p; } // 4등분 눈금이 떨어지는 값만
function chart(series) {
  const W = 760, H = 280, L = 52, R = 12, T = 14, B = 34, iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...series.map((s) => s.nl + s.cr)));
  const y = (v) => T + ih - (v / max) * ih, bw = iw / series.length;
  const grid = [0, 1, 2, 3, 4].map((i) => { const v = (max / 4) * i, yy = y(v); return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="gl"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" class="ax">${v ? '₩' + man(v) : '0'}</text>`; }).join('');
  const bars = series.map((s, i) => {
    const x = L + i * bw + bw * 0.2, w = bw * 0.6, hn = (s.nl / max) * ih, hc = (s.cr / max) * ih;
    const tip = `${s.m} · 뉴스레터 ${won(s.nl)} · 강의·상품 ${won(s.cr)} · 합계 ${won(s.nl + s.cr)}`;
    return `<g><title>${h(tip)}</title><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" fill="transparent"/>
${s.nl ? `<rect x="${x}" y="${y(s.nl)}" width="${w}" height="${hn}" class="b1" rx="3"/>` : ''}${s.cr ? `<rect x="${x}" y="${y(s.nl + s.cr)}" width="${w}" height="${hc}" class="b2" rx="3"/>` : ''}
<text x="${x + w / 2}" y="${H - 12}" text-anchor="middle" class="ax">${+s.m.slice(5)}월</text></g>`;
  }).join('');
  const empty = series.every((s) => !s.nl && !s.cr) ? `<text x="${W / 2}" y="${T + ih / 2}" text-anchor="middle" class="ax" style="font-size:14px">아직 정산 대상 매출이 없어요</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 12개월 순수익" class="sch">${grid}${bars}${empty}</svg>`;
}
const shareRows = (rows, max, label) => rows.map((r) => {
  const n = r.g - r.f;
  return `<tr><td>${label(r)}</td><td class="num">${r.c}</td><td class="num">${won(r.g)}</td><td class="num mute">${won(r.f)}</td><td class="num"><b>${won(n)}</b></td>
<td class="barcell"><div class="sb"><i style="width:${max ? Math.round((n / max) * 100) : 0}%"></i></div></td></tr>`;
}).join('');

const CSS = `<style>
.sg{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:18px 0}
.sc{border:1px solid var(--line);border-radius:16px;padding:18px 20px;background:var(--card)}.sc span{font-size:13px;color:var(--mute)}.sc b{display:block;font-size:26px;letter-spacing:-.03em;margin-top:2px}
.sc.hot{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}.sc.hot span{color:rgba(255,255,255,.7)}
.sch{width:100%;height:auto;display:block}.sch .gl{stroke:var(--line);stroke-width:1}.sch .ax{fill:var(--mute);font-size:11.5px}.sch .b1{fill:#3B82F6}.sch .b2{fill:#0F172A}.sch g:hover rect[fill=transparent]{fill:rgba(59,130,246,.07)}
.lg{display:flex;gap:16px;font-size:13px;color:var(--mute);margin:0 0 6px}.lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}
.num{text-align:right;white-space:nowrap}th.num{text-align:right}.barcell{width:22%}.sb{height:8px;background:var(--soft);border-radius:4px;overflow:hidden}.sb i{display:block;height:100%;background:#3B82F6}
.card .row>*{min-width:0}.tbl{overflow-x:auto}.tag{font-size:12px;color:var(--mute);border:1px solid var(--line);border-radius:999px;padding:1px 8px;white-space:nowrap}
</style>`;

// ---------- 화면 ----------
settle.use(['/settlement', '/admin'], requireUser);

settle.get('/settlement', async (req, res) => {
  const u = req.user, S = await summary(u.id);
  const acct = await db.prepare('SELECT * FROM payout_accounts WHERE user_id=?').get(u.id);
  const payouts = await db.prepare('SELECT * FROM payouts WHERE user_id=? ORDER BY id DESC LIMIT 30').all(u.id);
  const min = MIN_PAYOUT(), can = !!acct && u.verified && S.balance >= min;
  const maxNl = Math.max(0, ...S.nls.map((n) => n.g - n.f)), maxCr = Math.max(0, ...S.crs.map((c) => c.g - c.f));
  const sumNl = S.series.reduce((a, s) => a + s.nl, 0), sumCr = S.series.reduce((a, s) => a + s.cr, 0);
  res.page('정산', `${CSS}
<div class="row"><h1 class="grow">정산</h1>${isAdmin(u) ? '<a class="btn sm" href="/admin/payouts">운영자: 정산 처리</a>' : ''}</div>
<p class="mute">뉴스레터 유료 구독과 강의·상품 판매 수익을 한곳에서 확인하고 정산받으세요. 금액은 플랫폼 수수료(${feePct()}%)를 제외한 순수익이에요.</p>
<div class="sg"><div class="sc hot"><span>정산 가능 금액</span><b>${won(S.balance)}</b></div><div class="sc"><span>정산 처리 중</span><b>${won(S.pending)}</b></div>
<div class="sc"><span>지급 완료 누계</span><b>${won(S.paid)}</b></div><div class="sc"><span>누적 순수익 (전체)</span><b>${won(S.totalNet)}</b></div></div>

<h2>월별 순수익 · 최근 12개월</h2>
<div class="card"><div class="lg"><span><i style="background:#3B82F6"></i>뉴스레터 ${won(sumNl)}</span><span><i style="background:#0F172A"></i>강의·상품 ${won(sumCr)}</span></div>${chart(S.series)}</div>

<div>
<h2>뉴스레터별</h2><div class="card tbl"><table><tr><th>뉴스레터</th><th class="num">결제</th><th class="num">매출</th><th class="num">수수료</th><th class="num">순수익</th><th></th></tr>
${shareRows(S.nls, maxNl, (n) => `<a href="/app/n/${n.id}/revenue">${h(n.name)}</a>${n.stripe_account ? ' <span class="tag">자동 정산</span>' : ''}`) || ''}
${S.nls.length ? '' : '<tr><td colspan="6" class="mute">뉴스레터가 없습니다.</td></tr>'}</table></div></div>
<div>
<h2>강의·상품별</h2><div class="card tbl"><table><tr><th>콘텐츠</th><th class="num">결제</th><th class="num">매출</th><th class="num">수수료</th><th class="num">순수익</th><th></th></tr>
${shareRows(S.crs, maxCr, (c) => (c.id ? `<a href="/create/${c.id}">${h(c.title || '제목 없음')}</a>` : h(c.title))) || ''}
${S.crs.length ? '' : '<tr><td colspan="6" class="mute">아직 만든 강의·상품이 없습니다.</td></tr>'}</table></div></div>
<p class="mute" style="margin-top:8px">"자동 정산" 표시가 있는 뉴스레터는 Stripe 연결 계정으로 이미 지급되어 정산 가능 금액에 포함되지 않아요. 강의·상품 판매는 결제 연동 후부터 집계됩니다.</p>

<h2>정산 계좌</h2>
<form class="card" method="post" action="/settlement/account">
${acct ? `<p style="margin:0 0 8px">현재 등록: <b>${h(acct.bank)} ····${h(acct.last4)}</b> · 예금주 ${h(acct.holder)} <span class="mute">(${fmt(acct.updated_at)})</span></p>` : '<p class="mute" style="margin-top:0">정산받을 본인 명의 계좌를 등록해 주세요.</p>'}
<div class="row"><div><label>은행</label><select name="bank" required>${BANKS.map((b) => `<option${acct?.bank === b ? ' selected' : ''}>${b}</option>`).join('')}</select></div>
<div class="grow"><label>예금주</label><input name="holder" required maxlength="20" autocomplete="off" value="${h(acct?.holder || '')}"></div>
<div class="grow"><label>계좌번호 ('-' 없이 숫자만)</label><input name="account" required inputmode="numeric" maxlength="24" autocomplete="off" placeholder="${acct ? '변경할 때만 입력' : ''}"></div></div>
<p class="mute" style="margin:10px 0 0">계좌번호는 암호화되어 저장되고, 화면에는 끝 4자리만 표시돼요.</p>
<p><button class="primary">${acct ? '계좌 변경' : '계좌 등록'}</button></p></form>

<h2>정산 신청</h2>
<form class="card" method="post" action="/settlement/request">
<p style="margin:0 0 10px">신청 가능 금액 <b>${won(S.balance)}</b> <span class="mute">· 최소 ${won(min)}부터</span></p>
<div class="row"><input class="grow" name="amount" inputmode="numeric" value="${can ? S.balance : ''}" placeholder="신청할 금액" ${can ? '' : 'disabled'} style="max-width:260px"><button class="primary" ${can ? '' : 'disabled'}>정산 신청</button></div>
<p class="mute" style="margin:10px 0 0">${!u.verified ? '이메일 인증 후 신청할 수 있어요.' : !acct ? '먼저 정산 계좌를 등록해 주세요.' : S.balance < min ? `정산 가능 금액이 ${won(min)} 이상일 때 신청할 수 있어요.` : '신청하면 운영자가 확인한 뒤 등록된 계좌로 입금해 드려요.'}</p></form>

<h2>정산 내역</h2><div class="card tbl"><table><tr><th>신청일</th><th>계좌</th><th class="num">금액</th><th>상태</th><th>메모</th></tr>
${payouts.map((p) => `<tr><td class="mute">${fmt(p.created_at)}</td><td>${h(p.bank)} ····${h(p.last4)}</td><td class="num"><b>${won(p.amount)}</b></td><td>${STATUS[p.status] || p.status}${p.processed_at ? ` <span class="mute">· ${fmt(p.processed_at)}</span>` : ''}</td><td class="mute">${h(p.note)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="mute">정산 내역이 없습니다.</td></tr>'}</table></div>`, { wide: true, active: 'settlement', msg: req.query.m });
});

const back = (res, m) => res.redirect('/settlement?m=' + encodeURIComponent(m));

settle.post('/settlement/account', async (req, res) => {
  const bank = String(req.body.bank || ''), holder = String(req.body.holder || '').trim(), num = String(req.body.account || '').replace(/[\s-]/g, '');
  const old = await db.prepare('SELECT * FROM payout_accounts WHERE user_id=?').get(req.user.id);
  if (!BANKS.includes(bank)) return back(res, '은행을 선택해 주세요.');
  if (holder.length < 2 || holder.length > 20) return back(res, '예금주를 입력해 주세요.');
  if (!num && old) { // 번호는 그대로 두고 은행·예금주만 수정
    await db.prepare('UPDATE payout_accounts SET bank=?, holder=?, updated_at=? WHERE user_id=?').run(bank, holder, now(), req.user.id);
    return back(res, '계좌 정보를 저장했습니다.');
  }
  if (!/^\d{8,20}$/.test(num)) return back(res, '계좌번호는 숫자 8~20자리로 입력해 주세요.');
  const row = [bank, holder, seal(num), num.slice(-4), now()];
  if (old) await db.prepare('UPDATE payout_accounts SET bank=?, holder=?, account_enc=?, last4=?, updated_at=? WHERE user_id=?').run(...row, req.user.id);
  else await db.prepare('INSERT INTO payout_accounts(bank,holder,account_enc,last4,updated_at,user_id) VALUES(?,?,?,?,?,?)').run(...row, req.user.id);
  back(res, '정산 계좌를 저장했습니다.');
});

settle.post('/settlement/request', async (req, res) => {
  const u = req.user;
  if (!u.verified) return back(res, '이메일 인증 후 신청할 수 있어요.');
  const acct = await db.prepare('SELECT * FROM payout_accounts WHERE user_id=?').get(u.id);
  if (!acct) return back(res, '먼저 정산 계좌를 등록해 주세요.');
  const amount = Math.floor(Number(String(req.body.amount || '').replace(/\D/g, '')));
  const S = await summary(u.id);
  if (!(amount >= MIN_PAYOUT())) return back(res, `최소 ${won(MIN_PAYOUT())}부터 신청할 수 있어요.`);
  if (amount > S.balance) return back(res, '신청 가능 금액을 넘었어요.');
  // 연타·중복 제출 방지 (검증을 통과한 요청에만 적용)
  if (!(await cooldown('payout:' + u.id, 5000))) return back(res, '잠시 후 다시 시도해 주세요.');
  await db.prepare('INSERT INTO payouts(user_id,amount,bank,holder,account_enc,last4,created_at) VALUES(?,?,?,?,?,?,?)').run(u.id, amount, acct.bank, acct.holder, acct.account_enc, acct.last4, now());
  back(res, `${won(amount)} 정산을 신청했어요. 운영자가 확인 후 입금해 드립니다.`);
});

// ---------- 운영자: 정산 처리 ----------
const adminOnly = (req, res, next) => (isAdmin(req.user) ? next() : res.status(404).page('없음', '<p>페이지를 찾을 수 없습니다.</p>'));
settle.get('/admin/payouts', adminOnly, async (req, res) => {
  const rows = await db.prepare(`SELECT p.*, u.email, u.name FROM payouts p JOIN users u ON u.id=p.user_id
    ORDER BY CASE WHEN p.status='requested' THEN 0 ELSE 1 END, p.id DESC LIMIT 100`).all();
  res.page('정산 처리', `${CSS}<h1>정산 처리</h1><p class="mute">입금을 마친 뒤 "지급 완료"를 누르세요. 계좌번호는 이 화면에서만 복호화되어 보여요.</p>
<div class="card tbl"><table><tr><th>신청일</th><th>신청자</th><th>입금 계좌</th><th class="num">금액</th><th>상태</th><th>처리</th></tr>
${rows.map((p) => `<tr><td class="mute">${fmt(p.created_at)}</td><td>${h(p.name || '')}<br><span class="mute">${h(p.email)}</span></td>
<td>${h(p.bank)} <code>${p.status === 'requested' ? h(unseal(p.account_enc)) : '····' + h(p.last4)}</code><br><span class="mute">${h(p.holder)}</span></td><td class="num"><b>${won(p.amount)}</b></td><td>${STATUS[p.status] || p.status}</td>
<td>${p.status === 'requested' ? `<form method="post" action="/admin/payouts/${p.id}" class="row nowrap" style="gap:6px"><input name="note" placeholder="메모(선택)" style="width:130px" maxlength="100">
<button class="sm primary" name="to" value="paid">지급 완료</button><button class="sm danger" name="to" value="rejected" onclick="return confirm('반려할까요? 금액은 정산 가능 금액으로 돌아갑니다.')">반려</button></form>` : `<span class="mute">${h(p.note)}</span>`}</td></tr>`).join('')
    || '<tr><td colspan="6" class="mute">정산 신청이 없습니다.</td></tr>'}</table></div>`, { wide: true, msg: req.query.m });
});
settle.post('/admin/payouts/:id', adminOnly, async (req, res) => {
  const to = req.body.to === 'paid' ? 'paid' : req.body.to === 'rejected' ? 'rejected' : '';
  if (to) await db.prepare("UPDATE payouts SET status=?, note=?, processed_at=? WHERE id=? AND status='requested'").run(to, String(req.body.note || '').slice(0, 100), now(), req.params.id);
  res.redirect('/admin/payouts?m=' + encodeURIComponent('처리했습니다.'));
});
