import { randomBytes } from 'node:crypto';
import { db, now, baseUrl, isPaid, dailySendLimit, sentLast24h } from './db.js';
import { sendMail } from './mail.js';
import { renderPost, toText, personalize } from './render.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();
const ownerEmail = (nl) => db.prepare('SELECT email FROM users WHERE id=?').get(nl.owner_id)?.email;

// 대상: 확정된 구독자 중 아직 못 받은 사람, 글의 audience(전체/유료/무료) 조건 적용
export const recipientsFor = (post) =>
  db.prepare(`SELECT s.* FROM subscribers s
    WHERE s.newsletter_id=? AND s.status='active'
      AND NOT EXISTS (SELECT 1 FROM send_log l WHERE l.post_id=? AND l.subscriber_id=s.id)
    ORDER BY s.id`).all(post.newsletter_id, post.id)
    .filter((s) => post.audience === 'paid' ? isPaid(s) : post.audience === 'free' ? !isPaid(s) : true);

// 한 명에게 발송하고 send_log에 기록 (일반 발행·시리즈 단계 공용)
export async function deliver(post, nl, sub) {
  const tok = randomBytes(12).toString('hex');
  let error = null;
  try {
    const html = renderPost(post, nl, { mode: 'email', sub, tok });
    await sendMail({
      to: sub.email, subject: personalize(post.subject, sub, { html: false }), html, text: toText(html), fromName: nl.name, replyTo: ownerEmail(nl),
      headers: { 'List-Unsubscribe': `<${baseUrl()}/unsubscribe/${sub.token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  } catch (e) {
    error = String(e.message || e).slice(0, 300);
    console.error(`발송 실패 ${sub.email}: ${error}`);
  }
  db.prepare('INSERT OR IGNORE INTO send_log(post_id,subscriber_id,tok,sent_at,error) VALUES(?,?,?,?,?)').run(post.id, sub.id, tok, now(), error);
  return !error;
}

export async function sendPost(postId) {
  if (running.has(postId)) return;
  const post = db.prepare("SELECT * FROM posts WHERE id=? AND kind='post'").get(postId);
  if (!post || !['draft', 'scheduled', 'sending'].includes(post.status)) return;
  const nl = db.prepare('SELECT * FROM newsletters WHERE id=?').get(post.newsletter_id);
  running.add(postId);
  try {
    db.prepare("UPDATE posts SET status='sending' WHERE id=?").run(postId);
    const delay = Number(process.env.SEND_DELAY_MS || 150);
    for (const sub of recipientsFor(post)) {
      // 24시간 발송 한도: 넘으면 일시 중단하고 1시간 뒤 스케줄러가 이어서 발송 (이미 보낸 사람은 건너뜀)
      if (sentLast24h(nl.id) >= dailySendLimit()) {
        db.prepare("UPDATE posts SET status='scheduled', scheduled_at=? WHERE id=?").run(new Date(Date.now() + 3600e3).toISOString(), postId);
        console.warn(`발송 한도 도달: 뉴스레터 ${nl.id}, 글 ${postId} — 1시간 뒤 재개`);
        return;
      }
      await deliver(post, nl, sub);
      await sleep(delay);
    }
    db.prepare("UPDATE posts SET status='sent', sent_at=? WHERE id=?").run(now(), postId);
  } finally {
    running.delete(postId);
  }
}

export async function sendTest(post, nl, user) {
  const sub = { name: user.name || '테스트', email: user.email, token: '' };
  const html = renderPost(post, nl, { mode: 'test', sub });
  await sendMail({ to: user.email, subject: `[TEST] ${personalize(post.subject, sub, { html: false })}`, html, text: toText(html), fromName: nl.name });
  return user.email;
}

// ---------- 자동화: 시리즈 ----------
const addDays = (d) => new Date(Date.now() + d * 864e5).toISOString();

// 구독 확정 시 호출: 'subscribe' 트리거 시리즈에 등록
export function enrollSubscriber(sub) {
  const list = db.prepare("SELECT id FROM series WHERE newsletter_id=? AND active=1 AND trigger='subscribe'").all(sub.newsletter_id);
  for (const s of list) {
    const first = db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' ORDER BY step_pos LIMIT 1").get(s.id);
    if (first) db.prepare('INSERT OR IGNORE INTO series_enroll(series_id,subscriber_id,next_pos,next_at) VALUES(?,?,?,?)')
      .run(s.id, sub.id, first.step_pos, addDays(first.delay_days));
  }
}

let ticking = false;
export async function processSeries() {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.prepare(`SELECT e.*, s.newsletter_id FROM series_enroll e JOIN series s ON s.id=e.series_id
      WHERE e.done=0 AND s.active=1 AND e.next_at<=? LIMIT 100`).all(now());
    for (const e of due) {
      if (sentLast24h(e.newsletter_id) >= dailySendLimit()) continue; // 한도 초과 시 다음 틱에 재시도
      const sub =db.prepare('SELECT * FROM subscribers WHERE id=?').get(e.subscriber_id);
      const step = db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' AND step_pos=?").get(e.series_id, e.next_pos);
      if (!sub || sub.status !== 'active' || !step) { db.prepare('UPDATE series_enroll SET done=1 WHERE id=?').run(e.id); continue; }
      const ok = step.cond === 'paid' ? isPaid(sub) : step.cond === 'free' ? !isPaid(sub) : true; // 조건부 발송
      if (ok && step.subject && step.body_md) await deliver(step, db.prepare('SELECT * FROM newsletters WHERE id=?').get(sub.newsletter_id), sub);
      const next = db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' AND step_pos>? ORDER BY step_pos LIMIT 1").get(e.series_id, e.next_pos);
      if (next) db.prepare('UPDATE series_enroll SET next_pos=?, next_at=? WHERE id=?').run(next.step_pos, addDays(next.delay_days), e.id);
      else db.prepare('UPDATE series_enroll SET done=1 WHERE id=?').run(e.id);
    }
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  for (const r of db.prepare("SELECT id FROM posts WHERE status='sending' AND kind='post'").all()) sendPost(r.id); // 중단된 발송 이어서
  setInterval(() => {
    for (const r of db.prepare("SELECT id FROM posts WHERE status='scheduled' AND kind='post' AND scheduled_at<=?").all(now())) sendPost(r.id);
    processSeries().catch((e) => console.error('시리즈 처리 오류', e));
  }, Number(process.env.TICK_MS || 30_000));
}
