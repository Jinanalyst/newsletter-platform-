// 공개 페이지·글 페이지 조회수 집계. 쿠키 없이 (IP+UA+날짜) 해시로 하루 단위 방문자를 구분한다.
import { createHash } from 'node:crypto';
import { db, now } from './db.js';

const BOT = /bot|crawl|spider|slurp|scrap|facebookexternalhit|whatsapp|embedly|curl|wget|python|httpclient|headless|monitor|uptime|lighthouse/i;
const DAY = 864e5;

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
    let ref = '';
    try {
      const u = new URL(req.headers.referer || '');
      if (u.hostname && u.hostname !== req.hostname) ref = u.hostname.replace(/^www\./, '').slice(0, 80);
    } catch { /* referer 없음 */ }
    await db.prepare('INSERT INTO page_views(newsletter_id,post_id,vid,sub_id,referrer,created_at) VALUES(?,?,?,?,?,?)').run(nl.id, postId, vid, subId || 0, ref, now());
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
