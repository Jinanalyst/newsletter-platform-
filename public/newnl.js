// 뉴스레터 개설 마법사: 질문 하나씩 묻고 답하면 위에 대화처럼 쌓인다. 마지막에 기존 /app/new 로 한 번에 보낸다.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
  const SUGGEST = ['에세이', '인터뷰', '큐레이션', '리뷰', '뉴스', '칼럼', '일기', '레시피', '투자', '기술'];
  const A = { name: '', slug: '', description: '', categories: [], logo: '', sns: {} }; // 답변
  const skipped = {};
  let cur = 0, slugState = { v: '', ok: false, msg: '' }, slugTimer = 0, busy = false;

  const STEPS = [
    { k: 'name', q: '뉴스레터 이름이 무엇인가요?', hint: '독자에게 보여지는 이름이에요. 나중에 바꿀 수 있어요.', req: true },
    { k: 'slug', q: '공개 주소를 정해 볼까요?', hint: '영문 소문자·숫자·하이픈(-)으로 3~30자. 이 주소로 독자가 찾아와요.', req: true },
    { k: 'description', q: '어떤 뉴스레터인지 소개해 주세요.', hint: '한두 문장이면 충분해요. 공개 페이지 맨 위에 보여요.' },
    { k: 'categories', q: '주로 다루는 주제가 있나요?', hint: '글마다 하나씩 고르고, 공개 아카이브에서 필터로 쓰여요. 최대 10개.' },
    { k: 'logo', q: '로고 이미지를 올려 볼까요?', hint: 'PNG·JPG·GIF·WEBP, 3MB 이하. 정사각형이 예뻐요.' },
    { k: 'sns', q: '함께 보여줄 SNS나 링크가 있나요?', hint: '공개 페이지 상단에 아이콘으로 표시돼요.' },
    { k: 'done', q: '준비됐어요! 이대로 만들까요?' },
  ];
  const summary = (k) => {
    if (skipped[k]) return '건너뜀';
    if (k === 'slug') return '/n/' + A.slug;
    if (k === 'categories') return A.categories.join(', ');
    if (k === 'logo') return '로고 등록됨';
    if (k === 'sns') return Object.keys(A.sns).length + '개 링크';
    return A[k];
  };

  const chat = $('wzchat'), box = $('wzcur'), bar = $('wzp');
  const bubble = (q, hint) => { const b = el('div', 'wq'); b.appendChild(el('b', '', q)); if (hint) b.appendChild(el('span', 'mute', hint)); return b; };
  const go = (i) => { cur = i; render(); };

  function render() {
    bar.style.width = Math.round((cur / (STEPS.length - 1)) * 100) + '%';
    chat.textContent = ''; // 이전 질문·답변은 화면에 남기지 않는다 (← 이전 으로 돌아가 고칠 수 있다)
    box.textContent = '';
    const s = STEPS[cur];
    if (s.k !== 'done') box.appendChild(el('p', 'mute wstep', (cur + 1) + ' / ' + (STEPS.length - 1)));
    box.appendChild(bubble(s.q, s.hint));
    const body = el('div', 'wbody'); box.appendChild(body);
    const nav = el('div', 'wnav'); box.appendChild(nav);
    const next = el('button', 'primary', s.k === 'done' ? '뉴스레터 개설하기' : '다음 →'); next.type = 'button';
    const back = el('button', 'ghost', '← 이전'); back.type = 'button'; back.onclick = () => go(cur - 1);
    if (cur > 0) nav.appendChild(back);
    if (!s.req && s.k !== 'done') { const sk = el('button', 'ghost', '건너뛰기'); sk.type = 'button'; sk.onclick = () => { skipped[s.k] = true; clearAnswer(s.k); go(cur + 1); }; nav.appendChild(sk); }
    nav.appendChild(next);
    const err = el('p', 'werr'); err.hidden = true; box.appendChild(err);
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const advance = () => { delete skipped[s.k]; go(cur + 1); };
    const R = RENDER[s.k](body, next, fail);
    next.onclick = async () => { err.hidden = true; if (busy) return; if (await R.commit()) { if (s.k === 'done') return; advance(); } };
    R.focus?.();
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function clearAnswer(k) { A[k] = k === 'categories' ? [] : k === 'sns' ? {} : ''; }

  const textInput = (body, next, key, { max, ph, area } = {}) => {
    const i = area ? el('textarea') : el('input'); i.value = A[key]; i.maxLength = max; i.placeholder = ph || ''; if (area) i.rows = 3; else i.type = 'text';
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); next.click(); } });
    body.appendChild(i); return i;
  };

  const RENDER = {
    name(body, next, fail) {
      const i = textInput(body, next, 'name', { max: 60, ph: '예) 월요일 아침, 한 가지 생각' });
      return { focus: () => i.focus(), commit: () => { const v = i.value.trim(); if (!v) return fail('이름을 입력해 주세요.'); A.name = v; return true; } };
    },
    slug(body, next, fail) {
      const i = textInput(body, next, 'slug', { max: 30, ph: 'my-letter' });
      if (!A.slug) i.value = A.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); // 영문 이름이면 주소를 미리 제안
      const row = el('div', 'wslug'); row.append(el('span', 'mute', location.host + '/n/')); i.parentNode.insertBefore(row, i); row.appendChild(i);
      const st = el('p', 'mute wst'); body.appendChild(st);
      const check = () => {
        const v = i.value.trim().toLowerCase(); i.value = v; clearTimeout(slugTimer);
        if (!v) { st.textContent = ''; slugState = { v, ok: false }; return; }
        if (!SLUG_RE.test(v)) { st.textContent = '영문 소문자·숫자·하이픈으로 3~30자여야 해요.'; st.className = 'wst bad'; slugState = { v, ok: false }; return; }
        st.textContent = '확인 중…'; st.className = 'mute wst';
        slugTimer = setTimeout(async () => {
          try { const j = await (await fetch('/app/new/check?slug=' + encodeURIComponent(v))).json(); if (i.value.trim() !== v) return;
            slugState = { v, ok: !!j.ok }; st.textContent = j.ok ? '✓ 사용할 수 있어요' : '이미 사용 중인 주소예요'; st.className = 'wst ' + (j.ok ? 'good' : 'bad'); } catch { st.textContent = ''; slugState = { v, ok: false, unknown: true }; }
        }, 250);
      };
      i.addEventListener('input', check); check();
      return { focus: () => i.focus(), commit: async () => {
        const v = i.value.trim().toLowerCase();
        if (!SLUG_RE.test(v)) return fail('주소는 영문 소문자·숫자·하이픈으로 3~30자여야 해요.');
        if (slugState.v !== v || (!slugState.ok && !slugState.unknown)) { await new Promise((r) => setTimeout(r, 400)); }
        if (slugState.v === v && !slugState.ok && !slugState.unknown) return fail('이미 사용 중인 주소예요. 다른 주소를 입력해 주세요.');
        A.slug = v; return true; } };
    },
    description(body, next) {
      const i = textInput(body, next, 'description', { max: 300, area: true, ph: '예) 매주 월요일, 한 주를 시작하는 짧은 생각을 보내드려요.' });
      return { focus: () => i.focus(), commit: () => { A.description = i.value.trim(); return true; } };
    },
    categories(body, next) {
      const chips = el('div', 'chips'); const sel = new Set(A.categories);
      const free = el('input'); free.placeholder = '직접 입력 (쉼표로 구분)'; free.type = 'text';
      const paint = () => { chips.textContent = ''; [...new Set([...SUGGEST, ...sel])].forEach((c) => { const b = el('button', 'chip' + (sel.has(c) ? ' on' : ''), c); b.type = 'button'; b.onclick = () => { sel.has(c) ? sel.delete(c) : sel.add(c); paint(); }; chips.appendChild(b); }); };
      paint(); body.append(chips, free);
      free.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); free.value.split(/[,#]/).map((x) => x.trim().slice(0, 30)).filter(Boolean).forEach((x) => sel.add(x)); free.value = ''; paint(); } });
      return { commit: (extra) => { free.value.split(/[,#]/).map((x) => x.trim().slice(0, 30)).filter(Boolean).forEach((x) => sel.add(x)); A.categories = [...sel].slice(0, 10); if (!A.categories.length) skipped.categories = true; return true; } };
    },
    logo(body, next, fail) {
      const dz = el('label', 'dropzone'); const f = el('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/gif,image/webp'; f.hidden = true;
      const img = el('img', 'logo'); img.alt = ''; img.hidden = !A.logo; if (A.logo) img.src = A.logo;
      const t = el('span', '', A.logo ? '다른 이미지로 바꾸려면 클릭' : '이미지를 끌어다 놓거나 클릭해서 선택'); dz.append(f, img, t); body.appendChild(dz);
      const up = async (file) => {
        if (!file) return; t.textContent = '올리는 중…'; busy = true;
        try { const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
          const r = await fetch('/app/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) }); const j = await r.json();
          if (!r.ok) throw new Error(j.error || '업로드 실패'); A.logo = j.url; img.src = j.url; img.hidden = false; t.textContent = '다른 이미지로 바꾸려면 클릭'; }
        catch (e) { t.textContent = '이미지를 끌어다 놓거나 클릭해서 선택'; fail(e.message); } finally { busy = false; }
      };
      f.onchange = () => up(f.files[0]);
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('on'); }); dz.addEventListener('dragleave', () => dz.classList.remove('on'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('on'); up(e.dataTransfer.files[0]); });
      return { commit: () => { if (!A.logo) skipped.logo = true; return true; } };
    },
    sns(body) {
      body.innerHTML = $('snsTpl').innerHTML;
      body.querySelectorAll('input[name^=sns_]').forEach((i) => { i.value = A.sns[i.name] || ''; i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); body.nextSibling.querySelector('.primary').click(); } }); });
      return { commit: () => { A.sns = {}; body.querySelectorAll('input[name^=sns_]').forEach((i) => { if (i.value.trim()) A.sns[i.name] = i.value.trim(); }); if (!Object.keys(A.sns).length) skipped.sns = true; return true; } };
    },
    done(body, next) {
      const card = el('div', 'wsum');
      [['이름', A.name], ['주소', location.host + '/n/' + A.slug], ['소개', A.description || '—'], ['주제', A.categories.join(', ') || '—'], ['로고', A.logo ? '등록됨' : '—'], ['SNS', Object.keys(A.sns).length ? Object.keys(A.sns).length + '개' : '—']]
        .forEach(([k, v]) => { const r = el('div'); r.append(el('span', 'mute', k), el('b', '', v)); card.appendChild(r); });
      body.appendChild(card); body.appendChild(el('p', 'mute', '환영 메일과 첫 글 초안이 자동으로 준비돼요. 위의 답변을 눌러 언제든 고칠 수 있어요.'));
      return { commit: () => {
        const f = $('wzform'); f.textContent = '';
        const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); };
        add('name', A.name); add('slug', A.slug); add('description', A.description); add('categories', A.categories.join(',')); add('logo', A.logo);
        Object.entries(A.sns).forEach(([k, v]) => add(k, v));
        next.disabled = true; next.textContent = '만드는 중…'; f.submit(); return true; } };
    },
  };

  render();
})();
