// 발행자 영역 2단계: 수익 관리 · 자동화 · 성장
import { findNewsletter } from './access.js';
import { Router } from 'express';
import { db, now, baseUrl, isPaid, hasPaid, feePct } from './db.js';
import { requireUser } from './auth.js';
import { h } from './render.js';
import { page, fmt, pct } from './views.js';
import { stripeConfigured, won } from './billing.js';

export const pro = Router();
pro.use('/app', requireUser);

const back = (res, path, m) => res.redirect(m ? path + (path.includes('?') ? '&' : '?') + 'm=' + encodeURIComponent(m) : path);
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
const int = (v, max = 100_000_000) => Math.max(0, Math.min(max, parseInt(v, 10) || 0));

pro.param('nid', async (req, res, next, id) => {
  req.nl = await findNewsletter(id, req.user);
  if (!req.nl) return res.status(404).page('없음', '<p>뉴스레터를 찾을 수 없습니다. <a href="/app">내 뉴스레터</a></p>');
  next();
});

// ================= 수익 관리 =================
pro.get('/app/n/:nid/revenue', async (req, res) => {
  const nl = req.nl;
  const paidSubs = (await db.prepare("SELECT * FROM subscribers WHERE newsletter_id=? AND status='active' AND tier='paid'").all(nl.id)).filter(isPaid);
  const mrr = paidSubs.reduce((a, s) => a + (s.plan === 'yearly' ? nl.price_yearly / 12 : s.plan === 'monthly' ? nl.price_monthly : 0), 0);
  const tot = await db.prepare('SELECT COALESCE(SUM(amount),0) g, COALESCE(SUM(fee),0) f, COUNT(*) n FROM payments WHERE newsletter_id=?').get(nl.id);
  const months = await db.prepare(`SELECT substr(created_at,1,7) m, COUNT(*) n, SUM(amount) g, SUM(fee) f FROM payments
    WHERE newsletter_id=? GROUP BY m ORDER BY m DESC`).all(nl.id);
  const pays = await db.prepare(`SELECT p.*, s.email FROM payments p LEFT JOIN subscribers s ON s.id=p.subscriber_id
    WHERE p.newsletter_id=? ORDER BY p.id DESC LIMIT 50`).all(nl.id);
  const method = nl.stripe_account ? '자동 (Stripe Connect)' : '수동 정산 대기';
  res.page('수익', `<h1>수익 관리</h1>
${stripeConfigured() && process.env.STRIPE_WEBHOOK_SECRET ? '' : '<div class="msg">Stripe가 연결되지 않았습니다. <code>.env</code>에 STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET을 설정해야 결제가 동작합니다. 웹훅 주소: <code>' + h(baseUrl()) + '/stripe/webhook</code></div>'}
<div class="stats"><div class="stat"><b>${paidSubs.length}</b>유료 구독자</div><div class="stat"><b>${won(Math.round(mrr))}</b>월 반복 수익(추정)</div>
<div class="stat"><b>${won(tot.g)}</b>누적 매출</div><div class="stat"><b>${won(tot.f)}</b>플랫폼 수수료 (${feePct()}%)</div>
<div class="stat"><b>${won(tot.g - tot.f)}</b>순수익(정산 대상)</div></div>
<h2>요금 설정</h2><form class="card" method="post" action="/app/n/${nl.id}/revenue/pricing">
<div class="row"><div><label>월간 가격 (원, 0이면 미운영)</label><input type="number" name="price_monthly" min="0" max="10000000" value="${nl.price_monthly}"></div>
<div><label>연간 가격 (원, 0이면 미운영)</label><input type="number" name="price_yearly" min="0" max="100000000" value="${nl.price_yearly}"></div></div>
<label>Stripe 연결 계정 ID (선택, acct_...)</label><input name="stripe_account" value="${h(nl.stripe_account)}" placeholder="acct_1234...">
<p class="mute">연결 계정이 있으면 결제 시 수수료(${feePct()}%)를 제하고 발행자 계정으로 자동 정산됩니다. 없으면 플랫폼 계정으로 입금되며 아래 내역을 기준으로 수동 정산합니다. Stripe 자체 결제 수수료는 별도입니다.</p>
<p><button class="primary">저장</button></p></form>
<p class="mute">유료 전용 글: 글 작성 화면에서 대상을 "유료만"으로 하거나, 본문에 <code>[[paywall]]</code> 한 줄을 넣으면 그 아래는 유료 구독자만 읽을 수 있습니다.
구독 페이지 링크: <a href="/n/${h(nl.slug)}/upgrade" target="_blank">/n/${h(nl.slug)}/upgrade</a></p>
<h2>월별 정산 내역</h2><div class="card"><table><tr><th>월</th><th>결제 건수</th><th>매출</th><th>수수료</th><th>정산액</th><th>방식</th></tr>
${months.map((m) => `<tr><td>${m.m}</td><td>${m.n}</td><td>${won(m.g)}</td><td>${won(m.f)}</td><td><b>${won(m.g - m.f)}</b></td><td>${method}</td></tr>`).join('') || '<tr><td colspan="6" class="mute">아직 결제 내역이 없습니다.</td></tr>'}</table></div>
<h2>최근 결제</h2><div class="card"><table><tr><th>일시</th><th>구독자</th><th>플랜</th><th>금액</th><th>수수료</th></tr>
${pays.map((p) => `<tr><td class="mute">${fmt(p.created_at)}</td><td>${h(p.email || '(삭제됨)')}</td><td>${p.plan === 'yearly' ? '연간' : '월간'}</td><td>${won(p.amount)}</td><td>${won(p.fee)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="mute">없음</td></tr>'}</table></div>`, { nl, active: 'revenue', wide: true, msg: req.query.m });
});
pro.post('/app/n/:nid/revenue/pricing', async (req, res) => {
  const acct = String(req.body.stripe_account || '').trim();
  if (acct && !/^acct_[A-Za-z0-9]+$/.test(acct)) return back(res, `/app/n/${req.nl.id}/revenue`, 'Stripe 계정 ID 형식이 올바르지 않습니다.');
  await db.prepare('UPDATE newsletters SET price_monthly=?, price_yearly=?, stripe_account=? WHERE id=?')
    .run(int(req.body.price_monthly, 10_000_000), int(req.body.price_yearly, 100_000_000), acct, req.nl.id);
  back(res, `/app/n/${req.nl.id}/revenue`, '저장했습니다.');
});

// ================= 자동화 =================
const COND = { '': '모든 구독자', free: '무료 구독자만', paid: '유료 구독자만' };

pro.get('/app/n/:nid/automation', async (req, res) => {
  const nl = req.nl;
  const list = await db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM posts p WHERE p.series_id=s.id AND p.kind='step') steps,
    (SELECT COUNT(*) FROM series_enroll e WHERE e.series_id=s.id AND e.done=0) running,
    (SELECT COUNT(*) FROM series_enroll e WHERE e.series_id=s.id AND e.done=1) finished FROM series s WHERE s.newsletter_id=? ORDER BY s.id`).all(nl.id);
  res.page('자동화', `<h1>자동화</h1><p class="mute">구독이 확정되면 자동으로 발송되는 메일 흐름입니다. 메일을 단계로 쌓고, 끌어서 순서를 바꾸고, 단계마다 발송 시점(며칠 뒤)과 대상을 정할 수 있어요. 환영 메일은 "즉시(0일)" 단계 하나짜리 흐름입니다.</p>
<div class="card"><table><tr><th>이름</th><th>상태</th><th>단계</th><th>진행 중</th><th>완료</th></tr>${list.map((s) =>
  `<tr><td><a href="/app/n/${nl.id}/automation/${s.id}">${h(s.name)}</a></td><td><span class="badge ${s.active ? 'active' : ''}">${s.active ? '켜짐' : '꺼짐'}</span></td><td>${s.steps}</td><td>${s.running}</td><td>${s.finished}</td></tr>`).join('')
    || '<tr><td colspan="5" class="mute">아직 자동화가 없습니다.</td></tr>'}</table></div>
<form class="row" method="post" action="/app/n/${nl.id}/automation/create"><input name="name" placeholder="자동화 이름 (예: 환영 메일, 입문 5일 코스)" maxlength="60" style="width:300px"><button class="primary">+ 자동화 메일 만들기</button></form>`,
  { nl, active: 'automation', wide: true, msg: req.query.m });
});
// 새 자동화: 구독 즉시 발송되는 첫 단계가 들어 있는 흐름을 만든다. 이후 단계를 추가하고 순서를 바꾼다
pro.post('/app/n/:nid/automation/create', async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60) || '자동화 메일';
  const sid = Number((await db.prepare('INSERT INTO series(newsletter_id,name,created_at) VALUES(?,?,?)').run(req.nl.id, name, now())).lastInsertRowid);
  await db.prepare("INSERT INTO posts(newsletter_id,kind,status,series_id,step_pos,delay_days,subject,body_md,created_at) VALUES(?,'step','auto',?,1,0,?,?,?)")
    .run(req.nl.id, sid, '', '', now());
  back(res, `/app/n/${req.nl.id}/automation/${sid}`, '자동화를 만들었습니다. 첫 메일의 제목과 본문을 채워 주세요.');
});

const getSeries = async (req) => await db.prepare('SELECT * FROM series WHERE id=? AND newsletter_id=?').get(req.params.sid, req.nl.id);

pro.get('/app/n/:nid/automation/:sid', async (req, res) => {
  const nl = req.nl, s = await getSeries(req);
  if (!s) return res.redirect(`/app/n/${nl.id}/automation`);
  const steps = await db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' ORDER BY step_pos, id").all(s.id);
  res.page(s.name, `<div class="row"><h1 class="grow">${h(s.name)}</h1>
<form method="post" action="/app/n/${nl.id}/automation/${s.id}" class="row"><input name="name" value="${h(s.name)}" style="width:200px">
<label style="margin:0"><input type="checkbox" name="active" value="1" style="width:auto" ${s.active ? 'checked' : ''}> 켜기</label><button class="sm">저장</button></form></div>
<p class="mute">구독이 확정되는 시점에 자동 등록됩니다. 아래 흐름도에서 메일을 <b>클릭하면 오른쪽에서 수정</b>하고, <b>끌어서(또는 ↑↓) 순서를 바꿉니다</b>.
각 단계의 "일수"는 <b>직전 메일 발송 후</b> 며칠 뒤에 보낼지입니다 (첫 메일은 구독 후). 조건에 맞지 않는 구독자는 그 단계를 건너뛰고, 켜기 이후에 구독한 사람부터 적용됩니다.</p>
<style>
.fm{display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:28px;align-items:start;margin-top:18px}
.fmap{display:flex;flex-direction:column;align-items:stretch}
.fn{border:1px solid var(--line);background:var(--card);border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.fn:hover{border-color:var(--blue)}.fn.sel{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}
.fn.over{border-style:dashed;border-color:var(--blue)}.fn.drag{opacity:.4}
.fn .no{flex:0 0 26px;height:26px;border-radius:50%;background:var(--blue-soft);color:var(--blue);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}
.fn .tx{flex:1;min-width:0}.fn .tx b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fn .tx small{color:var(--mute);font-size:12px}.fn .tx small.warn{color:var(--bad)}
.fn .hd{cursor:grab;color:var(--mute);user-select:none;padding:0 2px;font-size:16px;line-height:1}
.fn .mv{display:flex;flex-direction:column;gap:2px}.fn .mv button{padding:0 7px;font-size:11px;line-height:16px;border-radius:6px}
.fs{border:1px dashed var(--line);border-radius:999px;padding:6px 14px;text-align:center;color:var(--mute);font-size:13px;background:var(--soft)}
.fc{align-self:center;display:flex;flex-direction:column;align-items:center;color:var(--mute);font-size:12px}
.fc i{display:block;width:2px;height:12px;background:var(--line)}.fc span{padding:2px 10px;border:1px solid var(--line);border-radius:999px;background:var(--card);margin:0}
.fadd{margin-top:10px;align-self:center}
.fpanel{position:sticky;top:70px}
@media(max-width:860px){.fm{grid-template-columns:1fr}.fpanel{position:static}}
</style>
<div class="fm"><div class="fmap" id="fmap"><div class="fs">구독 확정</div>
${steps.map((p, i) => `<div class="fc"><i></i><span>${i ? `직전 메일 발송 후 ${p.delay_days}일` : p.delay_days ? `구독 후 ${p.delay_days}일` : '구독 즉시'}</span><i></i></div>
<div class="fn" draggable="false" data-id="${p.id}"><span class="hd" title="끌어서 순서 변경">⋮⋮</span><span class="no">${i + 1}</span>
<span class="tx"><b>${h(p.subject || '(제목 없음)')}</b><small${p.subject && p.body_md ? '' : ' class="warn"'}>${p.subject && p.body_md ? COND[p.cond] || COND[''] : '제목·본문이 비어 있으면 발송되지 않아요'}</small></span>
<span class="mv"><button type="button" class="up" aria-label="위로">▲</button><button type="button" class="dn" aria-label="아래로">▼</button></span></div>`).join('')}
<form class="fadd" method="post" action="/app/n/${nl.id}/automation/${s.id}/steps"><button>+ 메일 추가</button></form></div>
<div class="fpanel"><form class="card" id="fform" method="post" style="margin:0" hidden>
<div class="row"><b id="ftitle"></b><span class="grow"></span><a id="fstat" href="#">통계</a></div>
<div class="row" style="margin-top:10px"><span class="mute">일수</span><input type="number" name="delay_days" id="fdelay" min="0" max="365" style="width:80px">
<select name="cond" id="fcond" style="width:auto">${Object.entries(COND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
<label>제목</label><input name="subject" id="fsub" required>
<label>본문 (마크다운, {{name}} 사용 가능)</label><textarea name="body_md" id="fbody" rows="12"></textarea>
<div class="row" style="margin-top:10px"><button class="primary sm">저장</button><button type="submit" class="sm danger" id="fdel" onclick="return confirm('이 메일을 삭제할까요?')">메일 삭제</button></div></form>
<p class="mute" id="fhint">왼쪽 흐름도에서 메일을 선택하세요.</p></div></div>
<script>(function(){var D=${jsonForScript(steps.map((p) => ({ id: p.id, subject: p.subject, body_md: p.body_md, delay_days: p.delay_days, cond: p.cond })))},B='/app/n/${nl.id}/automation/${s.id}',
map=document.getElementById('fmap'),f=document.getElementById('fform'),hint=document.getElementById('fhint');
function $(i){return document.getElementById(i)}
function nodes(){return [].slice.call(map.querySelectorAll('.fn'))}
function sel(id){var d=D.filter(function(x){return x.id==id})[0];nodes().forEach(function(n){n.classList.toggle('sel',n.dataset.id==id)});if(!d){f.hidden=true;hint.hidden=false;return}
f.hidden=false;hint.hidden=true;f.action=B+'/steps/'+d.id;$('ftitle').textContent='메일 '+(nodes().findIndex(function(n){return n.dataset.id==id})+1);$('fstat').href='/app/n/${nl.id}/posts/'+d.id+'/stats';
$('fdelay').value=d.delay_days;$('fcond').value=d.cond||'';$('fsub').value=d.subject;$('fbody').value=d.body_md;$('fdel').formAction=B+'/steps/'+d.id+'/delete'}
function save(){var ids=nodes().map(function(n){return n.dataset.id}).join(',');var cur=(map.querySelector('.fn.sel')||{dataset:{}}).dataset.id;
fetch(B+'/reorder',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'order='+ids}).then(function(){location.href=B+(cur?'?step='+cur:'')}).catch(function(){location.reload()})}
function put(n,ref){[n.previousElementSibling,n].forEach(function(el){map.insertBefore(el,ref)})}
map.addEventListener('click',function(e){var n=e.target.closest('.fn');if(!n)return;var b=e.target.closest('button');
if(b){var ns=nodes(),i=ns.indexOf(n);if(b.classList.contains('up')){if(i<1)return;put(n,ns[i-1].previousElementSibling)}else{if(i>ns.length-2)return;put(ns[i+1],n.previousElementSibling)}save();return}
if(!e.target.closest('.hd'))sel(n.dataset.id)});
var drag=null;
nodes().forEach(function(n){var hd=n.querySelector('.hd');hd.addEventListener('mousedown',function(){n.draggable=true});hd.addEventListener('touchstart',function(){n.draggable=true},{passive:true});
n.addEventListener('dragstart',function(e){drag=n;n.classList.add('drag');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',n.dataset.id)});
n.addEventListener('dragend',function(){n.draggable=false;n.classList.remove('drag');nodes().forEach(function(x){x.classList.remove('over')});drag=null});
n.addEventListener('dragover',function(e){if(drag&&drag!==n){e.preventDefault();n.classList.add('over')}});n.addEventListener('dragleave',function(){n.classList.remove('over')});
n.addEventListener('drop',function(e){e.preventDefault();if(!drag||drag===n)return;var ns=nodes();if(ns.indexOf(drag)<ns.indexOf(n))put(drag,n.nextElementSibling);else put(drag,n.previousElementSibling);save()})});
var q=new URLSearchParams(location.search).get('step');sel(D.some(function(x){return x.id==q})?q:D[0]&&D[0].id)})();</script>
<p><a href="/app/n/${nl.id}/automation">← 자동화 목록</a></p>`, { nl, active: 'automation', wide: true, msg: req.query.m });
});
pro.post('/app/n/:nid/automation/:sid', async (req, res) => {
  const s = await getSeries(req);
  if (s) await db.prepare('UPDATE series SET name=?, active=? WHERE id=?').run(String(req.body.name || s.name).trim().slice(0, 60), req.body.active ? 1 : 0, s.id);
  back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}`, '저장했습니다.');
});
pro.post('/app/n/:nid/automation/:sid/steps', async (req, res) => {
  const s = await getSeries(req);
  if (!s) return res.redirect(`/app/n/${req.nl.id}/automation`);
  const pos = ((await db.prepare("SELECT MAX(step_pos) m FROM posts WHERE series_id=? AND kind='step'").get(s.id)).m || 0) + 1;
  const id = Number((await db.prepare("INSERT INTO posts(newsletter_id,kind,status,series_id,step_pos,delay_days,subject,body_md,created_at) VALUES(?,'step','auto',?,?,?,?,?,?)")
    .run(req.nl.id, s.id, pos, pos === 1 ? 0 : 3, '', '', now())).lastInsertRowid);
  back(res, `/app/n/${req.nl.id}/automation/${s.id}?step=${id}`, '메일을 추가했습니다. 제목과 본문을 채워주세요.');
});
pro.post('/app/n/:nid/automation/:sid/steps/:pid', async (req, res) => {
  const s = await getSeries(req), b = req.body;
  if (s) await db.prepare("UPDATE posts SET subject=?, body_md=?, delay_days=?, cond=? WHERE id=? AND series_id=? AND kind='step'")
    .run(String(b.subject || '').trim(), String(b.body_md || ''), int(b.delay_days, 365), ['free', 'paid'].includes(b.cond) ? b.cond : '', req.params.pid, s.id);
  back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}?step=${encodeURIComponent(req.params.pid)}`, '저장했습니다.');
});
// 흐름 순서 변경: order=단계 id 를 새 순서대로 쉼표로 나열. 진행 중인 구독자는 "같은 메일"을 가리키도록 위치를 옮겨 준다
pro.post('/app/n/:nid/automation/:sid/reorder', async (req, res) => {
  const s = await getSeries(req);
  if (!s) return res.status(404).json({ ok: false });
  const steps = await db.prepare("SELECT id, step_pos FROM posts WHERE series_id=? AND kind='step' ORDER BY step_pos, id").all(s.id);
  const have = new Set(steps.map((x) => x.id));
  const order = [...new Set(String(req.body.order || '').split(',').map(Number).filter((i) => have.has(i)))];
  for (const x of steps) if (!order.includes(x.id)) order.push(x.id);
  const newPos = new Map(order.map((id, i) => [id, i + 1]));
  const moved = new Map();
  for (const x of steps) if (!moved.has(x.step_pos)) moved.set(x.step_pos, newPos.get(x.id));
  // 음수로 먼저 옮겼다가 되돌려 1→2, 2→3 같은 연쇄 덮어쓰기를 피한다
  for (const [from, to] of moved) await db.prepare('UPDATE series_enroll SET next_pos=? WHERE series_id=? AND done=0 AND next_pos=?').run(-to, s.id, from);
  await db.prepare('UPDATE series_enroll SET next_pos=-next_pos WHERE series_id=? AND next_pos<0').run(s.id);
  for (const [id, pos] of newPos) await db.prepare('UPDATE posts SET step_pos=? WHERE id=?').run(pos, id);
  res.json({ ok: true });
});
pro.post('/app/n/:nid/automation/:sid/steps/:pid/delete', async (req, res) => {
  const s = await getSeries(req);
  if (s) await db.prepare("DELETE FROM posts WHERE id=? AND series_id=? AND kind='step'").run(req.params.pid, s.id);
  back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}`, '삭제했습니다.');
});
pro.post('/app/n/:nid/automation/:sid/delete', async (req, res) => {
  const s = await getSeries(req);
  if (s) {
    await db.prepare("DELETE FROM posts WHERE series_id=? AND kind='step'").run(s.id);
    await db.prepare('DELETE FROM series WHERE id=?').run(s.id);
  }
  back(res, `/app/n/${req.nl.id}/automation`, '삭제했습니다.');
});

// ================= 성장 =================
pro.get('/app/n/:nid/growth', async (req, res) => {
  const nl = req.nl, base = baseUrl();
  const top = await db.prepare(`SELECT r.email, COUNT(*) n FROM subscribers s JOIN subscribers r ON r.id=s.referred_by
    WHERE s.newsletter_id=? AND s.status='active' GROUP BY r.id ORDER BY n DESC LIMIT 10`).all(nl.id);
  const total = (await db.prepare("SELECT COUNT(*) n FROM subscribers WHERE newsletter_id=? AND referred_by IS NOT NULL AND status='active'").get(nl.id)).n;
  const snippet = `<iframe src="${base}/n/${nl.slug}/embed" width="100%" height="190" style="border:0"></iframe>`;
  res.page('성장', `<h1>성장</h1>
<div class="stats"><div class="stat"><b>${total}</b>추천으로 가입한 구독자</div></div>
<h2>구독 폼 임베드</h2><div class="card"><p class="mute">블로그·웹사이트에 아래 코드를 붙여넣으세요.</p>
<textarea rows="3" readonly onclick="this.select()">${h(snippet)}</textarea>
<p style="margin:12px 0 0"><a class="btn" style="padding:4px 14px;font-size:13px" href="/n/${h(nl.slug)}/embed" target="_blank" rel="noopener">미리보기 ↗</a></p></div>
<h2>공유 링크</h2><div class="card"><p class="mute">구독 페이지: <input readonly value="${h(base)}/n/${h(nl.slug)}" onclick="this.select()"></p>
<p class="mute">각 글의 공개 페이지(/n/${h(nl.slug)}/p/글번호)에는 링크 복사·X·Facebook 공유 버튼과 미리보기(OG) 정보가 들어 있습니다.</p></div>
<h2>추천인 프로그램</h2><p class="mute">모든 메일 하단에 "친구에게 추천하기" 링크가 들어가고, 구독자마다 고유 추천 링크가 생깁니다. 추천받은 사람이 구독을 확정하면 집계됩니다.</p>
<form class="card" method="post" action="/app/n/${nl.id}/growth/rewards"><label>보상 단계 (한 줄에 하나: 추천 수:보상 이름)</label>
<textarea rows="4" name="rewards" placeholder="3:스티커 팩&#10;10:1:1 커피챗">${h(nl.rewards)}</textarea>
<p class="mute">보상 지급은 발행자가 직접 합니다. 구독자는 자신의 추천 현황 페이지에서 달성 여부를 볼 수 있습니다.</p><p><button class="primary">저장</button></p></form>
<h2>추천 순위</h2><div class="card"><table><tr><th>구독자</th><th>추천 수</th></tr>${top.map((t) => `<tr><td>${h(t.email)}</td><td>${t.n}</td></tr>`).join('')
    || '<tr><td colspan="2" class="mute">아직 없습니다.</td></tr>'}</table></div>`, { nl, active: 'growth', wide: true, msg: req.query.m });
});
pro.post('/app/n/:nid/growth/rewards', async (req, res) => {
  const lines = String(req.body.rewards || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,4}:.+/.test(l)).slice(0, 10);
  await db.prepare('UPDATE newsletters SET rewards=? WHERE id=?').run(lines.join('\n').slice(0, 1000), req.nl.id);
  back(res, `/app/n/${req.nl.id}/growth`, '저장했습니다.');
});
