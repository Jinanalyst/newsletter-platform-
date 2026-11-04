// 커뮤니티 포스트(노트): 누구나 읽고, 로그인한 사용자는 글·좋아요·댓글을 남길 수 있다
import { Router } from 'express';
import { db, now, baseUrl } from './db.js';
import { h } from './render.js';
import { limitHits } from './auth.js';
import { NOTE_TOPICS, topicKey, likePat, weekAgo } from './topics.js';
import { EXPLORE_CSS, qs, searchForm, toolbar, emptyState, errorState, LOADING_JS } from './explore-ui.js';
import { noteCard, noteHtml, ago, authorName, NOTE_MAX, COMMENT_MAX } from './note-utils.js';

export const feed = Router();
const PAGE = 12;
const TITLE_MAX = 80;
const note = (m) => '?m=' + encodeURIComponent(m);

// 목록·상세 공통 조회: 작성자, 뉴스레터, 좋아요/댓글 수, 내가 눌렀는지
export const NOTE_SELECT = `SELECT n.*, u.name, u.email,
  (SELECT slug FROM newsletters WHERE owner_id=u.id ORDER BY id LIMIT 1) AS nl_slug,
  (SELECT COUNT(*) FROM note_likes l WHERE l.note_id=n.id) AS likes,
  (SELECT COUNT(*) FROM note_comments c WHERE c.note_id=n.id) AS comments,
  (SELECT COUNT(*) FROM note_likes l WHERE l.note_id=n.id AND l.user_id=?) AS liked
  FROM notes n JOIN users u ON u.id=n.user_id`;

const CSS = `<style>
.ftop{display:flex;align-items:center;gap:16px;margin-bottom:6px}.ftop h1{margin:0}.ftop .chips{margin:0 0 0 auto}
.compose{border:1px solid var(--line);border-radius:16px;background:var(--card);padding:14px 16px;margin:14px 0 10px}
.compose textarea{border:0;padding:4px 0;font:inherit;font-size:15px;line-height:1.6;resize:none;min-height:56px;background:transparent}
.compose textarea:focus{box-shadow:none;border:0}
.compose .bar{display:flex;align-items:center;gap:10px;margin-top:6px}.compose .cnt{margin-left:auto;font-size:12.5px;color:var(--mute)}
.compose .login{display:flex;align-items:center;gap:12px;color:var(--mute);font-size:14.5px}.compose .login .btn{margin-left:auto}
.nt{display:flex;gap:12px;padding:18px 4px;border-bottom:1px solid var(--line)}
.nt .av{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;flex:0 0 40px}
.nt .avl{text-decoration:none;flex:0 0 40px}
.nb{flex:1;min-width:0}
.nh{display:flex;align-items:center;gap:8px;font-size:14.5px;min-height:24px}
.nh b{font-weight:600}.nh .ago{color:var(--mute);font-size:13px;text-decoration:none}.nh .sp{flex:1}
.nh .nsub{color:#EA580C;font-size:13px;font-weight:600;text-decoration:none}
.nh form{margin:0}.nh .x{border:0;background:none;padding:0 2px;font-size:12.5px;color:var(--mute);text-decoration:none}.nh .x:hover{color:var(--bad)}
.nx{font-size:15.5px;line-height:1.65;margin:4px 0 12px;white-space:normal;overflow-wrap:anywhere}
.nx a{color:var(--blue)}
.na{display:flex;align-items:center;gap:22px;color:var(--mute)}
.na button,.na a{border:0;background:none;padding:0;display:inline-flex;align-items:center;gap:6px;color:var(--mute);font-size:13.5px;text-decoration:none;cursor:pointer;border-radius:0}
.na button:hover,.na a:hover{color:var(--ink);border:0}
.na svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.na .lk.on{color:#E11D48}.na .lk.on svg{fill:#E11D48;stroke:#E11D48}
.more{text-align:center;margin:26px 0 0}
.empty2{border:1px dashed var(--line);border-radius:16px;padding:44px 20px;text-align:center;color:var(--mute);margin-top:18px}
.cmt{display:flex;gap:10px;padding:14px 0;border-bottom:1px solid var(--line)}
.cmt .av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex:0 0 32px}
.cmt .nh{font-size:14px}.cmt .nx{font-size:14.5px;margin:2px 0 0}
.nt.big .nx{font-size:17px}
.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--ink);color:#fff;border-radius:999px;padding:9px 18px;font-size:13.5px;z-index:200}
</style>`;

