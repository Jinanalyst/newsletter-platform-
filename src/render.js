import { marked } from 'marked';
import { db, baseUrl, isPaid, hasPaid, publicUrl } from './db.js';
import { tr } from './i18n.js';

export const h = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function linkId(postId, url) {
  const row = await db.prepare('SELECT id FROM links WHERE post_id=? AND url=?').get(postId, url);
  if (row) return row.id;
  return Number((await db.prepare('INSERT INTO links(post_id,url) VALUES(?,?)').run(postId, url)).lastInsertRowid);
}

// ---------- 보안: 본문(마크다운) 안의 원시 HTML은 실행하지 않고 글자로 보여준다 ----------
// 발행자는 누구나 가입할 수 있으므로, <script> 등을 허용하면 공개 페이지를 보는 다른 사용자의 세션으로 동작이 실행될 수 있다.
const safeUrl = (u = '') => (/^(https?:|mailto:|\/(?!\/)|#)/i.test(String(u).trim()) ? String(u).trim() : '#');
const CENTER = /^::center /;
const centered = (tokens) => (tokens[0]?.type === 'text' && CENTER.test(tokens[0].raw) ? [[{ ...tokens[0], raw: tokens[0].raw.replace(CENTER, ''), text: tokens[0].text.replace(CENTER, '') }, ...tokens.slice(1)], true] : [tokens, false]);
marked.use({
  renderer: {
    html: ({ text }) => h(text),
    link({ href, title, tokens }) {
      return `<a href="${h(safeUrl(href))}"${title ? ` title="${h(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
    },
    // 가운데 정렬: 문단·제목 맨 앞의 "::center " 표시를 읽어 style 로 바꾼다
    paragraph({ tokens }) { const [t, c] = centered(tokens); return `<p${c ? ' style="text-align:center"' : ''}>${this.parser.parseInline(t)}</p>\n`; },
    heading({ tokens, depth }) { const [t, c] = centered(tokens); return `<h${depth}${c ? ' style="text-align:center"' : ''}>${this.parser.parseInline(t)}</h${depth}>\n`; },
    image({ href, title, text }) {
      const o = Object.fromEntries(String(title || '').split(';').map((x) => x.split('='))); // 에디터가 쓰는 title: "w=60;c=1" (너비 %, 가운데)
      if (o.w || o.c) {
        const w = Math.min(100, Math.max(5, +o.w || 100));
        return `<img src="${h(safeUrl(href))}" alt="${h(text)}" width="${w}%" style="width:${w}%;max-width:100%;height:auto;display:block;margin:${o.c ? '0 auto' : '0'}">`;
      }
      // 네이버 메일 등은 <head> 의 <style> 을 무시하므로 크기 제한을 태그에 직접 쓴다
      return `<img src="${h(safeUrl(href))}" alt="${h(text)}"${title ? ` title="${h(title)}"` : ''} style="max-width:100%;height:auto;border-radius:4px">`;
    },
  },
});

// ---------- 메일 머지 ----------
// {{name}} / {{nickname}} / {{email}}, 값이 없을 때의 대체어는 {{name|독자님}} 처럼 지정 (기본: 독자)
// 구독자가 입력한 값이므로 HTML/마크다운 특수문자는 무력화해서 삽입한다.
export function personalize(text, sub, { html = true } = {}) {
  return String(text || '').replace(/\{\{\s*(name|nickname|email)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/gi, (_, key, fallback) => {
    const raw = key.toLowerCase() === 'email' ? sub?.email : sub?.name;
    const v = (raw && String(raw).trim()) || fallback || (key.toLowerCase() === 'email' ? '' : '독자');
    return html ? h(v).replace(/([\\`*_[\]#~|])/g, '\\$1') : v.replace(/[\r\n]+/g, ' ');
  });
}

/**
 * mode: 'email' → 개인화 + 클릭 추적 + 오픈 픽셀 + 해지 링크
 *       'test'  → 개인화만 (추적 없음)
 *       'web'   → 공개 페이지용 (개인정보 없음)
 */
const MARK = '[[paywall]]';
// 유료 구간 처리: [[paywall]] 줄 이후, 또는 유료 전용 글은 도입부만 비구독자에게 보여준다
function gate(md, post, canRead) {
  const i = md.indexOf(MARK);
  if (i >= 0) return canRead ? md.replace(MARK, '') : md.slice(0, i) + '\n\n[[LOCK]]';
  if (post.audience === 'paid' && !canRead) return md.split(/\n\s*\n/).slice(0, 2).join('\n\n').slice(0, 300) + '…\n\n[[LOCK]]';
  return md;
}
export const isGated = (post) => post.audience === 'paid' || post.body_md.includes(MARK);

export async function renderPost(post, nl, { mode = 'web', sub = null, tok = '', canRead = false, lang = 'ko' } = {}) {
  const base = baseUrl();
  const t = tr(mode === 'web' ? lang : 'ko'); // 웹 글 페이지만 방문자 언어로, 메일은 한국어
  const readable = mode === 'test' || (mode === 'email' ? isPaid(sub) : canRead);
  const upgrade = `${base}/n/${nl.slug}/upgrade${sub?.token ? `?t=${sub.token}` : ''}`;
  let body = marked.parse(personalize(gate(post.body_md, post, readable), mode === 'web' ? null : sub));
  body = body.replace('<p>[[LOCK]]</p>', `<div style="border:1px solid #e5e5e5;border-radius:6px;padding:18px;background:#fafafa;text-align:center">
<b>${t('여기부터는 유료 구독자 전용입니다')}</b><br>${hasPaid(nl) ? `<a href="${upgrade}">${t('유료 구독하고 계속 읽기 →')}</a>` : t('발행자가 아직 유료 구독을 열지 않았습니다.')}</div>`);
  // 상대 경로 이미지(/uploads/..)는 메일에서도 보이도록 절대 경로로
  body = body.replace(/src="\/uploads\//g, `src="${base}/uploads/`);

  // <style> 을 지원하지 않는 메일 앱(네이버 등)을 위해 주요 태그에 스타일을 직접 입힌다
  body = body.replace(/<blockquote>/g, '<blockquote style="border-left:3px solid #3B82F6;margin:0;padding-left:16px;color:#555">')
    .replace(/<(h[1-3])>/g, '<$1 style="letter-spacing:-.02em;line-height:1.3">')
    .replace(/<a href=/g, '<a style="color:#2563EB;text-decoration:underline" href=');
  if (mode === 'email') {
    // 링크 클릭 추적: 링크마다 ID를 먼저 확보(DB)한 뒤 동기 치환
    const ids = new Map();
    for (const m of body.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      const u = m[1].replaceAll('&amp;', '&');
      if (!ids.has(u)) ids.set(u, await linkId(post.id, u));
    }
    body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_, url) => `href="${base}/t/c/${ids.get(url.replaceAll('&amp;', '&'))}/${tok}"`);
  }

  const chips = [post.category, ...String(post.tags || '').split(',')].filter(Boolean)
    .map((t, i) => `<a href="${base}/n/${h(nl.slug)}?${i === 0 && post.category ? 'c' : 'tag'}=${encodeURIComponent(t)}" style="color:#888;text-decoration:none;margin-right:10px">${i === 0 && post.category ? '' : '#'}${h(t)}</a>`).join('');
  const top = mode === 'web'
    ? `<p style="margin:0 0 20px;font-size:14px"><a href="${base}/n/${h(nl.slug)}" style="color:#888;text-decoration:none">← ${h(nl.name)}</a></p><h1 style="margin-top:0">${h(personalize(post.subject, null, { html: false }))}</h1>${chips ? `<p style="font-size:13px;margin:-4px 0 24px">${chips}</p>` : ''}`
    : '';
  const hero = mode === 'web' && /^(https?:\/\/|\/uploads\/)/.test(post.thumb || '') ? `<img src="${h(post.thumb)}" alt="" style="display:block;width:100%;margin:0 0 24px;border-radius:8px">` : '';
  const unsub = sub?.token ? `${base}/unsubscribe/${sub.token}` : `${base}/n/${nl.slug}`;
  const pageUrl = publicUrl(nl, `/p/${post.id}`);
  const share = `<p style="font-size:14px">${t('공유:')} <a href="#" onclick="navigator.clipboard.writeText('${pageUrl}');this.textContent='${t('복사됨 ✓')}';return false">${t('링크 복사')}</a> ·
<a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(post.subject)}" target="_blank" rel="noopener">X</a> ·
<a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">Facebook</a></p>`;
  const foot = mode === 'web'
    ? `<hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px">${post.id ? share : ''}<p style="text-align:center;margin:24px 0 8px"><a href="${base}/n/${h(nl.slug)}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:999px">${t('{name} 구독하기', { name: h(nl.name) })}</a></p>`
    : `<hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px">
<div style="font-size:13px;color:#888"><p>${h(nl.name)}의 구독자이기 때문에 받은 메일입니다.<br>
${sub?.token ? `<a href="${base}/r/${sub.token}" style="color:#888">친구에게 추천하기</a> · ` : ''}${sub?.token && hasPaid(nl) && !isPaid(sub) ? `<a href="${upgrade}" style="color:#888">유료 구독</a> · ` : ''}<a href="${unsub}" style="color:#888">구독 해지</a></p></div>`;
  const pixel = mode === 'email' ? `<img src="${base}/t/o/${tok}" width="1" height="1" alt="" style="display:none">` : '';
  const og = mode === 'web' && post.id ? `<title>${h(post.subject)} — ${h(nl.name)}</title><meta property="og:type" content="article"><meta property="og:title" content="${h(post.subject)}">
<meta property="og:description" content="${h(post.preview || nl.description)}"><meta property="og:url" content="${pageUrl}">${post.thumb ? `<meta property="og:image" content="${post.thumb.startsWith('/') ? base : ''}${h(post.thumb)}">` : nl.logo ? `<meta property="og:image" content="${base}${h(nl.logo)}">` : ''}<meta name="twitter:card" content="${post.thumb ? 'summary_large_image' : 'summary'}">` : '';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${og}
<style>a{color:#2563EB;text-decoration:underline;text-underline-offset:3px}img{max-width:100%;height:auto;border-radius:4px}blockquote{border-left:3px solid #3B82F6;margin:0;padding-left:16px;color:#555}h1,h2,h3{letter-spacing:-.02em;line-height:1.3}hr{border:none;border-top:1px solid #eee}</style></head>
<body style="margin:0;background:#fff;font-family:-apple-system,'Inter','Pretendard','Segoe UI','Malgun Gothic',sans-serif;color:#111;line-height:1.75">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${h(personalize(post.preview, mode === 'web' ? null : sub, { html: false }))}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr><td align="center" style="padding:40px 24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px"><tr><td align="left" style="font-size:16px;word-break:break-word">${top}${hero}${body}${foot}${pixel}</td></tr></table>
</td></tr></table></body></html>`;
}

export const toText = (html) =>
  html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h\d|li)>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
