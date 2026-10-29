// 커뮤니티 포스트(노트) 공용 도우미: 본문 렌더링, 상대 시간, 카드 HTML. db·views 를 가져오지 않아 landing 에서도 쓸 수 있다.
import { h } from './render.js';

export const NOTE_MAX = 1000;
export const COMMENT_MAX = 500;

const URL_RE = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g;
// 이스케이프를 먼저 하고 http(s) 주소만 링크로 바꾼다. 줄바꿈은 <br>
export const noteHtml = (body) => h(body).replace(URL_RE, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow ugc">${u}</a>`).replace(/\n/g, '<br>');

export function ago(iso, t) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('방금 전');
  if (s < 3600) return t('{n}분 전', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}시간 전', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n}일 전', { n: Math.floor(s / 86400) });
  return new Date(iso).toISOString().slice(0, 10);
}

export const authorName = (u) => u.name || String(u.email || '').split('@')[0] || '?';
const avatar = (u) => `<span class="av" style="background:hsl(${(u.user_id * 47) % 360} 55% 46%)">${h([...authorName(u)][0] || '?')}</span>`;

const ICON = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 8 3.6 5 6.8 5c1.9 0 3.5 1 5.2 3 1.7-2 3.3-3 5.2-3 3.2 0 5.1 3 4 6.1-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
};

// n: 목록 쿼리 한 행 (user_id, name, email, nl_slug, likes, comments, liked, body, created_at, id)
export function noteCard(n, { t, me, base }) {
  const mine = me && me.id === n.user_id;
  return `<article class="nt" id="n${n.id}"><a class="avl" href="/posts/${n.id}" tabindex="-1" aria-hidden="true">${avatar(n)}</a><div class="nb">
<div class="nh"><b>${h(authorName(n))}</b><a class="ago" href="/posts/${n.id}">${ago(n.created_at, t)}</a><span class="sp"></span>${n.nl_slug ? `<a class="nsub" href="/n/${h(n.nl_slug)}">${t('뉴스레터 보기')}</a>` : ''}
${mine ? `<a class="x" href="/posts/${n.id}/edit">${t('수정')}</a><form method="post" action="/posts/${n.id}/delete" onsubmit="return confirm(${h(JSON.stringify(t('삭제할까요?')))})"><button class="x" title="${t('삭제')}">${t('삭제')}</button></form>` : ''}</div>
<div class="nx">${noteHtml(n.body)}</div>
<div class="na"><button type="button" class="lk${n.liked ? ' on' : ''}" data-id="${n.id}" aria-label="${t('좋아요')}">${ICON.heart}<span>${n.likes}</span></button>
<a class="cm" href="/posts/${n.id}#comments" aria-label="${t('댓글')}">${ICON.chat}<span>${n.comments}</span></a>
<button type="button" class="sh" data-url="${h(base)}/posts/${n.id}" aria-label="${t('공유')}">${ICON.share}</button></div></div></article>`;
}
