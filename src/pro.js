// 발행자 영역 2단계: 수익 관리 · 자동화
import { findNewsletter } from './access.js';
import { parseLocal } from './editor.js';
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
// 단계의 발송 시점: 메일 간격(일) 또는 달력에서 날짜·시각 지정 + 대상 독자(전체·무료·유료)
const sendFields = () => `<input type="hidden" name="tz" id="ftz"><div class="row" style="margin-top:10px"><span class="mute">발송</span>
<select name="send_mode" id="fmode" style="width:auto"><option value="delay">메일 간격(일)</option><option value="date">날짜·시각 지정</option></select>
<input type="number" name="delay_days" id="fdelay" min="0" max="365" style="width:80px"><input type="datetime-local" name="send_at" id="fat" style="width:auto" hidden></div>
<div class="row" style="margin-top:8px"><span class="mute">대상</span><select name="cond" id="fcond" style="width:auto">${Object.entries(COND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
<p class="mute" id="fnote" style="margin:8px 0 0;font-size:12.5px"></p>`;
const SEND_JS = `function toLocal(iso){if(!iso)return '';var d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function syncMode(){var dt=$('fmode').value==='date';$('fdelay').hidden=dt;$('fat').hidden=!dt;$('fat').required=dt;
$('fnote').textContent=dt?'달력에서 고른 날짜·시각에 보내요. 그 시각이 하루 넘게 지난 뒤 합류한 구독자는 이 메일을 건너뜁니다.':'직전 메일을 보낸 뒤 며칠 뒤에 보내요. (첫 메일은 구독 후)'}
function fillSend(iso){$('fmode').value=iso?'date':'delay';$('fat').value=toLocal(iso);syncMode()}
$('fmode').addEventListener('change',syncMode);$('ftz').value=new Date().getTimezoneOffset();`;
const POST_STATUS = { draft: '초안', scheduled: '예약', sent: '발행됨' };
// "글" 탭에 있는 글(초안·예약·발행 모두) — 자동화 메일로 불러올 수 있다
const listPosts = (nlId) => db.prepare("SELECT id, subject, status, sent_at, created_at FROM posts WHERE newsletter_id=? AND kind='post' AND subject<>'' ORDER BY id DESC LIMIT 100").all(nlId);
const postPicker = (nl, s, posts, back) => `<form method="post" action="/app/n/${nl.id}/automation/${s.id}/steps/from-post"><input type="hidden" name="back" value="${back}">
<p class="mute" style="margin:0 0 10px">"글" 탭의 글을 고르면 제목과 본문이 이 흐름의 새 메일로 복사돼요. (원본 글은 그대로 두고, 복사된 메일만 따로 고칠 수 있어요.)</p>
<div style="max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:12px">${posts.map((x) => `<button name="post_id" value="${x.id}" type="submit" style="display:flex;width:100%;gap:10px;align-items:center;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;background:none;padding:12px 14px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(x.subject)}</span><span class="badge ${x.status}">${POST_STATUS[x.status] || x.status}</span><span class="mute" style="font-size:12px">${(x.sent_at || x.created_at || '').slice(0, 10)}</span></button>`).join('') || '<p class="mute" style="padding:14px;margin:0">"글" 탭에 제목이 있는 글이 아직 없어요.</p>'}</div></form>`;