// 좋아요 · 공유 · 입력창 글자 수 (목록·상세 공통)
const script = (me, t) => `<script>(function(){var ME=${me ? 'true' : 'false'},T=${JSON.stringify(t('링크를 복사했어요'))};
function toast(m){var d=document.createElement('div');d.className='toast';d.textContent=m;document.body.appendChild(d);setTimeout(function(){d.remove()},1800)}
document.addEventListener('click',function(e){var b=e.target.closest('.lk');
if(b){if(!ME){location.href='/login';return}b.disabled=true;
fetch('/posts/'+b.dataset.id+'/like',{method:'POST'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(d){b.classList.toggle('on',d.liked);b.querySelector('span').textContent=d.count}).catch(function(){}).then(function(){b.disabled=false});return}
var s=e.target.closest('.sh');if(s){var u=s.dataset.url;if(navigator.share){navigator.share({url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){toast(T)},function(){prompt(T,u)})}else prompt(T,u)}});
[].forEach.call(document.querySelectorAll('textarea[data-max]'),function(ta){var c=ta.form.querySelector('.cnt'),mx=+ta.dataset.max;function f(){ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';if(c)c.textContent=ta.value.length+' / '+mx}ta.addEventListener('input',f);f()})})();</script>`;

const composer = (req, { action, ph, max, label }) => (req.user
  ? `<form class="compose" method="post" action="${action}"><textarea name="body" data-max="${max}" maxlength="${max}" rows="2" placeholder="${h(ph)}" required></textarea>
<div class="bar"><span class="cnt"></span><button class="primary sm">${label}</button></div></form>`
  : `<div class="compose"><div class="login"><span>${req.t('로그인하고 이야기를 남겨 보세요')}</span><a class="btn primary sm" href="/login">${req.t('로그인')}</a></div></div>`);

const SORTS = [['top', '인기순'], ['new', '최신순'], ['comments', '댓글순']];
const PREVIEW = 150;
// 인기 점수: 최근 7일 동안 받은 좋아요(×2)와 댓글(×3). 동점이면 누적 반응, 그다음 최신순
const HOT = '(likes7 * 2 + comments7 * 3)';
const ORDER = {
  top: `${HOT} DESC, (likes + comments * 2) DESC, id DESC`,
  new: 'id DESC',
  comments: 'comments DESC, id DESC',
};
// 목록용 조회: NOTE_SELECT 에 최근 7일 반응 수를 더한다 (자리표시자 순서: 주간 시각 ×2, 내 id)
const LIST_SELECT = `SELECT n.*, u.name, u.email,
  (SELECT COUNT(*) FROM note_likes l WHERE l.note_id=n.id) AS likes,
  (SELECT COUNT(*) FROM note_comments c WHERE c.note_id=n.id) AS comments,
  (SELECT COUNT(*) FROM note_likes l WHERE l.note_id=n.id AND l.created_at>=?) AS likes7,
  (SELECT COUNT(*) FROM note_comments c WHERE c.note_id=n.id AND c.created_at>=?) AS comments7,
  (SELECT COUNT(*) FROM note_likes l WHERE l.note_id=n.id AND l.user_id=?) AS liked
  FROM notes n JOIN users u ON u.id=n.user_id`;

const topicLabel = (k) => NOTE_TOPICS.find(([key]) => key === k)?.[1] || '';
const titleOf = (n) => n.title || n.body.split('\n').find((l) => l.trim())?.trim().slice(0, 60) || '';
const previewOf = (n) => { const body = n.body.replace(/\s+/g, ' ').trim(); return (n.title ? body : body.slice(titleOf(n).length).trim() || body).slice(0, PREVIEW); };

const ICO = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 8 3.6 5 6.8 5c1.9 0 3.5 1 5.2 3 1.7-2 3.3-3 5.2-3 3.2 0 5.1 3 4 6.1-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
};

