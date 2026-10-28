// 발송 엔진 (서버리스 대응).
//  - 메모리 상태에 의존하지 않는다: 여러 인스턴스/크론이 동시에 돌아도 같은 사람에게 두 번 보내지 않도록
//    수신자를 DB(send_log, UNIQUE(post_id, subscriber_id))에 먼저 "선점"한 뒤 발송한다.
//  - 한 번의 호출은 시간 예산 안에서만 처리하고, 남은 사람은 다음 크론 틱(/api/cron)이 이어서 보낸다.
import { randomBytes } from 'node:crypto';
import { db, now, baseUrl, isPaid, dailySendLimit, sentLast24h } from './db.js';
import { sendMail } from './mail.js';
import { renderPost, toText, personalize } from './render.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delayMs = () => Number(process.env.SEND_DELAY_MS ?? 100);
const ownerEmail = async (nl) => (await db.prepare('SELECT email FROM users WHERE id=?').get(nl.owner_id))?.email;

// 대상: 확정된 구독자 중 아직 못 받은 사람, 글의 audience(전체/유료/무료) 조건 적용
export const recipientsFor = async (post, limit = 100000) =>
  (await db.prepare(`SELECT s.* FROM subscribers s
    WHERE s.newsletter_id=? AND s.status='active'
      AND NOT EXISTS (SELECT 1 FROM send_log l WHERE l.post_id=? AND l.subscriber_id=s.id)
    ORDER BY s.id LIMIT ?`).all(post.newsletter_id, post.id, limit))
    .filter((s) => (post.audience === 'paid' ? isPaid(s) : post.audience === 'free' ? !isPaid(s) : true));

