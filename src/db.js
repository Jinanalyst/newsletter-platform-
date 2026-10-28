import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });
export const db = new DatabaseSync('data/newsletter.db');

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  pw_hash TEXT,                 -- 소셜 전용 계정은 NULL
  google_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS newsletters (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | unsubscribed
  token TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'web',
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsub_at TEXT,
  UNIQUE (newsletter_id, email)
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | scheduled | sending | sent
  scheduled_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS send_log (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  tok TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL,
  error TEXT,
  opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, subscriber_id)
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  UNIQUE (post_id, url)
);
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL,
  subscriber_id INTEGER NOT NULL,
  clicked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sub_nl ON subscribers(newsletter_id, status);
CREATE INDEX IF NOT EXISTS idx_post_nl ON posts(newsletter_id, status);
CREATE INDEX IF NOT EXISTS idx_log_post ON send_log(post_id);
CREATE INDEX IF NOT EXISTS idx_click_post ON clicks(post_id);
`);

// ---------- 2단계 확장 (기존 DB에도 안전하게 적용) ----------
const addCol = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
// 유료 구독 / 수익
addCol('newsletters', 'price_monthly', 'INTEGER NOT NULL DEFAULT 0');   // 0 = 유료 구독 미운영 (원 단위)
addCol('newsletters', 'price_yearly', 'INTEGER NOT NULL DEFAULT 0');
addCol('newsletters', 'stripe_account', "TEXT NOT NULL DEFAULT ''");     // 발행자의 Stripe Connect 계정(acct_...)
addCol('newsletters', 'rewards', "TEXT NOT NULL DEFAULT ''");            // 추천 보상: 줄마다 "3:스티커팩"
addCol('subscribers', 'tier', "TEXT NOT NULL DEFAULT 'free'");           // free | paid
addCol('subscribers', 'paid_until', 'TEXT');                             // NULL이면서 paid = 수동 지정(무기한)
addCol('subscribers', 'stripe_customer', "TEXT NOT NULL DEFAULT ''");
addCol('subscribers', 'stripe_sub', "TEXT NOT NULL DEFAULT ''");
addCol('subscribers', 'plan', "TEXT NOT NULL DEFAULT ''");               // monthly | yearly
// 성장
addCol('subscribers', 'ref_code', 'TEXT');
addCol('subscribers', 'referred_by', 'INTEGER');
// 글 구분: post(일반 발행) | step(시리즈 단계, 자동 발송)
addCol('posts', 'audience', "TEXT NOT NULL DEFAULT 'all'");              // all | paid | free
addCol('posts', 'kind', "TEXT NOT NULL DEFAULT 'post'");
addCol('posts', 'series_id', 'INTEGER');
addCol('posts', 'step_pos', 'INTEGER NOT NULL DEFAULT 0');
addCol('posts', 'delay_days', 'INTEGER NOT NULL DEFAULT 0');
addCol('posts', 'cond', "TEXT NOT NULL DEFAULT ''");                     // '' | free | paid

// 운영 보강: 이메일 인증, 세션 버전(비밀번호 변경 시 기존 로그인 무효화), 확인 메일 쿨다운
addCol('users', 'verified', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'sess_ver', 'INTEGER NOT NULL DEFAULT 0');
addCol('subscribers', 'confirm_sent_at', 'TEXT');
addCol('users', 'supabase_id', 'TEXT');                   // Supabase Auth 사용자 ID (로그인을 Supabase가 처리할 때)
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sb ON users(supabase_id)');
db.exec(`
CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- verify | reset
  token_hash TEXT NOT NULL UNIQUE, -- 원문은 메일로만 전달, DB에는 해시만 저장
  expires_at TEXT NOT NULL
);
`);
// 편집 도구: 분류(카테고리·태그), 가져오기 출처, 버전 기록, 템플릿
addCol('posts', 'category', "TEXT NOT NULL DEFAULT ''");
addCol('posts', 'tags', "TEXT NOT NULL DEFAULT ''");        // 쉼표 구분
addCol('posts', 'source_url', 'TEXT');                       // 외부에서 가져온 글의 원본 주소(중복 가져오기 방지)
addCol('posts', 'updated_at', 'TEXT');
addCol('newsletters', 'categories', "TEXT NOT NULL DEFAULT ''"); // 쉼표 구분, 글에서 하나 선택
db.exec(`
CREATE TABLE IF NOT EXISTS post_versions (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'auto',   -- auto | manual | restore | initial
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ver_post ON post_versions(post_id, id);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);
// 쉼표/#로 구분된 태그 문자열 정리 (중복 제거, 최대 10개·30자)
export const cleanTags = (s) => [...new Set(String(s || '').split(/[,#\n]/).map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, 10).join(',');

export const dailySendLimit =() => Math.max(1, Number(process.env.DAILY_SEND_LIMIT || 1000));
export const sentLast24h = (newsletterId) => db.prepare(`SELECT COUNT(*) n FROM send_log l JOIN posts p ON p.id=l.post_id
  WHERE p.newsletter_id=? AND l.sent_at>?`).get(newsletterId, new Date(Date.now() - 864e5).toISOString()).n;

db.exec(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  subscriber_id INTEGER,
  invoice_id TEXT UNIQUE,            -- Stripe invoice (중복 웹훅 방지)
  plan TEXT, amount INTEGER NOT NULL, fee INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'krw',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'subscribe',   -- subscribe: 구독 확정 시 자동 등록
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS series_enroll (
  id INTEGER PRIMARY KEY,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  next_pos INTEGER NOT NULL,
  next_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  UNIQUE (series_id, subscriber_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_ref ON subscribers(ref_code);
CREATE INDEX IF NOT EXISTS idx_pay_nl ON payments(newsletter_id, created_at);
`);

export const isPaid = (s) => !!s && s.tier === 'paid' && (!s.paid_until || s.paid_until > new Date().toISOString());
export const hasPaid = (nl) => nl.price_monthly > 0 || nl.price_yearly > 0;
export const feePct = () => Math.min(50, Math.max(0, Number(process.env.PLATFORM_FEE_PCT ?? 10)));

export const now = () => new Date().toISOString();
export const baseUrl = () =>
  (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
