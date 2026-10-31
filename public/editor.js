// 블록 에디터: 블록 ↔ 마크다운 변환, 슬래시 메뉴, 드래그 이동, 자동 저장, 웹/이메일 미리보기
(() => {
  const cfg = JSON.parse(document.getElementById('cfg').textContent);
  const $ = (s, r = document) => r.querySelector(s);
  const form = $('#f'), bodyField = $('#body'), blocksEl = $('#blocks'), rawEl = $('#raw'), stateEl = $('#savestate');
  const subj = form.elements.subject, prev = form.elements.preview;

  // ---------- 타입 정의 ----------
  const TYPES = [
    ['p', '본문', '텍스트'], ['h1', '제목 1', '큰 제목'], ['h2', '제목 2', '중간 제목'], ['h3', '제목 3', '작은 제목'],
    ['ul', '글머리 목록', '- 목록'], ['ol', '번호 목록', '1. 목록'], ['quote', '인용', '인용문'], ['code', '코드', '코드 블록'],
    ['hr', '구분선', '---'], ['img', '이미지', '사진 업로드'], ['paywall', '유료 구간', '여기부터 유료 구독자 전용'],
  ];
  const PH = { p: "텍스트를 입력하거나 '/' 로 블록을 고르세요", h1: '제목 1', h2: '제목 2', h3: '제목 3', ul: '목록 항목', ol: '목록 항목', quote: '인용', code: '코드' };
  const ALIGNABLE = new Set(['p', 'h1', 'h2', 'h3', 'img']);
  const TEXT = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'quote', 'code']);
  let uid = 0;
  const mk = (type, text = '', extra = {}) => ({ id: ++uid, type, text, url: '', alt: '', ...extra });

  // ---------- 마크다운 → 블록 ----------
  const START = /^(```|#{1,3}\s|[-*]\s+|\d+\.\s+|>|---+\s*$|!\[[^\]]*\]\([^)]+\)\s*$|\[\[paywall\]\]\s*$)/;
  function parse(md) {
    const L = String(md || '').replace(/\r/g, '').split('\n'), out = [];
    let i = 0;
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if (/^```/.test(l)) { const buf = []; i++; while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); out.push(mk('code', buf.join('\n'))); i++; continue; }
      if (l.trim() === '[[paywall]]') { out.push(mk('paywall')); i++; continue; }
      if (/^---+\s*$/.test(l)) { out.push(mk('hr')); i++; continue; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { out.push(mk('h' + m[1].length, m[2])); i++; continue; }
      if ((m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/.exec(l))) { const t = m[3] || '', w = /w=(\d{1,3})/.exec(t); out.push(mk('img', '', { alt: m[1], url: m[2], w: w ? +w[1] : 0, align: /(^|;)c=1/.test(t) ? 'center' : '' })); i++; continue; }
      const group = (re, type, strip) => { const buf = []; while (i < L.length && re.test(L[i])) buf.push(L[i++].replace(strip, '')); out.push(mk(type, buf.join('\n'))); };
      // 목록은 항목마다 블록 하나 (노션처럼)
      if (/^[-*]\s+/.test(l)) { while (i < L.length && /^[-*]\s+/.test(L[i])) out.push(mk('ul', L[i++].replace(/^[-*]\s+/, ''))); continue; }
      if (/^\d+\.\s+/.test(l)) { while (i < L.length && /^\d+\.\s+/.test(L[i])) out.push(mk('ol', L[i++].replace(/^\d+\.\s+/, ''))); continue; }
      if (/^>/.test(l)) { group(/^>/, 'quote', /^>\s?/); continue; }
      const buf = [];
      while (i < L.length && L[i].trim() && (buf.length === 0 || !START.test(L[i]))) buf.push(L[i++]);
      out.push(mk('p', buf.join('\n')));
    }
    for (const b of out) if (['p', 'h1', 'h2', 'h3'].includes(b.type) && /^::center /.test(b.text)) { b.text = b.text.replace(/^::center /, ''); b.align = 'center'; }
    return out.length ? out : [mk('p')];
  }

  // ---------- 블록 → 마크다운 ----------
  const lines = (t) => t.split('\n').map((s) => s.trimEnd()).filter((s) => s.trim());
  function serialize(bs) {
    let out = '', prev = null, n = 0;
    for (const b of bs) {
      const one = b.text.replace(/\s*\n+\s*/g, ' ').trim();
      let s = '';
      switch (b.type) {
        case 'h1': case 'h2': case 'h3': s = one ? '#'.repeat(+b.type[1]) + ' ' + (b.align ? '::center ' : '') + one : ''; break;
        case 'ul': s = one ? '- ' + one : ''; break;
        case 'ol': s = one ? `${prev === 'ol' ? ++n : (n = 1)}. ${one}` : ''; break;
        case 'quote': s = lines(b.text).map((x) => '> ' + x).join('\n'); break;
        case 'code': s = b.text.trim() ? '```\n' + b.text.replace(/\n+$/, '') + '\n```' : ''; break;
        case 'hr': s = '---'; break;
        case 'paywall': s = '[[paywall]]'; break;
        case 'img': { const t = [b.w && b.w < 100 ? 'w=' + b.w : '', b.align ? 'c=1' : ''].filter(Boolean).join(';'); s = b.url ? `![${b.alt.replace(/[\[\]]/g, '')}](${b.url}${t ? ` "${t}"` : ''})` : ''; break; }
        default: s = b.text.replace(/\s+$/, ''); if (s && b.type === 'p' && b.align) s = '::center ' + s;
      }
      if (!s) continue;
      out += (out ? (prev === b.type && (b.type === 'ul' || b.type === 'ol') ? '\n' : '\n\n') : '') + s; // 같은 목록의 항목끼리는 붙여 쓴다
      prev = b.type;
    }
    return out;
  }

  let blocks = parse(cfg.body_md);
  let lastFocus = subj;
  let rawMode = false;

  // ---------- 렌더 ----------
  const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  const idx = (id) => blocks.findIndex((b) => b.id === id);
  function focusBlock(id, atEnd = true) {
    const ta = $(`.blk[data-id="${id}"] textarea`);
    if (ta) { ta.focus(); const p = atEnd ? ta.value.length : 0; ta.setSelectionRange(p, p); }
  }

  function render(focusId) {
    blocksEl.innerHTML = '';
    let n = 0, prevType = null;
    for (const b of blocks) {
      const el = blockEl(b);
      if (b.type === 'ol') { n = prevType === 'ol' ? n + 1 : 1; $('.bbody', el).dataset.n = n; }
      prevType = b.type;
      blocksEl.appendChild(el);
    }
    if (focusId) focusBlock(focusId);
  }

  function blockEl(b) {
    const el = document.createElement('div');
    el.className = 'blk t-' + b.type;
    el.dataset.id = b.id;
    el.innerHTML = '<div class="gut"><button type="button" class="g-add" title="아래에 블록 추가">+</button><button type="button" class="g-handle" title="드래그로 이동 · 클릭: 메뉴">⋮⋮</button></div><div class="bbody"></div>';
    const body = $('.bbody', el);
    if (TEXT.has(b.type)) {
      const ta = document.createElement('textarea');
      ta.rows = 1; ta.value = b.text; if (b.align) ta.style.textAlign = 'center'; ta.placeholder = PH[b.type]; ta.spellcheck = false;
      ta.addEventListener('input', () => onInput(b, ta));
      ta.addEventListener('keydown', (e) => onKey(e, b, ta));
      ta.addEventListener('focus', () => { lastFocus = ta; });
      body.appendChild(ta);
      requestAnimationFrame(() => fit(ta));
    } else if (b.type === 'hr') body.innerHTML = '<hr>';
    else if (b.type === 'paywall') body.innerHTML = '<div class="pw">여기부터 유료 구독자 전용</div>';
    else if (b.type === 'img') {
      // 업로드 전에만 주소 입력칸을 보여주고, 업로드 후에는 이미지 + 크기 조절 핸들만 남긴다
      body.innerHTML = b.url
        ? `<div class="imgwrap" style="width:${b.w || 100}%${b.align ? ';margin:0 auto' : ''}"><img src="${esc(b.url)}" alt="${esc(b.alt)}" draggable="false"><span class="irz" title="드래그해서 크기 조절"></span><span class="iw"></span></div>
          <div class="imgctl imgctl-s"><input class="ialt" placeholder="대체 텍스트(설명)" value="${esc(b.alt)}"><button type="button" class="sm iup">이미지 교체</button><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div>`
        : `<div class="imgctl"><input class="iurl" placeholder="이미지 주소 (https://…) 또는 업로드" value=""><button type="button" class="sm iup">업로드</button><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden></div>`;
      const url = $('.iurl', body), alt = $('.ialt', body), file = $('input[type=file]', body);
      if (url) url.onchange = () => { b.url = /^(https?:\/\/|\/uploads\/)/.test(url.value.trim()) ? url.value.trim() : ''; changed(); render(); ensureTextAfter(b.id); };
      if (alt) alt.oninput = () => { b.alt = alt.value; changed(); };
      const wrap = $('.imgwrap', body);
      if (wrap) $('.irz', body).addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const full = body.clientWidth, label = $('.iw', body); wrap.classList.add('rz');
        const mv = (ev) => { const r = wrap.getBoundingClientRect(); b.w = Math.max(10, Math.min(100, Math.round((b.align ? ((ev.clientX - (r.left + r.width / 2)) * 2) / full : (ev.clientX - r.left) / full) * 100))); wrap.style.width = b.w + '%'; label.textContent = b.w + '%'; };
        const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); wrap.classList.remove('rz'); changed(); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
      $('.iup', body).onclick = () => file.click();
      file.onchange = async () => { if (file.files[0]) await uploadInto(b, file.files[0]); };
    }
    $('.g-add', el).onclick = (e) => openMenu(e.currentTarget, '', (key) => insertAfter(b.id, key));
    const handle = $('.g-handle', el);
    handle.onclick = (e) => openMenu(e.currentTarget, '', (key) => (key === '_del' ? remove(b.id) : key === '_align' ? toggleAlign(b.id) : key === '_up' ? move(b.id, -1) : key === '_down' ? move(b.id, 1) : key === '_dup' ? dup(b.id) : retype(b.id, key)), b);
    handle.addEventListener('mousedown', () => { el.draggable = true; });
    el.addEventListener('dragend', () => { el.draggable = false; clearDrop(); });
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(b.id)); el.classList.add('dragging'); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); clearDrop(); el.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const above = el.classList.contains('drop-above'); clearDrop();
      const from = idx(+e.dataTransfer.getData('text/plain')); if (from < 0 || b.id === +e.dataTransfer.getData('text/plain')) return;
      const [mv] = blocks.splice(from, 1); let to = idx(b.id); if (!above) to++; blocks.splice(to, 0, mv); changed(); render();
    });
    return el;
  }
  const clearDrop = () => document.querySelectorAll('.drop-above,.drop-below,.dragging').forEach((e) => e.classList.remove('drop-above', 'drop-below', 'dragging'));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 블록 조작 ----------
  function insertAfter(id, type) {
    const nb = mk(type);
    blocks.splice(idx(id) + 1, 0, nb);
    if (['hr', 'paywall'].includes(type)) { const after = mk('p'); blocks.splice(idx(nb.id) + 1, 0, after); changed(); render(after.id); return; }
    changed(); render(nb.id);
    if (type === 'img') setTimeout(() => $(`.blk[data-id="${nb.id}"] .iup`)?.click(), 0);
  }
  function retype(id, type) {
    const b = blocks[idx(id)]; if (!b) return;
    if (!ALIGNABLE.has(type)) b.align = '';
    const keep = TEXT.has(b.type) && TEXT.has(type) ? b.text : '';
    Object.assign(b, { type, text: keep });
    if (['hr', 'paywall'].includes(type) && blocks[idx(id) + 1]?.type !== 'p') blocks.splice(idx(id) + 1, 0, mk('p'));
    changed(); render(TEXT.has(type) ? id : null);
    if (type === 'img') setTimeout(() => $(`.blk[data-id="${id}"] .iup`)?.click(), 0);
  }
  function toggleAlign(id) { const b = blocks[idx(id)]; if (!b) return; b.align = b.align ? '' : 'center'; changed(); render(TEXT.has(b.type) ? id : null); }
  function remove(id) { const i = idx(id); blocks.splice(i, 1); if (!blocks.length) blocks.push(mk('p')); changed(); render((blocks[Math.max(0, i - 1)] || blocks[0]).id); }
  function move(id, d) { const i = idx(id), j = i + d; if (j < 0 || j >= blocks.length) return; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; changed(); render(TEXT.has(blocks[j].type) ? id : null); }
  function dup(id) { const i = idx(id), c = { ...blocks[i], id: ++uid }; blocks.splice(i + 1, 0, c); changed(); render(c.id); }

  // ---------- 입력 · 키보드 ----------
  function onInput(b, ta) {
    fit(ta);
    // 마크다운 단축 입력 (본문 블록에서만)
    if (b.type === 'p') {
      const v = ta.value;
      const sc = { '# ': 'h1', '## ': 'h2', '### ': 'h3', '- ': 'ul', '* ': 'ul', '1. ': 'ol', '> ': 'quote', '```': 'code' }[v];
      if (sc) { b.type = sc; b.text = ''; changed(); render(b.id); return; }
      if (v === '---') { b.type = 'hr'; b.text = ''; const after = mk('p'); blocks.splice(idx(b.id) + 1, 0, after); changed(); render(after.id); return; }
    }
    b.text = ta.value;
    if (ta.value.startsWith('/') && !ta.value.includes('\n') && b.type !== 'code') openMenu(ta, ta.value.slice(1), (key) => { b.text = ''; ta.value = ''; applySlash(b.id, key); }, false, true);
    else closeMenu();
    changed();
  }
  const applySlash = (id, key) => { const b = blocks[idx(id)]; b.text = ''; retype(id, key); };

  function onKey(e, b, ta) {
    if (menu && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) { menuKey(e); return; }
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && b.type !== 'code') {
      e.preventDefault();
      if ((b.type === 'ul' || b.type === 'ol') && !v.trim()) { b.type = 'p'; changed(); render(b.id); return; } // 빈 항목에서 Enter → 목록 끝내기
      const head = v.slice(0, s), tail = v.slice(en);
      b.text = head;
      const nb = mk(['quote', 'ul', 'ol'].includes(b.type) ? b.type : 'p', tail); // 목록·인용은 같은 종류로 이어서
      blocks.splice(idx(b.id) + 1, 0, nb); changed(); render(nb.id); focusBlock(nb.id, false);
    } else if (e.key === 'Backspace' && s === 0 && en === 0 && !e.isComposing) {
      if (b.type !== 'p') { e.preventDefault(); b.type = 'p'; changed(); render(b.id); focusBlock(b.id, false); }
      else if (v === '' && blocks.length > 1) { e.preventDefault(); remove(b.id); }
    } else if (e.key === 'ArrowUp' && s === 0 && en === 0) {
      const p = blocks[idx(b.id) - 1]; if (p && TEXT.has(p.type)) { e.preventDefault(); focusBlock(p.id); }
    } else if (e.key === 'ArrowDown' && s === v.length && en === v.length) {
      const n = blocks[idx(b.id) + 1]; if (n && TEXT.has(n.type)) { e.preventDefault(); focusBlock(n.id, false); }
    }
  }

  // ---------- 메뉴 (슬래시 · + · 핸들) ----------
  let menu = null, menuItems = [], menuSel = 0, menuPick = null;
  function openMenu(anchor, filter, pick, extra = false, slash = false) {
    closeMenu();
    const f = filter.toLowerCase();
    menuItems = TYPES.filter(([k, l, d]) => !f || l.includes(f) || k.includes(f) || d.includes(f)).map(([k, l, d]) => ({ key: k, label: l, desc: d }));
    if (extra) menuItems.push(...(ALIGNABLE.has(extra.type) ? [{ key: '_align', label: extra.align ? '왼쪽 정렬' : '가운데 정렬', desc: '' }] : []), { key: '_up', label: '위로 이동', desc: '' }, { key: '_down', label: '아래로 이동', desc: '' }, { key: '_dup', label: '복제', desc: '' }, { key: '_del', label: '삭제', desc: '' });
    if (!menuItems.length) return;
    menuPick = pick; menuSel = 0;
    menu = document.createElement('div'); menu.className = 'bmenu';
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left + window.scrollX, window.innerWidth - 240) + 'px'; menu.style.top = (r.bottom + window.scrollY + 4) + 'px';
    paintMenu();
  }
  function paintMenu() {
    menu.innerHTML = menuItems.map((it, i) => `<button type="button" class="${i === menuSel ? 'on' : ''}${it.key[0] === '_' ? ' x' : ''}" data-i="${i}"><b>${esc(it.label)}</b><span>${esc(it.desc)}</span></button>`).join('');
    menu.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); const it = menuItems[+b.dataset.i]; closeMenu(); menuPick(it.key); }));
  }
  function menuKey(e) {
    e.preventDefault();
    if (e.key === 'Escape') return closeMenu();
    if (e.key === 'ArrowDown') menuSel = (menuSel + 1) % menuItems.length;
    else if (e.key === 'ArrowUp') menuSel = (menuSel - 1 + menuItems.length) % menuItems.length;
    else { const it = menuItems[menuSel]; closeMenu(); return menuPick(it.key); }
    paintMenu();
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });

  // ---------- 이미지 업로드 (버튼 · 붙여넣기 · 드롭) ----------
  async function uploadFile(file) {
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
    const r = await fetch('/app/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || '업로드 실패'); return j.url;
  }
  // 이미지 아래에 항상 글을 이어 쓸 수 있도록 빈 본문 블록을 보장한다
  function ensureTextAfter(id) {
    const i = idx(id); if (i < 0 || (blocks[i + 1] && TEXT.has(blocks[i + 1].type))) return;
    const p = mk('p'); blocks.splice(i + 1, 0, p); changed(); render(p.id);
  }
  async function uploadInto(b, file) {
    try { setState('이미지 업로드 중…'); b.url = await uploadFile(file); b.w = 0; changed(); render(); ensureTextAfter(b.id); }
    catch (e) { setState(e.message); }
  }
  async function addImageAfterFocus(file) {
    const cur = lastFocus?.closest?.('.blk'); const afterId = cur ? +cur.dataset.id : blocks[blocks.length - 1].id;
    const nb = mk('img'); blocks.splice(idx(afterId) + 1, 0, nb); render(); await uploadInto(nb, file);
  }
  blocksEl.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); addImageAfterFocus(f); } });
  blocksEl.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); addImageAfterFocus(f); } });

  // ---------- 도구 막대 ----------
  const wrapSel = (open, close, ph) => {
    const t = lastFocus; if (!t || t.closest?.('.t-code')) return;
    const s = t.selectionStart, e = t.selectionEnd, v = t.value, sel = v.slice(s, e) || ph;
    const isLink = open === '[';
    // 이미 같은 서식이면 다시 눌렀을 때 해제 (굵게를 두 번 눌러 ****글**** 이 되는 것 방지)
    if (!isLink && e > s) {
      if (v.slice(Math.max(0, s - open.length), s) === open && v.slice(e, e + close.length) === close) { t.setRangeText(sel, s - open.length, e + close.length, 'select'); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); return; }
      if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) { t.setRangeText(sel.slice(open.length, sel.length - close.length), s, e, 'select'); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); return; }
    }
    t.setRangeText(open + sel + close, s, e, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus();
  };
  const format = (k) => {
    if (k === 'b') wrapSel('**', '**', '굵게'); else if (k === 'i') wrapSel('_', '_', '기울임'); else if (k === 'c') wrapSel('`', '`', '코드');
    else { const u = prompt('링크 주소 (https://…)'); if (u && /^https?:\/\//.test(u)) wrapSel('[', `](${u})`, '링크 텍스트'); }
  };

  // 글자를 드래그하면 뜨는 서식 도구 (노션의 선택 툴바)
  const fbar = document.createElement('div'); fbar.className = 'fbar'; fbar.hidden = true;
  fbar.innerHTML = '<button type="button" data-f="b"><b>B</b></button><button type="button" data-f="i"><i>I</i></button><button type="button" data-f="c">&lt;/&gt;</button><button type="button" data-f="a">링크</button>';
  document.body.appendChild(fbar);
  fbar.addEventListener('mousedown', (e) => { e.preventDefault(); const k = e.target.closest('button')?.dataset.f; if (k) { fbar.hidden = true; format(k); } });
  function showFbar(ta) {
    if (!ta || ta.selectionStart === ta.selectionEnd || ta.closest('.t-code') || !ta.closest('#blocks')) { fbar.hidden = true; return; }
    const r = ta.closest('.blk').getBoundingClientRect();
    fbar.hidden = false;
    fbar.style.left = Math.max(8, r.left + window.scrollX + 30) + 'px';
    fbar.style.top = (r.top + window.scrollY - fbar.offsetHeight - 6) + 'px';
  }
  document.addEventListener('mouseup', () => setTimeout(() => showFbar(document.activeElement), 0));
  document.addEventListener('keyup', (e) => { if (e.shiftKey || e.key.startsWith('Arrow')) showFbar(document.activeElement); else if (fbar.hidden === false && document.activeElement.selectionStart === document.activeElement.selectionEnd) fbar.hidden = true; });
  document.addEventListener('mousedown', (e) => { if (!fbar.contains(e.target)) fbar.hidden = true; });
  // 글칸을 벗어나거나 스크롤하거나 Esc 를 누르면 서식 도구를 숨긴다
  blocksEl.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.closest?.('#blocks')) fbar.hidden = true; }, 0));
  blocksEl.addEventListener('scroll', () => { fbar.hidden = true; });
  window.addEventListener('scroll', () => { fbar.hidden = true; }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fbar.hidden = true; });
  document.addEventListener('input', () => { fbar.hidden = true; });
  document.addEventListener('paste', () => { fbar.hidden = true; });
  // 단축키: Ctrl/Cmd + B · I · K
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !document.activeElement?.closest?.('#blocks')) return;
    const k = { b: 'b', i: 'i', k: 'a' }[e.key.toLowerCase()]; if (!k) return;
    e.preventDefault(); lastFocus = document.activeElement; format(k);
  });

  // 여러 줄 마크다운을 붙여넣으면 블록으로 나눠 넣는다
  blocksEl.addEventListener('paste', (e) => {
    const ta = e.target; const t = e.clipboardData?.getData('text/plain') || '';
    if (ta.tagName !== 'TEXTAREA' || ta.closest('.t-code') || !/\n/.test(t.trim()) || [...(e.clipboardData?.files || [])].length) return;
    e.preventDefault();
    const b = blocks[idx(+ta.closest('.blk').dataset.id)]; if (!b) return;
    const head = ta.value.slice(0, ta.selectionStart), tail = ta.value.slice(ta.selectionEnd);
    const parsed = parse(t);
    if (head.trim()) { parsed[0].type === 'p' ? (b.text = head + parsed.shift().text) : (b.text = head); }
    else if (!tail.trim() && b.type === 'p') { blocks.splice(idx(b.id), 1, ...parsed); changed(); render(parsed[parsed.length - 1].id); return; }
    if (tail.trim()) parsed.push(mk('p', tail));
    blocks.splice(idx(b.id) + 1, 0, ...parsed); changed(); render((parsed[parsed.length - 1] || b).id);
  });

  // 제목에서 Enter/↓ → 본문 첫 블록, 본문 아래 빈 영역 클릭 → 끝에 이어 쓰기
  subj.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); prev.focus(); } });
  prev.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); focusBlock(blocks[0].id, false); } });
  blocksEl.addEventListener('click', (e) => {
    if (e.target !== blocksEl) return;
    const last = blocks[blocks.length - 1];
    if (TEXT.has(last.type) && last.type === 'p' && !last.text) return focusBlock(last.id);
    const nb = mk('p'); blocks.push(nb); changed(); render(nb.id);
  });
  $('#merge').onchange = (e) => {
    const v = e.target.value; e.target.value = ''; if (!v) return;
    const t = lastFocus || subj; const s = t.selectionStart ?? t.value.length;
    t.setRangeText(v, s, t.selectionEnd ?? s, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); t.focus();
  };
  $('#rawtoggle').onclick = (e) => {
    rawMode = !rawMode;
    if (rawMode) { rawEl.value = serialize(blocks); rawEl.hidden = false; blocksEl.hidden = true; fit(rawEl); e.target.textContent = '블록 편집'; }
    else { blocks = parse(rawEl.value); rawEl.hidden = true; blocksEl.hidden = false; render(); e.target.textContent = '마크다운'; changed(); }
  };
  rawEl.addEventListener('input', () => { fit(rawEl); changed(); });

  // ---------- 템플릿 ----------
  $('#tplsel').onchange = (e) => {
    const t = cfg.templates.find((x) => x.id === +e.target.value); e.target.value = ''; if (!t) return;
    if (current().body_md.trim() && !confirm('현재 본문을 템플릿 내용으로 바꿀까요? (버전 기록에 남습니다)')) return;
    if (!subj.value) subj.value = t.subject; if (!prev.value) prev.value = t.preview;
    blocks = parse(t.body_md); rawMode = false; rawEl.hidden = true; blocksEl.hidden = false; render(); changed(true);
  };
  $('#savetpl').onclick = async () => {
    const name = prompt('템플릿 이름', subj.value || ''); if (!name) return;
    const c = current();
    const r = await fetch(`/app/n/${cfg.nid}/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...c, category: form.elements.category.value, tags: form.elements.tags.value }) });
    const j = await r.json();
    if (!r.ok) return setState(j.error || '저장 실패');
    cfg.templates.push(j); const o = new Option(j.name, j.id); $('#tplsel').add(o); setState(`템플릿 "${j.name}" 저장됨`);
  };

  // ---------- 현재 내용 · 변경 추적 ----------
  const current = () => ({ subject: subj.value, preview: prev.value, body_md: rawMode ? rawEl.value : serialize(blocks) });
  const payload = () => ({ ...current(), category: form.elements.category.value, tags: form.elements.tags.value, audience: form.elements.audience.value });
  let dirty = false, saveTimer = 0, pvTimer = 0, stopped = false, saving = false;
  const setState = (t) => { stateEl.textContent = t; };
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  function changed(force) {
    bodyField.value = current().body_md;
    dirty = true;
    clearTimeout(pvTimer); if (!pvcol.hidden) pvTimer = setTimeout(updatePreview, 350);
    if (cfg.status === 'draft' && !stopped) { setState('저장 대기 중…'); clearTimeout(saveTimer); saveTimer = setTimeout(autosave, force ? 200 : 2000); }
  }
  async function autosave(keepalive = false) {
    if (!dirty || stopped || cfg.status !== 'draft' || saving) return;
    saving = true; dirty = false;
    try {
      const r = await fetch(`/app/n/${cfg.nid}/posts/${cfg.id}/autosave`, { method: 'POST', keepalive, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload(), rev: cfg.rev }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { cfg.rev = j.rev; setState(`자동 저장됨 ${hhmm(j.at)}`); }
      else if (j.conflict) { stopped = true; setState(j.error); }
      else { dirty = true; setState(j.error || '자동 저장 실패 — 다시 시도합니다'); }
    } catch { dirty = true; setState('자동 저장 실패 (네트워크) — 다시 시도합니다'); }
    saving = false;
    if (dirty && !stopped) saveTimer = setTimeout(autosave, 4000);
  }
  for (const el of [subj, prev, form.elements.category, form.elements.tags, form.elements.audience]) {
    el.addEventListener('input', () => changed()); el.addEventListener('change', () => changed());
    if (el === subj || el === prev) el.addEventListener('focus', () => { lastFocus = el; });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) autosave(true); });
  window.addEventListener('beforeunload', (e) => { if (dirty && !stopped && cfg.status === 'draft') { e.preventDefault(); e.returnValue = ''; } });

  // ---------- 미리보기 ----------
  let pvMode = 'web', pvDev = 'd';
  const pv = $('#pv'), inbox = $('#inbox'), wrap = $('#pvwrap'), pvcol = $('#pvcol');
  const setPv = (open) => { pvcol.hidden = !open; if (open) updatePreview(); };
  $('#pvopen').onclick = () => setPv(true);
  $('#pvclose').onclick = () => setPv(false);
  pvcol.onclick = (e) => { if (e.target === pvcol) setPv(false); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pvcol.hidden) setPv(false); });
  const merge = (t) => String(t).replace(/\{\{\s*(name|nickname|email)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/gi, (_, k, fb) => (k.toLowerCase() === 'email' ? cfg.sample.email : cfg.sample.name) || fb || (k.toLowerCase() === 'email' ? '' : '독자'));
  async function updatePreview() {
    const c = payload();
    inbox.hidden = pvMode !== 'email';
    if (pvMode === 'email') inbox.innerHTML = `<b>${esc(cfg.from)}</b><div>${esc(merge(c.subject) || '(제목 없음)')}</div><span>${esc(merge(c.preview))}</span>`;
    try {
      const r = await fetch(`/app/n/${cfg.nid}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...c, mode: pvMode, sample_name: cfg.sample.name, sample_email: cfg.sample.email }) });
      pv.srcdoc = await r.text();
    } catch { /* 일시적 실패는 무시 */ }
  }
  $('#pvmode').onclick = (e) => { const m = e.target.dataset.m; if (!m) return; pvMode = m; [...e.currentTarget.children].forEach((b) => b.classList.toggle('on', b === e.target)); updatePreview(); };
  $('#pvdev').onclick = (e) => { const d = e.target.dataset.d; if (!d) return; pvDev = d; [...e.currentTarget.children].forEach((b) => b.classList.toggle('on', b === e.target)); wrap.classList.toggle('mobile', d === 'm'); };

  // ---------- 예약 시각 ----------
  const sched = $('#sched'), tz = $('#tz');
  tz.value = String(new Date().getTimezoneOffset());
  $('#tzname').textContent = '(' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
  const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  if (cfg.scheduled_at) sched.value = toLocalInput(new Date(cfg.scheduled_at));
  document.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
    const d = new Date();
    if (b.dataset.q === 'tomorrow9') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); } else d.setTime(d.getTime() + 3600e3);
    sched.value = toLocalInput(d);
  });

  // ---------- 제출 ----------
  form.addEventListener('submit', () => { bodyField.value = current().body_md; tz.value = String(new Date().getTimezoneOffset()); dirty = false; clearTimeout(saveTimer); });

  render();
  bodyField.value = current().body_md;
  dirty = false;
})();
