// 공개 페이지·글 페이지 조회수 집계. 쿠키 없이 (IP+UA+날짜) 해시로 하루 단위 방문자를 구분한다.
import { createHash } from 'node:crypto';
import { db, now } from './db.js';

const BOT = /bot|crawl|spider|slurp|scrap|facebookexternalhit|whatsapp|embedly|curl|wget|python|httpclient|headless|monitor|uptime|lighthouse/i;
const DAY = 864e5;

// 내부 이동(플랫폼·이 뉴스레터의 도메인)은 유입으로 세지 않는다
const isOwnHost = (host, req, nl) => {
  const base = (process.env.PLATFORM_DOMAIN || 'lett.live').toLowerCase();
  return host === req.hostname || host === base || host.endsWith('.' + base) || host === nl.custom_domain;
};
const SEARCH_RE = /(^|\.)(google\.[a-z.]+|naver\.com|daum\.net|bing\.com|yahoo\.[a-z.]+|duckduckgo\.com|ecosia\.org|zum\.com|nate\.com|baidu\.com)$/;

// 유입 채널 분류 (티스토리식): 호스트 → [채널, 표시 이름]
const SOURCES = [
  ['검색', 'Google', /(^|\.)google\./], ['검색', '네이버 검색', /^(m\.)?(search\.)?naver\.com$/], ['검색', '다음 검색', /(^|\.)daum\.net$/], ['검색', 'Bing', /bing\.com$/],
  ['검색', 'Yahoo', /yahoo\./], ['검색', 'DuckDuckGo', /duckduckgo\.com$/], ['검색', '줌', /zum\.com$/], ['검색', '네이트', /nate\.com$/], ['검색', 'Baidu', /baidu\.com$/], ['검색', 'Ecosia', /ecosia\.org$/],
  ['SNS', '인스타그램', /instagram\.com$/], ['SNS', '페이스북', /facebook\.com$|^fb\.com$/], ['SNS', 'X (트위터)', /(^|\.)t\.co$|twitter\.com$|(^|\.)x\.com$/], ['SNS', '스레드', /threads\.net$/],
  ['SNS', '유튜브', /youtube\.com$|youtu\.be$/], ['SNS', '카카오', /kakao\.com$|kakaocorp\.com$/], ['SNS', '링크드인', /linkedin\.com$|lnkd\.in$/], ['SNS', '레딧', /reddit\.com$/],
  ['SNS', '핀터레스트', /pinterest\./], ['SNS', '텔레그램', /(^|\.)t\.me$|telegram\./], ['SNS', '라인', /line\.me$/], ['SNS', '밴드', /band\.us$/], ['SNS', '디스코드', /discord\./],
  ['블로그·커뮤니티', '네이버 블로그', /blog\.naver\.com$/], ['블로그·커뮤니티', '네이버 카페', /cafe\.naver\.com$/], ['블로그·커뮤니티', '티스토리', /tistory\.com$/], ['블로그·커뮤니티', '브런치', /brunch\.co\.kr$/],
  ['블로그·커뮤니티', 'velog', /velog\.io$/], ['블로그·커뮤니티', 'Medium', /medium\.com$/], ['블로그·커뮤니티', '디시인사이드', /dcinside\.com$/], ['블로그·커뮤니티', '클리앙', /clien\.net$/], ['블로그·커뮤니티', '에펨코리아', /fmkorea\.com$/],
];
const UTM = { instagram: '인스타그램', insta: '인스타그램', facebook: '페이스북', kakao: '카카오', kakaotalk: '카카오', twitter: 'X (트위터)', x: 'X (트위터)', youtube: '유튜브', threads: '스레드', newsletter: '메일', email: '메일', mail: '메일' };
export const CHANNELS = ['검색', 'SNS', '블로그·커뮤니티', '메일', '직접', '기타 웹사이트'];
export function classify(host) {
  if (host.startsWith('utm:')) {
    const k = host.slice(4), name = UTM[k] || k;
    const hit = SOURCES.find((s) => s[1] === name);
    return [name === '메일' ? '메일' : hit ? hit[0] : 'SNS', name];
  }
  const hit = SOURCES.find((s) => s[2].test(host));
  return hit ? [hit[0], hit[1]] : ['기타 웹사이트', host];
}