// 한 명에게 발송 (일반 발행·시리즈 단계 공용). 이미 다른 곳에서 선점/발송했다면 건너뛰고 false.
export async function deliver(post, nl, sub) {
  const tok = randomBytes(12).toString('hex');
  const claim = await db.prepare('INSERT OR IGNORE INTO send_log(post_id,subscriber_id,tok,sent_at,error) VALUES(?,?,?,?,NULL)').run(post.id, sub.id, tok, now());
  if (!claim.changes) return false;
  try {
    const html = await renderPost(post, nl, { mode: 'email', sub, tok });
    await sendMail({
      to: sub.email, subject: personalize(post.subject, sub, { html: false }), html, text: toText(html), fromName: nl.name, replyTo: await ownerEmail(nl),
      headers: { 'List-Unsubscribe': `<${baseUrl()}/unsubscribe/${sub.token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    return true;
  } catch (e) {
    const error = String(e.message || e).slice(0, 300);
    console.error(`발송 실패 ${sub.email}: ${error}`);
    await db.prepare('UPDATE send_log SET error=? WHERE id=?').run(error, claim.lastInsertRowid);
    return false;
  }
}

// 글 하나를 시간 예산(ms) 안에서 최대한 발송. 다 보냈으면 'sent', 남았으면 'sending' 으로 두어 크론이 이어받는다.
export async function sendBatch(postId, budgetMs = 20_000) {
  const deadline = Date.now() + budgetMs;
  const post = await db.prepare("SELECT * FROM posts WHERE id=? AND kind='post'").get(postId);
  if (!post || !['draft', 'scheduled', 'sending'].includes(post.status)) return { done: true, sent: 0 };
  const nl = await db.prepare('SELECT * FROM newsletters WHERE id=?').get(post.newsletter_id);
  await db.prepare("UPDATE posts SET status='sending' WHERE id=? AND status IN ('draft','scheduled')").run(postId); // 원자적 전이
  let sent = 0;
  for (;;) {
    const batch = await recipientsFor(post, 50);
    if (!batch.length) {
      await db.prepare("UPDATE posts SET status='sent', sent_at=? WHERE id=? AND status='sending'").run(now(), postId);
      return { done: true, sent };
    }
    for (const sub of batch) {
      if (Date.now() > deadline) return { done: false, sent };
      // 24시간 발송 한도: 넘으면 일시 중단하고 1시간 뒤 다시 시도
      if ((await sentLast24h(nl.id)) >= dailySendLimit()) {
        await db.prepare("UPDATE posts SET status='scheduled', scheduled_at=? WHERE id=?").run(new Date(Date.now() + 3600e3).toISOString(), postId);
        console.warn(`발송 한도 도달: 뉴스레터 ${nl.id}, 글 ${postId} — 1시간 뒤 재개`);
        return { done: false, sent, limited: true };
      }
      if (await deliver(post, nl, sub)) sent++;
      if (delayMs()) await sleep(delayMs());
    }
  }
}

// 대시보드의 "지금 발송": 요청 안에서 먼저 처리(서버리스는 응답 후 백그라운드 실행이 보장되지 않음)하고 남은 것은 크론이 이어받는다
export const sendPost = (postId) => sendBatch(postId, Number(process.env.SEND_INLINE_MS || 20_000));

export async function sendTest(post, nl, user) {
  const sub = { name: user.name || '테스트', email: user.email, token: '' };
  const html = await renderPost(post, nl, { mode: 'test', sub });
  await sendMail({ to: user.email, subject: `[TEST] ${personalize(post.subject, sub, { html: false })}`, html, text: toText(html), fromName: nl.name });
  return user.email;
}

// ---------- 자동화: 시리즈 ----------
const addDays = (d) => new Date(Date.now() + d * 864e5).toISOString();

// 구독 확정 시 호출: 'subscribe' 트리거 시리즈에 등록
export async function enrollSubscriber(sub) {
  const list = await db.prepare("SELECT id FROM series WHERE newsletter_id=? AND active=1 AND trigger='subscribe'").all(sub.newsletter_id);
  for (const s of list) {
    const first = await db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' ORDER BY step_pos LIMIT 1").get(s.id);
    if (first) await db.prepare('INSERT OR IGNORE INTO series_enroll(series_id,subscriber_id,next_pos,next_at) VALUES(?,?,?,?)')
      .run(s.id, sub.id, first.step_pos, addDays(first.delay_days));
  }
}

export async function processSeries(budgetMs = 20_000) {
  const deadline = Date.now() + budgetMs;
  const due = await db.prepare(`SELECT e.*, s.newsletter_id FROM series_enroll e JOIN series s ON s.id=e.series_id
    WHERE e.done=0 AND s.active=1 AND e.next_at<=? ORDER BY e.next_at LIMIT 100`).all(now());
  let handled = 0;
  for (const e of due) {
    if (Date.now() > deadline) break;
    if ((await sentLast24h(e.newsletter_id)) >= dailySendLimit()) continue; // 한도 초과 시 다음 틱에 재시도
    const sub = await db.prepare('SELECT * FROM subscribers WHERE id=?').get(e.subscriber_id);
    const step = await db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' AND step_pos=?").get(e.series_id, e.next_pos);
    if (!sub || sub.status !== 'active' || !step) { await db.prepare('UPDATE series_enroll SET done=1 WHERE id=?').run(e.id); continue; }
    const ok = step.cond === 'paid' ? isPaid(sub) : step.cond === 'free' ? !isPaid(sub) : true; // 조건부 발송
    if (ok && step.subject && step.body_md) await deliver(step, await db.prepare('SELECT * FROM newsletters WHERE id=?').get(sub.newsletter_id), sub);
    const next = await db.prepare("SELECT * FROM posts WHERE series_id=? AND kind='step' AND step_pos>? ORDER BY step_pos LIMIT 1").get(e.series_id, e.next_pos);
    if (next) await db.prepare('UPDATE series_enroll SET next_pos=?, next_at=? WHERE id=? AND next_pos=?').run(next.step_pos, addDays(next.delay_days), e.id, e.next_pos);
    else await db.prepare('UPDATE series_enroll SET done=1 WHERE id=?').run(e.id);
    handled++;
  }
  return handled;
}

// 주기 작업 한 번: 예약 시각이 된 글 발송 + 발송 중인 글 이어서 보내기 + 시리즈 단계 발송
// (로컬은 setInterval, Vercel 등 서버리스는 /api/cron 이 주기적으로 호출)
export async function tick(budgetMs = 50_000) {
  const deadline = Date.now() + budgetMs;
  const posts = await db.prepare(`SELECT id FROM posts WHERE kind='post' AND (status='sending' OR (status='scheduled' AND scheduled_at<=?))
    ORDER BY id LIMIT 20`).all(now());
  let sent = 0;
  for (const p of posts) {
    if (Date.now() > deadline) break;
    sent += (await sendBatch(p.id, deadline - Date.now())).sent;
  }
  const series = Date.now() < deadline ? await processSeries(deadline - Date.now()) : 0;
  return { posts: posts.length, sent, series };
}

export function startScheduler() {
  if (process.env.VERCEL || process.env.NO_SCHEDULER) return; // 서버리스에서는 크론 엔드포인트가 대신한다 (NO_SCHEDULER=1: 이 프로세스의 내장 타이머를 끔)
  const every = Number(process.env.TICK_MS || 30_000);
  tick(Math.max(5_000, every - 2_000)).catch((e) => console.error('주기 작업 오류', e)); // 시작 시 중단된 발송 이어서
  setInterval(() => tick(Math.max(5_000, every - 2_000)).catch((e) => console.error('주기 작업 오류', e)), every);
}
