// 검색엔진용 /sitemap.xml · /robots.txt. 사이트맵 규약상 한 파일에는 그 호스트의 주소만 넣을 수 있어서 요청 호스트별로 내용이 다르다.
// lett.live: 플랫폼 공개 페이지 + 전용 주소가 없는 뉴스레터(/n/<slug>) · <이름>.lett.live, 커스텀 도메인: 그 뉴스레터의 글만
import { Router } from 'express';
import { db, publicHost } from './db.js';
import { h } from './render.js';
import { PLATFORM_DOMAIN } from './workspace.js';

export const seo = Router();

const STATIC_PATHS = ['/', '/creators', '/posts', '/pricing', '/privacy', '/refund'];
const POST_SQL = "SELECT id, COALESCE(updated_at, sent_at) AS at FROM posts WHERE newsletter_id=? AND kind='post' AND status='sent' ORDER BY sent_at DESC LIMIT 5000";

// 요청 호스트가 뉴스레터 전용 주소면 그 뉴스레터를 돌려준다. 해당 없음(플랫폼 호스트)은 null, 없는 서브도메인은 undefined
async function newsletterOf(host) {
  const base = PLATFORM_DOMAIN();
  if (!host || host === base || host === 'www.' + base || host === 'localhost' || /^[\d.:]+$/.test(host)) return null;
  if (host.endsWith('.' + base)) return await db.prepare('SELECT * FROM newsletters WHERE subdomain=?').get(host.slice(0, -base.length - 1));
  return (await db.prepare('SELECT * FROM newsletters WHERE custom_domain=? AND domain_verified_at IS NOT NULL').get(host)) || null;
}

const hostOf = (req) => String(req.hostname || '').toLowerCase();
const origin = (req) => `${hostOf(req) === 'localhost' ? 'http' : 'https'}://${req.get('host')}`;
const entry = (loc, at) => `<url><loc>${h(loc)}</loc>${at ? `<lastmod>${h(at)}</lastmod>` : ''}</url>`;
const cached = (res) => res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');

async function platformUrls(root) {
  const nls = await db.prepare('SELECT id, slug, subdomain, custom_domain, domain_verified_at FROM newsletters ORDER BY id DESC LIMIT 2000').all();
  const urls = STATIC_PATHS.map((p) => entry(root + p));
  for (const nl of nls) {
    if (publicHost(nl)) continue; // 전용 주소가 있으면 /n/<slug> 는 그쪽으로 301 되고, 글은 그 호스트의 사이트맵에 실린다
    urls.push(entry(`${root}/n/${nl.slug}`));
    for (const p of await db.prepare(POST_SQL).all(nl.id)) urls.push(entry(`${root}/n/${nl.slug}/p/${p.id}`, p.at));
  }
  const notes = await db.prepare('SELECT id, created_at AS at FROM notes ORDER BY id DESC LIMIT 20000').all();
  for (const n of notes) urls.push(entry(`${root}/posts/${n.id}`, n.at));
  const courses = await db.prepare("SELECT id, COALESCE(updated_at, created_at) AS at FROM courses WHERE status='published' ORDER BY id DESC LIMIT 5000").all();
  for (const c of courses) urls.push(entry(`${root}/c/${c.id}`, c.at));
  return urls;
}

seo.get('/sitemap.xml', async (req, res) => {
  const host = hostOf(req), nl = await newsletterOf(host);
  if (nl === undefined) return res.status(404).type('text/plain').send('Not found');
  let urls;
  if (nl) {
    const canonical = publicHost(nl);
    if (canonical && canonical !== host) return res.redirect(301, `https://${canonical}/sitemap.xml`);
    urls = [entry(origin(req) + '/'), ...(await db.prepare(POST_SQL).all(nl.id)).map((p) => entry(`${origin(req)}/p/${p.id}`, p.at))];
  } else urls = await platformUrls(origin(req));
  cached(res).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

seo.get('/robots.txt', (req, res) => {
  cached(res).type('text/plain').send(`User-agent: *
Allow: /
Disallow: /app
Disallow: /admin
Disallow: /api/
Disallow: /settlement
Disallow: /edit-login

Sitemap: ${origin(req)}/sitemap.xml
`);
});
