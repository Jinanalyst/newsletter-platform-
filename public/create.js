// 크리에이트 편집 화면: 정보 입력, 영상·파일 직접 업로드(진행률), 가격 설정, 저장·게시
(() => {
  const $ = (id) => document.getElementById(id);
  const D = JSON.parse($('cdata').textContent);
  const won = (n) => '₩' + Number(n || 0).toLocaleString('ko-KR');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = (n) => (n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + ' GB' : n >= 2 ** 20 ? Math.round(n / 2 ** 20) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  // 상태: items 는 { key, id?, title, kind, file, file_name, size, up: {pct}|null, error }
  let uid = 0, dirty = false, saving = false;
  const S = { kind: D.kind, pricing: D.pricing, price: D.price, status: D.status, thumbnail: D.thumbnail,
    items: D.items.map((i) => ({ ...i, key: ++uid, up: null, error: '' })) };

  $('title').value = D.title; $('summary').value = D.summary; $('description').value = D.description;
  $('price').value = S.price ? S.price.toLocaleString('ko-KR') : '';

  const touch = () => { dirty = true; $('saveState').textContent = '저장되지 않은 변경 사항이 있어요'; paint(); };
  const uploading = () => S.items.some((i) => i.up);

  // ---------- 그리기 ----------
  function paint() {
    const isCourse = S.kind === 'course';
    document.querySelectorAll('#kindSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === S.kind));
    $('itemsTitle').textContent = isCourse ? '커리큘럼' : '판매할 자료';
    $('dropMain').textContent = isCourse ? '영상을 끌어다 놓거나 클릭해서 선택' : '파일을 끌어다 놓거나 클릭해서 선택';
    $('dropSub').textContent = isCourse ? 'MP4 · MOV · WEBM, 파일당 최대 2GB · 여러 개 한 번에 가능' : 'PDF · ZIP · XLSX · PPTX · DOCX 등, 파일당 최대 300MB (영상도 가능)';
    $('fileInput').accept = isCourse ? 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm' : '.' + Object.keys(D.types).join(',.');
    const total = S.items.reduce((a, i) => a + (i.size || 0), 0);
    $('itemsSum').textContent = S.items.length ? `${S.items.length}개 · ${bytes(total)}` : '';

    $('items').innerHTML = S.items.map((it, n) => {
      const meta = it.error ? `<span class="meta bad">${esc(it.error)} <a href="#" data-a="retry" data-k="${it.key}">다시 시도</a></span>`
        : it.up ? `<span class="meta">업로드 중 ${it.up.pct}%</span><div class="bar"><i style="width:${it.up.pct}%"></i></div>`
        : it.file ? `<span class="meta">${it.kind === 'video' ? '🎬' : '📄'} ${esc(it.file_name)} · ${bytes(it.size)}${it.id ? ` · <a href="/create/${D.id}/media/${it.id}" target="_blank">열어 보기</a>` : ''}</span>` : '';
      return `<div class="iedit" data-k="${it.key}"><span class="cn">${n + 1}</span>
<div class="imain" style="display:flex;flex-direction:column;flex-wrap:wrap"><input data-a="title" data-k="${it.key}" value="${esc(it.title)}" maxlength="100" placeholder="${isCourse ? '강의 제목' : '자료 이름'}">${meta}</div>
<button type="button" class="ibtn" data-a="up" data-k="${it.key}" ${n ? '' : 'disabled'} title="위로">↑</button>
<button type="button" class="ibtn" data-a="down" data-k="${it.key}" ${n < S.items.length - 1 ? '' : 'disabled'} title="아래로">↓</button>
<button type="button" class="ibtn" data-a="del" data-k="${it.key}" title="삭제">✕</button></div>`;
    }).join('');

    for (const b of document.querySelectorAll('#payGrid .paybtn')) b.classList.toggle('on', b.dataset.p === S.pricing);
    const paid = S.pricing !== 'free';
    $('priceBox').hidden = !paid;
    $('priceLabel').textContent = S.pricing === 'monthly' ? '월 구독료' : '판매 가격';
    $('priceUnit').textContent = S.pricing === 'monthly' ? '/ 월' : '';
    $('quick').innerHTML = [9900, 19000, 29000, 49000, 99000].map((p) => `<button type="button" class="chip" data-a="quick" data-v="${p}">${won(p)}</button>`).join('');
    const net = Math.floor(S.price * (100 - D.fee) / 100);
    $('payout').textContent = S.price >= D.limits.min ? `플랫폼 수수료 ${D.fee}% 제외 시 ${won(net)}${S.pricing === 'monthly' ? ' / 월' : ''}을 정산받아요. (${won(D.limits.min)} 이상)` : `${won(D.limits.min)} 이상으로 설정할 수 있어요.`;

    const title = $('title').value.trim();
    $('sideTitle').textContent = title || '제목을 입력해 주세요';
    $('sidePrice').textContent = !paid ? '무료' : S.price ? (S.pricing === 'monthly' ? `${won(S.price)} / 월` : `${won(S.price)} · 1회 결제`) : '가격 미설정';
    const th = $('sideThumb'); th.style.backgroundImage = S.thumbnail ? `url('${S.thumbnail}')` : ''; th.textContent = S.thumbnail ? '' : '▶';
    const tp = $('thumbPrev'); tp.style.backgroundImage = S.thumbnail ? `url('${S.thumbnail}')` : ''; tp.innerHTML = S.thumbnail ? '' : '<span>이미지를 끌어다 놓거나 클릭해서 선택 (16:9 권장)</span>';

    const ready = S.items.length > 0 && S.items.every((i) => i.file && !i.up);
    const checks = [[!!title, '제목 입력'], [ready, S.items.some((i) => i.up) ? '업로드 진행 중…' : '영상·파일 업로드'], [!paid || S.price >= D.limits.min, '가격 설정']];
    $('checks').innerHTML = checks.map(([ok, l]) => `<li class="${ok ? 'done' : ''}"><span class="dot"></span>${l}</li>`).join('');
    const live = S.status === 'published';
    $('stBadge').className = 'badge' + (live ? ' active' : ''); $('stBadge').textContent = live ? '판매 중' : '작성 중';
    $('publish').textContent = live ? '변경 사항 게시' : '게시하기';
    $('publish').disabled = saving || uploading();
    $('save').disabled = saving; $('unpublish').hidden = !live; $('unpublish').disabled = saving;
  }

  // ---------- 입력 ----------
  for (const id of ['title', 'summary', 'description']) $(id).addEventListener('input', touch);
  $('kindSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.kind = b.dataset.k; touch(); } };
  $('payGrid').onclick = (e) => { const b = e.target.closest('.paybtn'); if (b) { S.pricing = b.dataset.p; if (S.pricing !== 'free' && !S.price) { S.price = 0; } touch(); } };
  $('price').addEventListener('input', (e) => { S.price = Number(e.target.value.replace(/\D/g, '')) || 0; e.target.value = S.price ? S.price.toLocaleString('ko-KR') : ''; touch(); });
  $('quick').onclick = (e) => { const b = e.target.closest('[data-a=quick]'); if (b) { S.price = Number(b.dataset.v); $('price').value = S.price.toLocaleString('ko-KR'); touch(); } };

  // 목록 조작 (위임)
  $('items').addEventListener('input', (e) => { const it = S.items.find((i) => i.key == e.target.dataset.k); if (it && e.target.dataset.a === 'title') { it.title = e.target.value; dirty = true; $('saveState').textContent = '저장되지 않은 변경 사항이 있어요'; } });
  $('items').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT') return;
    const i = S.items.findIndex((x) => x.key == b.dataset.k), it = S.items[i]; if (!it) return;
    if (b.dataset.a === 'retry') { e.preventDefault(); startUpload(it); return; }
    if (b.dataset.a === 'del') { if (it.up) it.up.xhr?.abort(); S.items.splice(i, 1); }
    else if (b.dataset.a === 'up' && i > 0) [S.items[i - 1], S.items[i]] = [S.items[i], S.items[i - 1]];
    else if (b.dataset.a === 'down' && i < S.items.length - 1) [S.items[i + 1], S.items[i]] = [S.items[i], S.items[i + 1]];
    touch();
  });

  // ---------- 파일 올리기 ----------
  const drop = $('drop');
  $('fileInput').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); });
  drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

  const queue = []; let active = 0; const PARALLEL = 2;
  function addFiles(files) {
    for (const f of files) {
      const it = { key: ++uid, title: f.name.replace(/\.[^.]+$/, ''), kind: 'video', file: '', file_name: f.name, size: f.size, up: { pct: 0 }, error: '', blob: f };
      S.items.push(it); queue.push(it);
    }
    touch(); pump();
  }
  function startUpload(it) { it.error = ''; it.up = { pct: 0 }; queue.push(it); paint(); pump(); }
  function pump() { while (active < PARALLEL && queue.length) { const it = queue.shift(); if (S.items.includes(it)) { active++; send(it).finally(() => { active--; pump(); }); } } }

  async function send(it) {
    const fail = (m) => { it.up = null; it.error = m; paint(); };
    try {
      const r = await fetch('/create/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: it.file_name, size: it.size }) });
      const j = await r.json(); if (!r.ok) return fail(j.error || '업로드를 시작하지 못했어요');
      await new Promise((ok, no) => {
        const xhr = new XMLHttpRequest(); it.up.xhr = xhr;
        xhr.open('PUT', j.url);
        for (const [k, v] of Object.entries(j.headers || {})) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { it.up.pct = Math.round(e.loaded / e.total * 100); const bar = document.querySelector(`.iedit[data-k="${it.key}"] .bar i`); if (bar) bar.style.width = it.up.pct + '%'; const m = document.querySelector(`.iedit[data-k="${it.key}"] .meta`); if (m) m.textContent = `업로드 중 ${it.up.pct}%`; } };
        xhr.onload = () => (xhr.status < 300 ? ok() : no(new Error('upload ' + xhr.status)));
        xhr.onerror = () => no(new Error('network')); xhr.onabort = () => no(new Error('abort'));
        xhr.send(it.blob);
      });
      it.file = j.name; it.kind = j.kind; it.up = null; delete it.blob; paint();
      dirty = true; $('saveState').textContent = '업로드 완료 — 저장하면 반영돼요';
    } catch (e) { if (e.message !== 'abort') fail('업로드에 실패했어요'); }
  }

  // ---------- 썸네일 ----------
  $('thumbFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
      const r = await fetch('/app/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || '업로드 실패');
      S.thumbnail = j.url; touch();
    } catch (err) { showErr(err.message); }
    e.target.value = '';
  };

  // ---------- 저장 · 게시 ----------
  function showErr(m) { $('err').hidden = !m; $('err').textContent = m || ''; }
  async function save(status) {
    if (saving) return; saving = true; showErr(''); paint();
    try {
      const body = { kind: S.kind, title: $('title').value, summary: $('summary').value, description: $('description').value, thumbnail: S.thumbnail,
        pricing: S.pricing, price: S.pricing === 'free' ? 0 : S.price, status,
        items: S.items.map((i) => ({ title: i.title, file: i.file, file_name: i.file_name, size: i.size })) };
      const r = await fetch(`/create/${D.id}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || '저장하지 못했어요');
      S.status = j.status;
      // 서버가 부여한 id 를 반영 (열어 보기 링크)
      S.items = j.items.map((s) => ({ ...s, key: ++uid, up: null, error: '' }));
      dirty = false; $('saveState').textContent = (j.status === 'published' ? '게시했어요' : '저장했어요') + ' · ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { showErr(e.message); } finally { saving = false; paint(); }
  }
  $('save').onclick = () => save(S.status);
  $('unpublish').onclick = () => save('draft');
  $('publish').onclick = () => save('published');
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(S.status); } });
  window.addEventListener('beforeunload', (e) => { if (dirty || uploading()) { e.preventDefault(); e.returnValue = ''; } });

  paint();
})();