const isHot = (n) => n.likes7 * 2 + n.comments7 * 3 >= 3;
const gridCard = (n, t) => `<article class="xcard">
<div class="xtags">${isHot(n) ? `<span class="tag hot">🔥 ${t('인기')}</span>` : ''}${n.category ? `<span class="tag">${h(t(topicLabel(n.category)))}</span>` : ''}</div>
<h3><a href="/posts/${n.id}">${h(titleOf(n))}</a></h3>
<p class="pv">${h(previewOf(n))}</p>
<div class="xmeta"><span class="av" style="background:hsl(${(n.user_id * 47) % 360} 55% 46%)">${h([...authorName(n)][0] || '?')}</span><b>${h(authorName(n))}</b><span>·</span><span>${ago(n.created_at, t)}</span></div>
<div class="xstat"><span title="${t('조회수')}">${ICO.eye}${n.views}</span>
<button type="button" class="lk${n.liked ? ' on' : ''}" data-id="${n.id}" aria-label="${t('좋아요')}">${ICO.heart}<span>${n.likes}</span></button>
<span title="${t('댓글')}">${ICO.chat}${n.comments}</span></div></article>`;

const postComposer = (req, cat) => {
  const t = req.t;
  if (!req.user) return `<a class="btn primary" href="/login">${t('로그인하고 글쓰기')}</a>`;
  return `<details class="wr"><summary class="btn primary">${t('글쓰기')}</summary>
<form class="compose" method="post" action="/posts"><input class="ti" name="title" maxlength="${TITLE_MAX}" placeholder="${h(t('제목 (선택)'))}">
<textarea name="body" data-max="${NOTE_MAX}" maxlength="${NOTE_MAX}" rows="3" placeholder="${h(t('지금 무슨 생각을 하고 계신가요?'))}" required></textarea>
<div class="bar"><select name="category" aria-label="${t('카테고리')}"><option value="">${t('카테고리 선택')}</option>${NOTE_TOPICS.map(([k, l]) => `<option value="${k}"${cat === k ? ' selected' : ''}>${h(t(l))}</option>`).join('')}</select><span class="cnt"></span><button class="primary sm">${t('게시')}</button></div></form></details>`;
};

feed.get('/posts', async (req, res) => {
  const t = req.t;
  const q = String(req.query.q || '').trim().slice(0, 60);
  const cat = topicKey(String(req.query.cat || ''));
  const sort = ORDER[req.query.sort] ? String(req.query.sort) : 'new';
  const pageNo = Math.max(0, Math.min(500, Number(req.query.page) || 0));
  const week = weekAgo(), uid = req.user?.id || 0;
  // 카테고리·검색·정렬을 한 쿼리에서 동시에 적용
  const where = [], args = [week, week, uid];
  if (cat) { where.push('category=?'); args.push(cat); }
  if (q) { where.push("(title ILIKE ? OR body ILIKE ? OR COALESCE(NULLIF(name,''), email) ILIKE ?)"); args.push(likePat(q), likePat(q), likePat(q)); }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const here = (p = {}) => qs('/posts', { q, cat, sort: sort === 'new' ? '' : sort, page: pageNo, ...p });
  let body;
  try {
    const rows = await db.prepare(`SELECT * FROM (${LIST_SELECT}) x ${cond} ORDER BY ${ORDER[sort]} LIMIT ${PAGE + 1} OFFSET ${pageNo * PAGE}`).all(...args);
    const more = rows.length > PAGE;
    // 이번 주 인기 글: 검색·페이지 이동 중이 아니고 '인기순'이 아닐 때 상단에 따로 보여 최신 글과 구분한다
    let hotRows = [];
    if (!q && !pageNo && sort !== 'top') {
      hotRows = await db.prepare(`SELECT * FROM (${LIST_SELECT}) x WHERE ${HOT} > 0${cat ? ' AND category=?' : ''} ORDER BY ${ORDER.top} LIMIT 4`).all(...(cat ? [week, week, uid, cat] : [week, week, uid]));
    }
    body = `${hotRows.length ? `<div class="xsec"><h2>🔥 ${t('이번 주 인기 글')}</h2><small>${t('최근 7일 좋아요·댓글 기준')}</small></div><div class="xgrid">${hotRows.map((n) => gridCard(n, t)).join('')}</div>` : ''}
<div class="xsec"><h2>${sort === 'top' ? t('인기 글') : sort === 'comments' ? t('댓글 많은 글') : t('최신 글')}</h2></div>
${rows.length ? `<div class="xgrid">${rows.slice(0, PAGE).map((n) => gridCard(n, t)).join('')}</div>`
  : emptyState({ t, q, reset: '/posts', title: t('아직 글이 없어요'), hint: t('첫 글을 남겨 보세요.') })}
${more || pageNo ? `<p class="xmore">${pageNo ? `<a class="btn" href="${here({ page: pageNo - 1 })}">← ${t('이전')}</a>` : ''}${more ? `<a class="btn" href="${here({ page: pageNo + 1 })}">${t('더 보기')}</a>` : ''}</p>` : ''}`;
  } catch (e) {
    console.error('posts list', e);
    body = errorState(t, here());
  }
  res.page(t('커뮤니티'), `${CSS}${EXPLORE_CSS}<div class="xhead"><div class="xgrow"><h1>${t('커뮤니티')}</h1><p class="mute">${t('궁금한 것, 생각한 것을 함께 나눠요.')}</p></div>
${searchForm('/posts', q, { cat, sort: sort === 'new' ? '' : sort }, t, t('글 제목·내용·작성자 검색'))}${postComposer(req, cat)}</div>
${toolbar({ action: '/posts', cats: NOTE_TOPICS, cat, sorts: SORTS, sort, defSort: 'new', q, t })}
${body}${script(req.user, t)}${LOADING_JS}`,
  { wide: true, msg: req.query.m, head: '<meta name="description" content="lett. community">' });
});

