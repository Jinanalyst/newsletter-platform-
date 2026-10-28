// 커뮤니티 포스트(노트): 누구나 읽고, 로그인한 사용자는 글·좋아요·댓글을 남길 수 있다
import { Router } from 'express';
import { db, now, baseUrl } from './db.js';
import { h } from './render.js';
import { limitHits } from './auth.js';
import { noteCard, noteHtml, ago, authorName, NOTE_MAX, COMMENT_MAX } from './note-utils.js';

export const feed = Router();
const PAGE = 20;
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
.nh form{margin:0}.nh .x{border:0;background:none;padding:0 2px;font-size:12.5px;color:var(--mute)}.nh .x:hover{color:var(--bad)}
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

feed.get('/posts', async (req, res) => {
  const t = req.t;
  const top = req.query.sort === 'top';
  const pageNo = Math.max(0, Math.min(500, Number(req.query.page) || 0));
  const order = top ? '(likes + comments * 2) DESC, id DESC' : 'id DESC';
  const rows = await db.prepare(`SELECT * FROM (${NOTE_SELECT}) x ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ${pageNo * PAGE}`).all(req.user?.id || 0);
  const more = rows.length > PAGE;
  const base = baseUrl();
  const q = (p) => `?${top ? 'sort=top&' : ''}page=${p}`;
  res.page(t('포스트'), `${CSS}<div class="ftop"><h1>${t('포스트')}</h1><div class="chips"><a class="chip${top ? '' : ' on'}" href="/posts">${t('최신')}</a><a class="chip${top ? ' on' : ''}" href="/posts?sort=top">${t('인기')}</a></div></div>
${composer(req, { action: '/posts', ph: t('지금 무슨 생각을 하고 계신가요?'), max: NOTE_MAX, label: t('게시') })}
${rows.length ? rows.slice(0, PAGE).map((n) => noteCard(n, { t, me: req.user, base })).join('') : `<div class="empty2">${t('아직 포스트가 없어요. 첫 글을 남겨 보세요.')}</div>`}
${more || pageNo ? `<p class="more">${pageNo ? `<a class="btn" href="${q(pageNo - 1)}">←</a> ` : ''}${more ? `<a class="btn" href="${q(pageNo + 1)}">${t('더 보기')}</a>` : ''}</p>` : ''}${script(req.user, t)}`,
  { msg: req.query.m, head: '<meta name="description" content="lett. community">' });
});

feed.post('/posts', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  if (!body) return res.redirect('/posts' + note(req.t('내용을 입력해 주세요.')));
  if (await limitHits(`note:${req.user.id}`, 60_000, 5)) return res.status(429).send(req.t('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'));
  await db.prepare('INSERT INTO notes(user_id,body,created_at) VALUES(?,?,?)').run(req.user.id, body, now());
  res.redirect('/posts');
});

const getNote = async (id, uid) => await db.prepare(`${NOTE_SELECT} WHERE n.id=?`).get(uid || 0, id);

feed.get('/posts/:id', async (req, res) => {
  const t = req.t;
  const n = await getNote(req.params.id, req.user?.id);
  if (!n) return res.status(404).page(t('찾을 수 없음'), `<h1>${t('찾을 수 없습니다')}</h1><p><a href="/posts">${t('포스트')}</a></p>`);
  const comments = await db.prepare(`SELECT c.*, u.name, u.email FROM note_comments c JOIN users u ON u.id=c.user_id WHERE c.note_id=? ORDER BY c.id LIMIT 200`).all(n.id);
  const base = baseUrl();
  const desc = n.body.replace(/\s+/g, ' ').slice(0, 150);
  res.page(`${authorName(n)} — ${n.body.replace(/\s+/g, ' ').slice(0, 40)}`, `${CSS}<p class="mute" style="margin:0 0 4px"><a href="/posts">← ${t('포스트')}</a></p>
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
  if (!removed) await db.prepare('INSERT OR IGNORE INTO note_likes(note_id,user_id) VALUES(?,?)').run(n.id, req.user.id);
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