// subId: 메일 링크의 구독자 토큰으로 식별된 구독자(없으면 0 = 신규·익명 방문자)
export async function recordView(req, nl, postId = 0, subId = 0) {
  try {
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || BOT.test(ua)) return;
    if (req.user && req.user.id === nl.owner_id) return; // 발행자 본인 조회는 제외
    const vid = createHash('sha256').update(`${process.env.SECRET || ''}|${req.ip}|${ua}|${now().slice(0, 10)}`).digest('base64url').slice(0, 16);
    const since = new Date(Date.now() - 30 * 60e3).toISOString();
    // 새로고침으로 부풀려지지 않도록 같은 방문자·같은 페이지는 30분에 한 번만
    if (await db.prepare('SELECT 1 x FROM page_views WHERE newsletter_id=? AND post_id=? AND vid=? AND created_at>?').get(nl.id, postId, vid, since)) return;
    let ref = '', refUrl = '', keyword = '';
    try {
      const u = new URL(req.headers.referer || '');
      const host = u.hostname.replace(/^www\./, '');
      if (host && !isOwnHost(host, req, nl)) {
        ref = host.slice(0, 80);
        refUrl = (host + u.pathname).replace(/\/$/, '').slice(0, 200); // 쿼리 문자열은 개인정보가 섞일 수 있어 저장하지 않는다
        if (SEARCH_RE.test(host)) keyword = String(u.searchParams.get('query') || u.searchParams.get('q') || u.searchParams.get('p') || '').trim().slice(0, 60);
      }
    } catch { /* referer 없음 */ }
    // 리퍼러가 없는 앱 링크(인스타그램·카카오톡 등)는 발행자가 링크에 붙인 utm_source 로 구분한다
    if (!ref && req.query?.utm_source) ref = 'utm:' + String(req.query.utm_source).toLowerCase().replace(/[^a-z0-9가-힣._-]/g, '').slice(0, 40);
    await db.prepare('INSERT INTO page_views(newsletter_id,post_id,vid,sub_id,referrer,ref_url,keyword,created_at) VALUES(?,?,?,?,?,?,?,?)').run(nl.id, postId, vid, subId || 0, ref, refUrl, keyword, now());
  } catch (e) { console.error('조회 기록 오류', e.message); }
}

const sinceIso = (days) => new Date(Date.now() - days * DAY).toISOString();
const SUBV = 'COALESCE(SUM(CASE WHEN sub_id>0 THEN 1 ELSE 0 END),0)';

export async function viewStats(nlId, days = 30) {
  const since = sinceIso(days);
  const tot = await db.prepare(`SELECT COUNT(*) views, COUNT(DISTINCT vid) visitors, ${SUBV} subv FROM page_views WHERE newsletter_id=? AND created_at>=?`).get(nlId, since);
  const rows = await db.prepare('SELECT substr(created_at,1,10) d, COUNT(*) n FROM page_views WHERE newsletter_id=? AND created_at>=? GROUP BY d').all(nlId, since);
  const byDay = new Map(rows.map((r) => [r.d, r.n]));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    daily.push([d, byDay.get(d) || 0]);
  }
  const top = await db.prepare(`SELECT v.post_id, p.subject, COUNT(*) n, COUNT(DISTINCT v.vid) visitors FROM page_views v JOIN posts p ON p.id=v.post_id
    WHERE v.newsletter_id=? AND v.created_at>=? AND v.post_id>0 GROUP BY v.post_id, p.subject ORDER BY n DESC LIMIT 5`).all(nlId, since);
  const sources = await db.prepare(`SELECT CASE WHEN referrer='' THEN '' ELSE referrer END src, COUNT(*) n FROM page_views
    WHERE newsletter_id=? AND created_at>=? GROUP BY src ORDER BY n DESC LIMIT 6`).all(nlId, since);
  return { views: tot.views, visitors: tot.visitors, subViews: tot.subv, daily, top, sources };
}

export async function postViewStats(postId) {
  return await db.prepare(`SELECT COUNT(*) views, COUNT(DISTINCT vid) visitors, ${SUBV} subv FROM page_views WHERE post_id=?`).get(postId);
}

// 유입 분석: 채널별 · 경로(출처)별 · 검색 키워드 · 유입 주소
export async function trafficStats(nlId, days = 30) {
  const since = sinceIso(days);
  const rows = await db.prepare(`SELECT referrer, COUNT(*) n, COALESCE(SUM(CASE WHEN sub_id>0 THEN 1 ELSE 0 END),0) sv FROM page_views
    WHERE newsletter_id=? AND created_at>=? GROUP BY referrer`).all(nlId, since);
  const channels = new Map(CHANNELS.map((c) => [c, 0]));
  const sources = new Map();
  const add = (channel, name, n) => {
    if (!n) return;
    channels.set(channel, channels.get(channel) + n);
    const k = channel + '|' + name;
    sources.set(k, { channel, name, n: (sources.get(k)?.n || 0) + n });
  };
  for (const r of rows) {
    if (!r.referrer) { add('메일', '구독자 메일 링크', r.sv); add('직접', '직접 접속', r.n - r.sv); continue; }
    const [ch, name] = classify(r.referrer);
    add(ch, name, r.n);
  }
  const total = [...channels.values()].reduce((a, b) => a + b, 0);
  const keywords = await db.prepare("SELECT keyword, COUNT(*) n FROM page_views WHERE newsletter_id=? AND created_at>=? AND keyword<>'' GROUP BY keyword ORDER BY n DESC LIMIT 15").all(nlId, since);
  const urls = await db.prepare("SELECT ref_url, COUNT(*) n FROM page_views WHERE newsletter_id=? AND created_at>=? AND ref_url<>'' GROUP BY ref_url ORDER BY n DESC LIMIT 15").all(nlId, since);
  return { total, channels: [...channels].map(([name, n]) => ({ name, n })), sources: [...sources.values()].sort((a, b) => b.n - a.n).slice(0, 20), keywords, urls };
}
