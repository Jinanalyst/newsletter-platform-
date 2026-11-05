// 팀 채팅 패널: 소유자·팀원이 운영 화면 어디서든 대화한다.
// 상태 4가지 — bubble(생략: 둥근 버튼만) · bar(축소: 제목줄만) · open(기본) · max(확장: 오른쪽 전체 높이)
(() => {
  const root = document.getElementById('tchat');
  if (!root) return;
  const nid = root.dataset.nid, url = `/app/n/${nid}/chat`;
  const KEY = 'tchat:' + nid;
  const $ = (s) => root.querySelector(s);
  const list = $('.tc-list'), input = $('textarea'), badge = $('.tc-badge'), bbadge = $('.tc-bubble i');
  let state = 'bar', last = 0, me = 0, unread = 0, timer = 0, busy = false, lastDay = '';
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); if (['bubble', 'bar', 'open', 'max'].includes(v.state)) state = v.state; } catch { /* 저장소를 못 쓰면 기본 상태 */ }
  const seenKey = KEY + ':seen';
  let seen = 0;
  try { seen = Number(localStorage.getItem(seenKey) || 0); } catch { /* 무시 */ }

  const visible = () => (state === 'open' || state === 'max') && !document.hidden;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ state })); } catch { /* 무시 */ } };
  const markSeen = () => {
    unread = 0; seen = last;
    try { localStorage.setItem(seenKey, String(seen)); } catch { /* 무시 */ }
    paintBadge();
  };
  const paintBadge = () => {
    const t = unread > 99 ? '99+' : String(unread);
    badge.textContent = bbadge.textContent = unread ? t : '';
  };
  const set = (s) => {
    state = s; root.dataset.state = s; save();
    if (visible()) { markSeen(); scroll(); setTimeout(() => input.focus(), 0); }
    schedule(0);
  };
  const scroll = () => { list.scrollTop = list.scrollHeight; };

  const time = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const day = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  function add(m) {
    const d = day(m.created_at);
    if (d !== lastDay) { lastDay = d; const s = document.createElement('div'); s.className = 'tc-day'; s.textContent = d; list.append(s); }
    const mine = m.user_id === me;
    const prev = list.lastElementChild;
    const el = document.createElement('div');
    el.className = 'tc-msg' + (mine ? ' me' : '');
    el.dataset.uid = m.user_id;
    if (!mine && !(prev && prev.dataset.uid === String(m.user_id))) { const n = document.createElement('b'); n.textContent = m.name; el.append(n); }
    const p = document.createElement('p'); p.textContent = m.body; el.append(p);
    const t = document.createElement('time'); t.textContent = time(m.created_at); el.append(t);
    list.append(el);
  }

  // 인원 수에 마우스를 올리면 누가 온라인·오프라인인지 보여준다
  const count = $('.tc-head small');
  function paintMembers(ms) {
    if (!ms || !count) return;
    const on = ms.filter((m) => m.online).length;
    count.textContent = '';
    const dot = document.createElement('i');
    dot.style.cssText = `display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:middle;background:${on > 1 ? '#22A05A' : '#CBD5E1'}`;
    count.append(dot, `${ms.length}명 · ${on} 온라인`);
    const line = (m) => `${m.online ? '●' : '○'}  ${m.name}${m.owner ? ' (소유자)' : ''}${m.id === me ? ' (나)' : ''}  ·  ${m.online ? '온라인' : '오프라인'}`;
    count.title = [...ms.filter((m) => m.online), ...ms.filter((m) => !m.online)].map(line).join('\n');
    count.style.cursor = 'help';
  }

  async function poll() {
    if (busy) return schedule();
    busy = true;
    try {
      const r = await fetch(`${url}?after=${last}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (r.ok) {
        const j = await r.json();
        me = j.me;
        paintMembers(j.members);
        const near = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
        const first = !last;
        for (const m of j.messages) {
          add(m); last = m.id;
          if (m.user_id !== me && m.id > seen) unread++;
        }
        if (first && !j.messages.length) list.innerHTML = '<div class="tc-empty">첫 메시지를 남겨 보세요.<br>팀원 모두가 이 대화를 함께 봐요.</div>';
        else list.querySelector('.tc-empty')?.remove();
        if (j.messages.length && (near || first)) scroll();
        if (visible()) markSeen(); else paintBadge();
      }
    } catch { /* 네트워크 오류는 다음 주기에 다시 */ }
    busy = false;
    schedule();
  }
  // 열려 있으면 2.5초, 접혀 있거나 탭이 숨겨지면 12초마다
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(poll, ms ?? (visible() ? 2500 : 12000));
  }

  async function send() {
    const body = input.value.trim();
    if (!body) return;
    input.value = ''; grow();
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ body }) });
      if (!r.ok) throw new Error();
    } catch { input.value = body; grow(); alert('메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    schedule(0);
  }
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };

  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('.tc-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('.tc-head').addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'fold') set(state === 'bar' ? 'open' : 'bar');
    else if (a === 'max') set(state === 'max' ? 'open' : 'max');
    else if (a === 'hide') set('bubble');
    else if (!a && state === 'bar') set('open');
  });
  $('.tc-bubble').addEventListener('click', () => set('open'));
  document.addEventListener('visibilitychange', () => { if (visible()) markSeen(); schedule(visible() ? 0 : undefined); });

  root.dataset.state = state;
  poll();
})();