feed.post('/posts', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  const title = String(req.body.title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  if (!body) return res.redirect('/posts' + note(req.t('내용을 입력해 주세요.')));
  if (await limitHits(`note:${req.user.id}`, 60_000, 5)) return res.status(429).send(req.t('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'));
  await db.prepare('INSERT INTO notes(user_id,title,body,category,created_at) VALUES(?,?,?,?,?)').run(req.user.id, title, body, topicKey(String(req.body.category || '')), now());
  res.redirect('/posts');
});

const getNote = async (id, uid) => await db.prepare(`${NOTE_SELECT} WHERE n.id=?`).get(uid || 0, id);

feed.get('/posts/:id', async (req, res) => {
  const t = req.t;
  const n = await getNote(req.params.id, req.user?.id);
  if (!n) return res.status(404).page(t('찾을 수 없음'), `<h1>${t('찾을 수 없습니다')}</h1><p><a href="/posts">${t('포스트')}</a></p>`);
  if (req.user?.id !== n.user_id && !(await limitHits(`nview:${n.id}:${req.ip}`, 3600_000, 1))) { await db.prepare('UPDATE notes SET views=views+1 WHERE id=?').run(n.id); n.views += 1; }
  const comments = await db.prepare(`SELECT c.*, u.name, u.email FROM note_comments c JOIN users u ON u.id=c.user_id WHERE c.note_id=? ORDER BY c.id LIMIT 200`).all(n.id);
  const base = baseUrl();
  const desc = n.body.replace(/\s+/g, ' ').slice(0, 150);
  res.page(`${n.title || authorName(n)} — ${n.body.replace(/\s+/g, ' ').slice(0, 40)}`, `${CSS}${EXPLORE_CSS}<p class="mute" style="margin:0 0 4px"><a href="/posts">← ${t('커뮤니티')}</a></p>
${n.title ? `<h1 style="margin:8px 0 2px">${h(n.title)}</h1>` : ''}<div class="xtags" style="margin-top:6px">${n.category ? `<a class="tag" href="/posts?cat=${n.category}">${h(t(topicLabel(n.category)))}</a>` : ''}<span class="tag">${t('조회수')} ${n.views}</span></div>
${noteCard(n, { t, me: req.user, base }).replace(/^<article class="nt"/, '<article class="nt big"')}
<h2 id="comments">${t('댓글')} ${comments.length}</h2>
${composer(req, { action: `/posts/${n.id}/comments`, ph: t('댓글을 남겨 보세요'), max: COMMENT_MAX, label: t('등록') })}
${comments.map((c) => `<div class="cmt"><span class="av" style="background:hsl(${(c.user_id * 47) % 360} 55% 46%)">${h([...authorName(c)][0] || '?')}</span><div class="nb"><div class="nh"><b>${h(authorName(c))}</b><span class="ago">${ago(c.created_at, t)}</span><span class="sp"></span>${req.user && (req.user.id === c.user_id || req.user.id === n.user_id) ? `<form method="post" action="/posts/${n.id}/comments/${c.id}/delete" onsubmit="return confirm(${h(JSON.stringify(t('삭제할까요?')))})"><button class="x">${t('삭제')}</button></form>` : ''}</div><div class="nx">${noteHtml(c.body)}</div></div></div>`).join('')}${script(req.user, t)}`,
  { msg: req.query.m, head: `<meta name="description" content="${h(desc)}"><meta property="og:title" content="${h(authorName(n))}"><meta property="og:description" content="${h(desc)}"><meta property="og:url" content="${base}/posts/${n.id}">` });
});

