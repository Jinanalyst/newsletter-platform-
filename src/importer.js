// 외부 플랫폼의 글 가져오기: RSS/Atom 피드 주소 또는 붙여넣은 HTML/마크다운 → 마크다운
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

// ---------- SSRF 방어 ----------
// 사용자가 입력한 주소를 서버가 가져오므로, 내부망·로컬·클라우드 메타데이터 주소로는 연결하지 않는다.
// 연결 시점(lookup)에 실제 IP를 검사하므로 DNS 재바인딩도 막는다.
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
const safeLookup = (host, opts, cb) => dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
  if (err) return cb(err);
  const ok = addrs.filter((a) => !isPrivateIp(a.address));
  if (!ok.length) return cb(new Error('허용되지 않는 주소입니다.'));
  if (opts?.all) return cb(null, ok);
  cb(null, ok[0].address, ok[0].family);
});

const MAX_BYTES = 3 * 1024 * 1024;
function getOnce(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new Error('http(s) 주소만 가능합니다.'));
    if (u.username || u.password) return reject(new Error('인증 정보가 포함된 주소는 사용할 수 없습니다.'));
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return reject(new Error('허용되지 않는 주소입니다.'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { lookup: safeLookup, timeout: 10_000, headers: { 'User-Agent': 'NewsletterImporter/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, u).toString() });
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`가져오지 못했습니다 (HTTP ${res.statusCode}).`)); }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(new Error('피드가 너무 큽니다 (3MB 초과).')); } else chunks.push(c); });
      res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('응답 시간이 초과되었습니다.')));
    req.on('error', reject);
  });
}
export async function fetchSafe(url) {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const r = await getOnce(cur);
    if (r.body !== undefined) return r.body;
    cur = r.redirect; // 리다이렉트마다 다시 검사
  }
  throw new Error('리다이렉트가 너무 많습니다.');
}

// ---------- HTML → 마크다운 ----------
// &lt; &gt; &amp; 는 그대로 둔다 (디코딩하면 본문 속 HTML 태그로 되살아날 수 있음)
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&hellip;/g, '…')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => (Number(n) === 60 ? '&lt;' : Number(n) === 62 ? '&gt;' : Number(n) === 38 ? '&amp;' : String.fromCodePoint(Number(n))));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ''));
const absUrl = (u, base) => { try { const x = new URL(u.trim().replace(/&amp;/g, '&'), base || undefined); return /^(https?:|mailto:)$/.test(x.protocol) ? x.toString().replace(/\(/g, '%28').replace(/\)/g, '%29') : ''; } catch { return ''; } };

export function htmlToMd(html, base = '') {
  let s = String(html || '').replace(/\r/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style|iframe|noscript|svg|form|object|embed|head)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => `\n\n\`\`\`\n${stripTags(c).replace(/\n+$/, '')}\n\`\`\`\n\n`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => '`' + stripTags(c).replace(/`/g, "'") + '`');
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n\n# ${stripTags(c).trim()}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n\n## ${stripTags(c).trim()}\n\n`)
    .replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, (_, c) => `\n\n### ${stripTags(c).trim()}\n\n`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => (c.trim() ? `**${c.trim()}**` : ''))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, c) => (c.trim() ? `*${c.trim()}*` : ''));
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = absUrl((tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || '', base);
    const alt = decode((tag.match(/\balt=["']([^"']*)["']/i) || [])[1] || '').replace(/[\[\]]/g, '');
    return src ? `\n\n![${alt}](${src})\n\n` : '';
  });
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const u = absUrl(decode(href), base);
    const t = text.trim();
    if (!t) return '';
    return u ? `[${t.replace(/[\[\]]/g, '')}](${u})` : t;
  });
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, c) => { let i = 0; return '\n\n' + c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, li) => `${++i}. ${li.trim().replace(/\n+/g, ' ')}\n`) + '\n'; });
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${c.trim().replace(/\n+/g, ' ')}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => '\n\n' + c.replace(/<[^>]+>/g, '').trim().split(/\n+/).map((l) => `> ${l.trim()}`).join('\n') + '\n\n');
  s = s.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n').replace(/<br\s*\/?>/gi, '  \n').replace(/<\/(p|div|section|article|figure|figcaption|ul|table|tr)>/gi, '\n\n');
  s = decode(s.replace(/<\/?[a-zA-Z][^>]*>/g, ''));
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- RSS / Atom 파싱 ----------
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : '';
};
const unCdata = (s) => s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');

export function parseFeed(xml, feedUrl) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => {
    const title = stripTags(unCdata(tag(b, 'title'))).trim();
    let link = '';
    if (isAtom) {
      const alt = (b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) || b.match(/<link\b[^>]*>/i) || [''])[0];
      link = (alt.match(/href=["']([^"']+)["']/i) || [])[1] || '';
    } else link = stripTags(unCdata(tag(b, 'link'))).trim() || stripTags(unCdata(tag(b, 'guid'))).trim();
    const content = unCdata(tag(b, 'content:encoded')) || unCdata(tag(b, 'content')) || unCdata(tag(b, 'description')) || unCdata(tag(b, 'summary'));
    const date = stripTags(unCdata(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))).trim();
    const t = date && !isNaN(new Date(date)) ? new Date(date).toISOString() : null;
    const cats = [...b.matchAll(/<category\b[^>]*?(?:term=["']([^"']+)["'][^>]*\/?>|>([\s\S]*?)<\/category>)/gi)].map((m) => stripTags(unCdata(m[1] || m[2] || '')).trim()).filter(Boolean);
    const url = absUrl(link, feedUrl);
    return { title: title || '(제목 없음)', url, date: t, tags: cats.slice(0, 5), body_md: htmlToMd(content, url || feedUrl) };
  }).filter((x) => x.body_md || x.title);
}