pro.get('/app/n/:nid/automation', async (req, res) => {
  const nl = req.nl;
  const list = await db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM posts p WHERE p.series_id=s.id AND p.kind='step') steps,
    (SELECT COUNT(*) FROM series_enroll e WHERE e.series_id=s.id AND e.done=0) running,
    (SELECT COUNT(*) FROM series_enroll e WHERE e.series_id=s.id AND e.done=1) finished FROM series s WHERE s.newsletter_id=? ORDER BY s.id`).all(nl.id);
  res.page('자동화', `<h1>자동화</h1><p class="mute">구독이 확정되면 자동으로 발송되는 메일 흐름입니다. 메일을 단계로 쌓고, 끌어서 순서를 바꾸고, 단계마다 발송 시점(며칠 뒤)과 대상을 정할 수 있어요. 환영 메일은 "즉시(0일)" 단계 하나짜리 흐름입니다.</p>
<div class="card"><table><tr><th>이름</th><th>상태</th><th>단계</th><th>진행 중</th><th>완료</th></tr>${list.map((s) =>
  `<tr><td><a href="/app/n/${nl.id}/automation/${s.id}/map">${h(s.name)}</a></td><td><span class="badge ${s.active ? 'active' : ''}">${s.active ? '켜짐' : '꺼짐'}</span></td><td>${s.steps}</td><td>${s.running}</td><td>${s.finished}</td></tr>`).join('')
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
  const posts = await listPosts(nl.id);
  res.page(s.name, `<div class="row"><h1 class="grow">${h(s.name)}</h1>
<form method="post" action="/app/n/${nl.id}/automation/${s.id}" class="row"><input name="name" value="${h(s.name)}" style="width:200px">
<label style="margin:0"><input type="checkbox" name="active" value="1" style="width:auto" ${s.active ? 'checked' : ''}> 켜기</label><button class="sm">저장</button></form><a class="btn sm" href="/app/n/${nl.id}/automation/${s.id}/map">맵으로 보기</a></div>
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
${steps.map((p, i) => `<div class="fc"><i></i><span>${p.step_type === 'wait' ? `⏸ ${waitText(p)}` : p.send_at ? `📅 ${new Date(p.send_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : i ? `직전 메일 발송 후 ${p.delay_days}일` : p.delay_days ? `구독 후 ${p.delay_days}일` : '구독 즉시'}</span><i></i></div>
<div class="fn" draggable="false" data-id="${p.id}"><span class="hd" title="끌어서 순서 변경">⋮⋮</span><span class="no">${i + 1}</span>
<span class="tx"><b>${p.step_type === 'wait' ? '⏸ 일시정지' : h(p.subject || '(제목 없음)')}</b><small${p.step_type === 'wait' || (p.subject && p.body_md) ? '' : ' class="warn"'}>${p.step_type === 'wait' ? `${waitText(p)} 기다려요 (맵에서 수정)` : p.subject && p.body_md ? COND[p.cond] || COND[''] : '제목·본문이 비어 있으면 발송되지 않아요'}</small></span>
<span class="mv"><button type="button" class="up" aria-label="위로">▲</button><button type="button" class="dn" aria-label="아래로">▼</button></span></div>`).join('')}
<form class="fadd" method="post" action="/app/n/${nl.id}/automation/${s.id}/steps"><button>+ 메일 추가</button></form>
<details class="fadd" style="max-width:420px"><summary class="btn" style="display:inline-block;cursor:pointer">글에서 불러오기</summary><div style="margin-top:10px">${postPicker(nl, s, posts, '')}</div></details></div>
<div class="fpanel"><form class="card" id="fform" method="post" style="margin:0" hidden>
<div class="row"><b id="ftitle"></b><span class="grow"></span><a id="fstat" href="#">통계</a></div>
${sendFields()}
<label>제목</label><input name="subject" id="fsub" required>
<label>본문 (마크다운, {{name}} 사용 가능)</label><textarea name="body_md" id="fbody" rows="12"></textarea>
<div class="row" style="margin-top:10px"><button class="primary sm">저장</button><button type="submit" class="sm danger" id="fdel" onclick="return confirm('이 메일을 삭제할까요?')">메일 삭제</button></div></form>
<p class="mute" id="fhint">왼쪽 흐름도에서 메일을 선택하세요.</p></div></div>
<script>(function(){var D=${jsonForScript(steps.map((p) => ({ id: p.id, subject: p.subject, body_md: p.body_md, delay_days: p.delay_days, send_at: p.send_at, cond: p.cond, type: p.step_type === 'wait' ? 'wait' : 'mail' })))},B='/app/n/${nl.id}/automation/${s.id}',
map=document.getElementById('fmap'),f=document.getElementById('fform'),hint=document.getElementById('fhint');
function $(i){return document.getElementById(i)}
${SEND_JS}
function nodes(){return [].slice.call(map.querySelectorAll('.fn'))}
function sel(id){var d=D.filter(function(x){return x.id==id})[0];nodes().forEach(function(n){n.classList.toggle('sel',n.dataset.id==id)});if(!d||d.type==='wait'){f.hidden=true;hint.hidden=false;hint.innerHTML=d?'일시정지 단계는 <a href="'+B+'/map?step='+d.id+'&open=1">맵에서 수정</a>해 주세요.':'왼쪽 흐름도에서 메일을 선택하세요.';return}
f.hidden=false;hint.hidden=true;f.action=B+'/steps/'+d.id;$('ftitle').textContent='메일 '+(nodes().findIndex(function(n){return n.dataset.id==id})+1);$('fstat').href='/app/n/${nl.id}/posts/'+d.id+'/stats';
$('fdelay').value=d.delay_days;fillSend(d.send_at);$('fcond').value=d.cond||'';$('fsub').value=d.subject;$('fbody').value=d.body_md;$('fdel').formAction=B+'/steps/'+d.id+'/delete'}
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
// 자동화 맵: 흐름을 노드와 연결선으로 보여 주고, 한 노드의 오른쪽 점을 다른 노드로 끌어 "이 단계 다음에 저 단계"로 순서를 잇는다.
// 위쪽 도구 모음: 커서 · 이동 · 메일 추가 · 일시정지(Pause) · 글 불러오기 · 삭제. 카드를 클릭하면 수정 팝업이 열린다
const waitText = (p) => (p.send_at ? `${new Date(p.send_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}까지` : p.wait_hours % 24 === 0 ? `${p.wait_hours / 24}일` : `${p.wait_hours}시간`);
pro.get('/app/n/:nid/automation/:sid/map', async (req, res) => {
  const nl = req.nl, s = await getSeries(req);
  if (!s) return res.redirect(`/app/n/${nl.id}/automation`);
  const steps = await db.prepare("SELECT id, subject, body_md, delay_days, send_at, cond, step_type, wait_hours FROM posts WHERE series_id=? AND kind='step' ORDER BY step_pos, id").all(s.id);
  const posts = await listPosts(nl.id);
  const data = steps.map((p) => ({ id: p.id, type: p.step_type === 'wait' ? 'wait' : 'mail', subject: p.subject, body_md: p.body_md, delay: p.delay_days, sendAt: p.send_at, waitHours: p.wait_hours, cond: p.cond, condText: COND[p.cond] || COND[''] }));
  res.page(s.name + ' 맵', `<div class="row"><h1 class="grow">${h(s.name)}</h1>
<form method="post" action="/app/n/${nl.id}/automation/${s.id}" class="row"><input type="hidden" name="back" value="map"><input name="name" value="${h(s.name)}" style="width:200px">
<label style="margin:0"><input type="checkbox" name="active" value="1" style="width:auto" ${s.active ? 'checked' : ''}> 켜기</label><button class="sm">저장</button></form>
<a class="btn sm" href="/app/n/${nl.id}/automation/${s.id}">목록형 편집</a><button class="sm" type="button" id="mreset">배치 초기화</button></div>
<style>
.mtools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px;padding:8px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.mtools .tl{display:inline-flex;gap:6px;align-items:center;border:1px solid transparent;background:none;border-radius:10px;padding:7px 12px;font-size:14px;cursor:pointer;color:inherit}
.mtools .tl:hover{background:var(--soft)}.mtools .tl.on{background:var(--blue-soft);color:var(--blue);border-color:var(--blue);font-weight:600}
.mtools .sep{width:1px;height:22px;background:var(--line);margin:0 4px}
.mtools #thint{font-size:13px;color:var(--mute);margin-left:auto;padding-right:6px}
.mcv{position:relative;height:max(660px,calc(100vh - 290px));margin-top:10px;overflow:auto;border:1px solid var(--line);border-radius:16px;background:var(--soft);background-image:radial-gradient(var(--line) 1px,transparent 1px);background-size:22px 22px}
.mcv[data-tool=hand]{cursor:grab}.mcv[data-tool=hand].pan{cursor:grabbing}.mcv[data-tool=mail],.mcv[data-tool=pause]{cursor:copy}
.mcv[data-tool=delete] .nd:not(.st){cursor:pointer}.mcv[data-tool=delete] .nd:not(.st):hover{border-color:var(--bad);box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 20%,transparent)}
.mcv svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.mcv path{fill:none;stroke:var(--blue);stroke-width:3}.mcv path.tmp{stroke-dasharray:6 5;opacity:.7}
.nd{position:absolute;width:290px;border:1px solid var(--line);background:var(--card);border-radius:18px;padding:18px 20px;box-shadow:0 6px 18px -14px #0F172A;user-select:none;cursor:grab;touch-action:none}
.nd:active{cursor:grabbing}.nd.sel{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}
.nd.st{width:140px;text-align:center;border-radius:999px;border-style:dashed;padding:16px 10px;font-size:16px;font-weight:600;color:var(--mute);background:var(--soft)}
.nd.wt{width:230px;border-style:dashed;border-color:#F59E0B;background:color-mix(in srgb,#F59E0B 8%,var(--card))}
.nd.wt .no{background:#FEF3C7;color:#B45309}
.nd.over{border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 30%,transparent)}
.nd .hd{display:flex;gap:12px;align-items:center}
.nd .no{flex:0 0 32px;height:32px;border-radius:50%;background:var(--blue-soft);color:var(--blue);font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center}
.nd .tt{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:17px}
.nd small{display:block;margin-top:10px;color:var(--mute);font-size:14px}.nd small.warn{color:var(--bad)}
.nd .pt{position:absolute;top:50%;width:22px;height:22px;margin-top:-11px;border-radius:50%;background:var(--blue);border:4px solid var(--card);box-shadow:0 0 0 1px var(--blue)}
.nd .pt.out{right:-12px;cursor:crosshair}.nd .pt.in{left:-12px;background:var(--card);box-shadow:0 0 0 1px var(--line)}
.elb{position:absolute;transform:translate(-50%,-50%);font-size:13px;color:var(--mute);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:1px 8px;white-space:nowrap;pointer-events:none}
.mmodal{position:fixed;inset:0;z-index:50;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px}
.mmodal[hidden]{display:none}
.mmodal .card{width:min(640px,100%);max-height:calc(100vh - 40px);overflow:auto;margin:0;box-shadow:0 30px 80px -20px rgba(15,23,42,.5)}
.mmodal .x{border:0;background:none;font-size:22px;line-height:1;padding:2px 8px;cursor:pointer;color:var(--mute)}
</style>
<div class="mtools" id="mtools">
<button type="button" class="tl on" data-tool="cursor" title="커서 (V)">🖱 커서</button><button type="button" class="tl" data-tool="hand" title="화면 이동 (H)">✋ 이동</button><span class="sep"></span>
<button type="button" class="tl" data-tool="mail" title="메일 추가 (M)">✉ 메일</button><button type="button" class="tl" data-tool="pause" title="일시정지 추가 (P)">⏸ 일시정지</button><button type="button" class="tl" id="pickopen" title="글 탭의 글을 메일로 불러오기">📥 글 불러오기</button><span class="sep"></span>
<button type="button" class="tl" data-tool="delete" title="단계 삭제 (X)">🗑 삭제</button><span id="thint"></span></div>
<div class="mcv" id="mcv" data-tool="cursor"><svg id="msv" width="100" height="100"></svg></div>
<div class="mmodal" id="pickmodal" hidden><div class="card"><div class="row"><b style="font-size:18px">글에서 불러오기</b><span class="grow"></span><button type="button" class="x" id="pickclose" aria-label="닫기">✕</button></div>${postPicker(nl, s, posts, 'map')}</div></div>
<div class="mmodal" id="fmodal" hidden><form class="card" id="fform" method="post"><input type="hidden" name="back" value="map">
<div class="row"><b id="ftitle" style="font-size:18px"></b><span class="grow"></span><a id="fstat" href="#">통계</a><button type="button" class="x" id="fclose" aria-label="닫기">✕</button></div>
${sendFields()}
<label>제목</label><input name="subject" id="fsub" required>
<label>본문 (마크다운, {{name}} 사용 가능)</label><textarea name="body_md" id="fbody" rows="12"></textarea>
<div class="row" style="margin-top:10px"><button class="primary sm">저장</button><button type="submit" class="sm danger" id="fdel" onclick="return confirm('이 메일을 삭제할까요?')">메일 삭제</button></div></form></div>
<div class="mmodal" id="wmodal" hidden><form class="card" id="wform" method="post" style="max-width:520px"><input type="hidden" name="back" value="map"><input type="hidden" name="tz" id="wtz">
<div class="row"><b style="font-size:18px">⏸ 일시정지</b><span class="grow"></span><button type="button" class="x" id="wclose" aria-label="닫기">✕</button></div>
<p class="mute" style="margin:8px 0 0">이 카드에 도착한 구독자는 아래 기간 동안 기다렸다가 다음 단계로 넘어가요. 기다리는 동안에는 메일이 가지 않습니다.</p>
<div class="row" style="margin-top:12px"><span class="mute">대기 방식</span><select name="send_mode" id="wmode" style="width:auto"><option value="delay">기간 동안</option><option value="date">날짜·시각까지</option></select>
<input type="number" name="wait_amount" id="wamt" min="1" max="365" style="width:90px"><select name="wait_unit" id="wunit" style="width:auto"><option value="days">일</option><option value="hours">시간</option></select>
<input type="datetime-local" name="send_at" id="wat" style="width:auto" hidden></div>
<div class="row" style="margin-top:14px"><button class="primary sm">저장</button><button type="submit" class="sm danger" id="wdel" onclick="return confirm('이 일시정지를 삭제할까요?')">삭제</button></div></form></div>
<script>(function(){var S=${jsonForScript(data)},B='/app/n/${nl.id}/automation/${s.id}',KEY='fmap:${s.id}',W=290,H=118,SW=140,SH=60,WW=230,WH=96;
var cv=document.getElementById('mcv'),svg=document.getElementById('msv'),NS='http://www.w3.org/2000/svg',pos={},els={},labels=[],f=document.getElementById('fform'),modal=document.getElementById('fmodal'),wmodal=document.getElementById('wmodal'),tool='cursor';
function $(i){return document.getElementById(i)}
${SEND_JS}
$('wtz').value=new Date().getTimezoneOffset();
try{pos=JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(e){pos={}}
function dflt(k,i){return k==='start'?[40,300]:[250+i*400,(i%2?190:330)]}
function idx(k){return S.findIndex(function(d){return String(d.id)===String(k)})}
function P(k){return pos[k]||dflt(k,k==='start'?-1:idx(k))}
function mk(cls,k){var n=document.createElement('div');n.className='nd '+cls;n.dataset.k=k;els[k]=n;cv.appendChild(n);var p=P(k);n.style.left=p[0]+'px';n.style.top=p[1]+'px';return n}
function port(n,c,k){var s=document.createElement('span');s.className='pt '+c;if(k!=null)s.dataset.k=k;n.appendChild(s)}
function fmtAt(iso){return new Date(iso).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function waitTxt(d){return d.sendAt?fmtAt(d.sendAt)+'까지':d.waitHours%24===0?(d.waitHours/24)+'일 동안':d.waitHours+'시간 동안'}
function mailNo(i){var n=0;for(var j=0;j<=i;j++)if(S[j].type==='mail')n++;return n}
function fill(n,d,i){n.innerHTML='';var hd=document.createElement('div');hd.className='hd';var no=document.createElement('span');no.className='no';var tt=document.createElement('span');tt.className='tt';var sm=document.createElement('small');
if(d.type==='wait'){n.classList.add('wt');no.textContent='⏸';tt.textContent='일시정지';sm.textContent=waitTxt(d)+' 기다려요'}
else{no.textContent=mailNo(i);tt.textContent=d.subject||'(제목 없음)';if(d.subject&&d.body_md){sm.textContent=d.condText}else{sm.className='warn';sm.textContent='제목·본문이 비어 있으면 발송되지 않아요'}}
hd.appendChild(no);hd.appendChild(tt);n.appendChild(hd);n.appendChild(sm);port(n,'in');port(n,'out',d.id)}
var st=mk('st','start');st.textContent='구독 확정';port(st,'out','start');
S.forEach(function(d,i){fill(mk('',d.id),d,i)});
function size(k){if(k==='start')return [SW,SH];var d=S[idx(k)];return d&&d.type==='wait'?[WW,WH]:[W,H]}
function anchor(k,side){var p=P(k),s=size(k),el=els[k],h=el?el.offsetHeight:s[1];return [p[0]+(side==='out'?(el?el.offsetWidth:s[0]):0),p[1]+h/2]}
function curve(a,b){var dx=Math.max(50,Math.abs(b[0]-a[0])/2);return 'M'+a[0]+','+a[1]+' C'+(a[0]+dx)+','+a[1]+' '+(b[0]-dx)+','+b[1]+' '+b[0]+','+b[1]}
function lbl(i){var d=S[i],prev=i?S[i-1]:null;if(d.type==='wait')return '';if(d.sendAt)return '📅 '+fmtAt(d.sendAt);
if(!i)return d.delay?'구독 후 '+d.delay+'일':'구독 즉시';if(prev.type==='wait')return d.delay?'일시정지 후 '+d.delay+'일':'일시정지 후 바로';return '직전 발송 후 '+d.delay+'일'}
function draw(){svg.querySelectorAll('path:not(.tmp)').forEach(function(p){p.remove()});labels.forEach(function(l){l.remove()});labels=[];
var keys=['start'].concat(S.map(function(d){return d.id})),mx=900,my=520;
keys.forEach(function(k){var p=P(k),s=size(k);mx=Math.max(mx,p[0]+s[0]+80);my=Math.max(my,p[1]+(els[k]?els[k].offsetHeight:s[1])+80)});
svg.setAttribute('width',mx);svg.setAttribute('height',my);
for(var i=0;i<S.length;i++){var from=i?S[i-1].id:'start',a=anchor(from,'out'),b=anchor(S[i].id,'in'),p=document.createElementNS(NS,'path');p.setAttribute('d',curve(a,b));svg.insertBefore(p,svg.firstChild);
var t=lbl(i);if(!t)continue;var l=document.createElement('span');l.className='elb';l.style.left=(a[0]+b[0])/2+'px';l.style.top=(a[1]+b[1])/2+'px';l.textContent=t;cv.appendChild(l);labels.push(l)}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(pos))}catch(e){}}
function closeModal(){modal.hidden=true;wmodal.hidden=true;$('pickmodal').hidden=true}
$('pickopen').addEventListener('click',function(){$('pickmodal').hidden=false});$('pickclose').addEventListener('click',closeModal);$('pickmodal').addEventListener('pointerdown',function(e){if(e.target===$('pickmodal'))closeModal()});
function syncWait(){var dt=$('wmode').value==='date';$('wamt').hidden=dt;$('wunit').hidden=dt;$('wat').hidden=!dt;$('wat').required=dt;$('wamt').required=!dt}
$('wmode').addEventListener('change',syncWait);
// 카드를 선택해 강조하고, open 이 true 면 수정 팝업을 연다 (메일은 메일 폼, 일시정지는 대기 폼)
function sel(id,open){var d=S[idx(id)];Object.keys(els).forEach(function(k){els[k].classList.toggle('sel',String(k)===String(id))});
if(!d||!open){return}
try{history.replaceState(null,'',B+'/map?step='+d.id)}catch(e){}
if(d.type==='wait'){wmodal.hidden=false;$('wform').action=B+'/steps/'+d.id;$('wdel').formAction=B+'/steps/'+d.id+'/delete';$('wmode').value=d.sendAt?'date':'delay';$('wat').value=toLocal(d.sendAt);
var hrs=d.waitHours||24;if(hrs%24===0){$('wamt').value=hrs/24;$('wunit').value='days'}else{$('wamt').value=hrs;$('wunit').value='hours'}syncWait();return}
modal.hidden=false;f.action=B+'/steps/'+d.id;$('ftitle').textContent='메일 '+mailNo(idx(id));$('fstat').href='/app/n/${nl.id}/posts/'+d.id+'/stats';
$('fdelay').value=d.delay;fillSend(d.sendAt);$('fcond').value=d.cond||'';$('fsub').value=d.subject;$('fbody').value=d.body_md;$('fdel').formAction=B+'/steps/'+d.id+'/delete';$('fsub').focus()}
$('fclose').addEventListener('click',closeModal);$('wclose').addEventListener('click',closeModal);
modal.addEventListener('pointerdown',function(e){if(e.target===modal)closeModal()});wmodal.addEventListener('pointerdown',function(e){if(e.target===wmodal)closeModal()});
// 도구 모음
var HINT={cursor:'카드를 클릭해 수정 · 끌어서 옮기기 · 오른쪽 점을 끌어 순서 잇기',hand:'빈 곳을 끌어 화면을 움직여요',mail:'빈 곳을 클릭하면 메일 카드가 추가돼요 (흐름 맨 끝)',pause:'빈 곳을 클릭하면 일시정지 카드가 추가돼요 (기간 동안 다음 메일이 멈춤)',delete:'지울 카드를 클릭하세요'};
function setTool(t){tool=t;cv.dataset.tool=t;[].slice.call(document.querySelectorAll('#mtools .tl[data-tool]')).forEach(function(b){b.classList.toggle('on',b.dataset.tool===t)});$('thint').textContent=HINT[t]}
[].slice.call(document.querySelectorAll('#mtools .tl[data-tool]')).forEach(function(b){b.addEventListener('click',function(){setTool(b.dataset.tool)})});setTool('cursor');
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeModal();setTool('cursor');return}
if(e.metaKey||e.ctrlKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test((e.target&&e.target.tagName)||'')||!modal.hidden||!wmodal.hidden||!$('pickmodal').hidden)return;
var m={v:'cursor',h:'hand',m:'mail',p:'pause',x:'delete'}[e.key.toLowerCase()];if(m)setTool(m)});
function post(path,body){return fetch(B+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body})}
function del(k){var d=S[idx(k)];if(!d||!confirm(d.type==='wait'?'이 일시정지를 삭제할까요?':'이 메일을 삭제할까요?'))return;delete pos[k];save();post('/steps/'+k+'/delete','back=map').then(function(){location.href=B+'/map'}).catch(function(){location.reload()})}
// 카드 끌기(자유 배치). 거의 움직이지 않고 떼면 클릭으로 보고 수정 폼을 연다. 삭제 도구에서는 클릭이 삭제
function drag(n,k,onClick){n.addEventListener('pointerdown',function(e){if(e.target.closest('.pt'))return;
if(tool==='delete'){e.preventDefault();e.stopPropagation();if(k!=='start')del(k);return}
if(tool!=='cursor')return;
e.preventDefault();var p=P(k),sx=e.clientX,sy=e.clientY,ox=p[0],oy=p[1],moved=false;n.setPointerCapture(e.pointerId);
function mv(ev){var dx=ev.clientX-sx,dy=ev.clientY-sy;if(!moved&&Math.abs(dx)+Math.abs(dy)<5)return;moved=true;var x=Math.max(0,ox+dx),y=Math.max(0,oy+dy);pos[k]=[x,y];n.style.left=x+'px';n.style.top=y+'px';draw()}
function up(){n.removeEventListener('pointermove',mv);n.removeEventListener('pointerup',up);if(moved)save();else if(onClick)onClick()}n.addEventListener('pointermove',mv);n.addEventListener('pointerup',up)})}
drag(st,'start');S.forEach(function(d){drag(els[d.id],d.id,function(){sel(d.id,true)})});
function at(ev){var r=cv.getBoundingClientRect();return [ev.clientX-r.left+cv.scrollLeft,ev.clientY-r.top+cv.scrollTop]}
// 빈 곳 클릭: 이동 도구는 화면 끌기, 메일·일시정지 도구는 그 자리에 새 카드 추가
cv.addEventListener('pointerdown',function(e){if(e.target.closest('.pt'))return;if(tool!=='hand'&&(e.target.closest('.nd')||e.target.closest('.elb')))return;
if(tool==='hand'){e.preventDefault();var sx=e.clientX,sy=e.clientY,l0=cv.scrollLeft,t0=cv.scrollTop;cv.classList.add('pan');cv.setPointerCapture(e.pointerId);
function mv(ev){cv.scrollLeft=l0-(ev.clientX-sx);cv.scrollTop=t0-(ev.clientY-sy)}function up(){cv.classList.remove('pan');cv.removeEventListener('pointermove',mv);cv.removeEventListener('pointerup',up)}cv.addEventListener('pointermove',mv);cv.addEventListener('pointerup',up);return}
if(tool==='mail'||tool==='pause'){e.preventDefault();var c=at(e),wait=tool==='pause';
post('/steps','json=1&back=map&type='+(wait?'wait':'mail')).then(function(r){return r.json()}).then(function(j){if(!j.id)throw 0;pos[j.id]=[Math.max(0,c[0]-(wait?WW:W)/2),Math.max(0,c[1]-(wait?WH:H)/2)];save();location.href=B+'/map?step='+j.id+'&open=1'}).catch(function(){location.reload()})}});
// 오른쪽 점을 다른 단계로 끌어 놓으면 "이 단계 다음에 저 단계"로 순서를 바꾼다
cv.addEventListener('pointerdown',function(e){var pt=e.target.closest('.pt.out');if(!pt||tool==='delete')return;e.preventDefault();e.stopPropagation();var from=pt.dataset.k,a=anchor(from,'out'),t=document.createElementNS(NS,'path');t.setAttribute('class','tmp');svg.appendChild(t);var over=null;
pt.setPointerCapture(e.pointerId);
function target(ev){var el=document.elementFromPoint(ev.clientX,ev.clientY),nd=el&&el.closest('.nd:not(.st)');return nd&&nd.dataset.k!==String(from)?nd:null}
function mv(ev){t.setAttribute('d',curve(a,at(ev)));var nd=target(ev);if(over&&over!==nd)over.classList.remove('over');over=nd;if(over)over.classList.add('over')}
function up(ev){pt.removeEventListener('pointermove',mv);pt.removeEventListener('pointerup',up);t.remove();if(over)over.classList.remove('over');
var nd=target(ev);if(!nd)return;var tk=nd.dataset.k,ids=S.map(function(d){return String(d.id)}).filter(function(i){return i!==tk}),at2=from==='start'?0:ids.indexOf(String(from))+1;ids.splice(at2,0,tk);
if(ids.join()===S.map(function(d){return String(d.id)}).join())return;
var cur=(location.search.match(/step=(\d+)/)||[])[1];
post('/reorder','order='+ids.join(',')).then(function(){location.href=B+'/map'+(cur?'?step='+cur:'')}).catch(function(){location.reload()})}
pt.addEventListener('pointermove',mv);pt.addEventListener('pointerup',up);pt.addEventListener('pointercancel',function(){t.remove();if(over)over.classList.remove('over')});mv(e)});
$('mreset').addEventListener('click',function(){pos={};try{localStorage.removeItem(KEY)}catch(e){}location.reload()});
draw();requestAnimationFrame(draw);
var q=new URLSearchParams(location.search).get('step');if(S.some(function(x){return String(x.id)===q}))sel(q,/[?&]open=1/.test(location.search))})();</script>
<p><a href="/app/n/${nl.id}/automation">← 자동화 목록</a></p>`, { nl, active: 'automation', wide: true, msg: req.query.m });
});

pro.post('/app/n/:nid/automation/:sid', async (req, res) => {
  const s = await getSeries(req);
  if (s) await db.prepare('UPDATE series SET name=?, active=? WHERE id=?').run(String(req.body.name || s.name).trim().slice(0, 60), req.body.active ? 1 : 0, s.id);
  back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}${req.body.back === 'map' ? '/map' : ''}`, '저장했습니다.');
});
pro.post('/app/n/:nid/automation/:sid/steps', async (req, res) => {
  const s = await getSeries(req);
  if (!s) return req.body.json ? res.status(404).json({ ok: false }) : res.redirect(`/app/n/${req.nl.id}/automation`);
  const pos = ((await db.prepare("SELECT MAX(step_pos) m FROM posts WHERE series_id=? AND kind='step'").get(s.id)).m || 0) + 1;
  const wait = req.body.type === 'wait'; // 일시정지: 메일 없이 기간만 기다리는 단계 (기본 1일)
  const id = Number((await db.prepare("INSERT INTO posts(newsletter_id,kind,status,series_id,step_pos,delay_days,subject,body_md,created_at,step_type,wait_hours) VALUES(?,'step','auto',?,?,?,?,?,?,?,?)")
    .run(req.nl.id, s.id, pos, wait || pos === 1 ? 0 : 3, '', '', now(), wait ? 'wait' : '', wait ? 24 : 0)).lastInsertRowid);
  if (req.body.json) return res.json({ id });
  back(res, `/app/n/${req.nl.id}/automation/${s.id}${req.body.back === 'map' ? '/map' : ''}?step=${id}${req.body.back === 'map' ? '&open=1' : ''}`, wait ? '일시정지를 추가했습니다. 기간을 정해 주세요.' : '메일을 추가했습니다. 제목과 본문을 채워주세요.');
});
pro.post('/app/n/:nid/automation/:sid/steps/from-post', async (req, res) => {
  const s = await getSeries(req);
  if (!s) return res.redirect(`/app/n/${req.nl.id}/automation`);
  const src = await db.prepare("SELECT subject, body_md FROM posts WHERE id=? AND newsletter_id=? AND kind='post'").get(req.body.post_id, req.nl.id);
  const mapPage = req.body.back === 'map' ? '/map' : '';
  if (!src) return back(res, `/app/n/${req.nl.id}/automation/${s.id}${mapPage}`, '글을 찾을 수 없습니다.');
  const pos = ((await db.prepare("SELECT MAX(step_pos) m FROM posts WHERE series_id=? AND kind='step'").get(s.id)).m || 0) + 1;
  const id = Number((await db.prepare("INSERT INTO posts(newsletter_id,kind,status,series_id,step_pos,delay_days,subject,body_md,created_at) VALUES(?,'step','auto',?,?,?,?,?,?)")
    .run(req.nl.id, s.id, pos, pos === 1 ? 0 : 3, src.subject, src.body_md, now())).lastInsertRowid);
  back(res, `/app/n/${req.nl.id}/automation/${s.id}${mapPage}?step=${id}${mapPage ? '&open=1' : ''}`, '글을 메일로 불러왔습니다. 발송 시점을 확인해 주세요.');
});
pro.post('/app/n/:nid/automation/:sid/steps/:pid', async (req, res) => {
  const s = await getSeries(req), b = req.body;
  const to = (m) => back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}${b.back === 'map' ? '/map' : ''}?step=${encodeURIComponent(req.params.pid)}`, m);
  const cur = s && await db.prepare("SELECT step_type FROM posts WHERE id=? AND series_id=? AND kind='step'").get(req.params.pid, s.id);
  const when = b.send_mode === 'date' ? parseLocal(b.send_at, b.tz) : null; // 달력으로 고른 시각(UTC ISO)
  if (cur?.step_type === 'wait') {
    if (b.send_mode === 'date' && !when) return to('날짜와 시각을 선택하세요.');
    const hours = Math.min(8760, Math.max(1, int(b.wait_amount, 365) || 1) * (b.wait_unit === 'hours' ? 1 : 24));
    await db.prepare("UPDATE posts SET wait_hours=?, send_at=? WHERE id=? AND series_id=? AND kind='step'").run(hours, when, req.params.pid, s.id);
    return to('저장했습니다.');
  }
  if (b.send_mode === 'date' && !when) return to('발송 날짜와 시각을 선택하세요.');
  if (s) await db.prepare("UPDATE posts SET subject=?, body_md=?, delay_days=?, send_at=?, cond=? WHERE id=? AND series_id=? AND kind='step'")
    .run(String(b.subject || '').trim(), String(b.body_md || ''), int(b.delay_days, 365), when, ['free', 'paid'].includes(b.cond) ? b.cond : '', req.params.pid, s.id);
  back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}${b.back === 'map' ? '/map' : ''}?step=${encodeURIComponent(req.params.pid)}`, '저장했습니다.');
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
  back(res, `/app/n/${req.nl.id}/automation/${req.params.sid}${req.body.back === 'map' ? '/map' : ''}`, '삭제했습니다.');
});
pro.post('/app/n/:nid/automation/:sid/delete', async (req, res) => {
  const s = await getSeries(req);
  if (s) {
    await db.prepare("DELETE FROM posts WHERE series_id=? AND kind='step'").run(s.id);
    await db.prepare('DELETE FROM series WHERE id=?').run(s.id);
  }
  back(res, `/app/n/${req.nl.id}/automation`, '삭제했습니다.');
});