// 좋아요 토글 (fetch 로 호출, JSON 응답)
feed.post('/posts/:id/like', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'login' });
  if (await limitHits(`like:${req.user.id}`, 60_000, 60)) return res.status(429).json({ error: 'rate' });
  const n = await db.prepare('SELECT id FROM notes WHERE id=?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'not_found' });
  const removed = (await db.prepare('DELETE FROM note_likes WHERE note_id=? AND user_id=?').run(n.id, req.user.id)).changes;
  if (!removed) await db.prepare('INSERT OR IGNORE INTO note_likes(note_id,user_id,created_at) VALUES(?,?,?)').run(n.id, req.user.id, now());
  const count = (await db.prepare('SELECT COUNT(*) n FROM note_likes WHERE note_id=?').get(n.id)).n;
  res.json({ liked: !removed, count });
});

feed.post('/posts/:id/comments', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const n = await db.prepare('SELECT id FROM notes WHERE id=?').get(req.params.id);
  if (!n) return res.redirect('/posts');
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, COMMENT_MAX);
  if (!body) return res.redirect(`/posts/${n.id}` + note(req.t('내용을 입력해 주세요.')));
  if (await limitHits(`ncomment:${req.user.id}`, 60_000, 10)) return res.status(429).send(req.t('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'));
  await db.prepare('INSERT INTO note_comments(note_id,user_id,body,created_at) VALUES(?,?,?,?)').run(n.id, req.user.id, body, now());
  res.redirect(`/posts/${n.id}#comments`);
});

// 내 포스트 수정
feed.get('/posts/:id/edit', async (req, res) => {
  const t = req.t;
  if (!req.user) return res.redirect('/login');
  const n = await db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!n) return res.redirect('/posts');
  res.page(t('포스트 수정'), `${CSS}${EXPLORE_CSS}<p class="mute" style="margin:0 0 4px"><a href="/posts/${n.id}">← ${t('포스트')}</a></p>
<form class="compose" method="post" action="/posts/${n.id}/edit"><input class="ti" name="title" maxlength="${TITLE_MAX}" value="${h(n.title)}" placeholder="${h(t('제목 (선택)'))}"><textarea name="body" data-max="${NOTE_MAX}" maxlength="${NOTE_MAX}" rows="4" required>${h(n.body)}</textarea>
<div class="bar"><select name="category" aria-label="${t('카테고리')}"><option value="">${t('카테고리 선택')}</option>${NOTE_TOPICS.map(([k, l]) => `<option value="${k}"${n.category === k ? ' selected' : ''}>${h(t(l))}</option>`).join('')}</select><span class="cnt"></span><a class="btn sm" href="/posts/${n.id}">${t('취소')}</a><button class="primary sm">${t('저장')}</button></div></form>${script(req.user, t)}`,
  { msg: req.query.m });
});

feed.post('/posts/:id/edit', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  if (!body) return res.redirect(`/posts/${req.params.id}/edit` + note(req.t('내용을 입력해 주세요.')));
  await db.prepare('UPDATE notes SET title=?, category=?, body=? WHERE id=? AND user_id=?').run(String(req.body.title || '').replace(/s+/g, ' ').trim().slice(0, TITLE_MAX), topicKey(String(req.body.category || '')), body, req.params.id, req.user.id);
  res.redirect(`/posts/${req.params.id}`);
});

feed.post('/posts/:id/delete', async (req, res) => {
  if (req.user) await db.prepare('DELETE FROM notes WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.redirect('/posts');
});

feed.post('/posts/:id/comments/:cid/delete', async (req, res) => {
  const n = await db.prepare('SELECT id, user_id FROM notes WHERE id=?').get(req.params.id);
  if (req.user && n) {
    // 댓글 작성자 본인 또는 글 작성자만 삭제
    if (req.user.id === n.user_id) await db.prepare('DELETE FROM note_comments WHERE id=? AND note_id=?').run(req.params.cid, n.id);
    else await db.prepare('DELETE FROM note_comments WHERE id=? AND note_id=? AND user_id=?').run(req.params.cid, n.id, req.user.id);
  }
  res.redirect(`/posts/${req.params.id}#comments`);
});
