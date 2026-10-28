// 데이터베이스 계층 (Postgres).
//  - 배포(Vercel 등): DATABASE_URL 이 있으면 Supabase/일반 Postgres 에 연결 (pg)
//  - 로컬 개발: DATABASE_URL 이 없으면 파일 기반 Postgres(PGlite, data/pgdata)를 사용 — 같은 SQL 로 동작
// 기존 코드와 같은 모양(db.prepare(sql).get/all/run)을 유지하되 모두 Promise 를 돌려준다.
import pg from 'pg';

const SCHEMA_VERSION = 5; // 컬럼을 추가하면 올려야 기존 DB 에도 스키마가 적용된다

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  pw_hash TEXT,
  google_id TEXT UNIQUE,
  supabase_id TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  sess_ver INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sb ON users(supabase_id);
CREATE TABLE IF NOT EXISTS newsletters (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  price_monthly INTEGER NOT NULL DEFAULT 0,
  price_yearly INTEGER NOT NULL DEFAULT 0,
  stripe_account TEXT NOT NULL DEFAULT '',
  rewards TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscribers (
  id SERIAL PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  token TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'web',
  tier TEXT NOT NULL DEFAULT 'free',
  paid_until TEXT,
  stripe_customer TEXT NOT NULL DEFAULT '',
  stripe_sub TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  ref_code TEXT,
  referred_by INTEGER,
  confirm_sent_at TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsub_at TEXT,
  UNIQUE (newsletter_id, email)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_ref ON subscribers(ref_code);
CREATE INDEX IF NOT EXISTS idx_sub_nl ON subscribers(newsletter_id, status);
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at TEXT,
  audience TEXT NOT NULL DEFAULT 'all',
  kind TEXT NOT NULL DEFAULT 'post',
  series_id INTEGER,
  step_pos INTEGER NOT NULL DEFAULT 0,
  delay_days INTEGER NOT NULL DEFAULT 0,
  cond TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  updated_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_nl ON posts(newsletter_id, status);
CREATE TABLE IF NOT EXISTS send_log (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  tok TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL,
  error TEXT,
  opened_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_log_post ON send_log(post_id);
CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  UNIQUE (post_id, url)
);
CREATE TABLE IF NOT EXISTS clicks (
  id SERIAL PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL,
  subscriber_id INTEGER NOT NULL,
  clicked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_click_post ON clicks(post_id);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  subscriber_id INTEGER,
  invoice_id TEXT UNIQUE,
  plan TEXT, amount INTEGER NOT NULL, fee INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'krw',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_nl ON payments(newsletter_id, created_at);
CREATE TABLE IF NOT EXISTS series (
  id SERIAL PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'subscribe',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS series_enroll (
  id SERIAL PRIMARY KEY,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  next_pos INTEGER NOT NULL,
  next_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  UNIQUE (series_id, subscriber_id)
);
CREATE TABLE IF NOT EXISTS post_versions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ver_post ON post_versions(post_id, id);
CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_hits (
  id SERIAL PRIMARY KEY,
  k TEXT NOT NULL,
  t BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_k ON rate_hits(k, t);
CREATE TABLE IF NOT EXISTS page_views (
  id SERIAL PRIMARY KEY,
  newsletter_id INTEGER NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL DEFAULT 0,
  vid TEXT NOT NULL,
  sub_id INTEGER NOT NULL DEFAULT 0,
  referrer TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pv_nl ON page_views(newsletter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pv_post ON page_views(post_id);
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS cover TEXT NOT NULL DEFAULT '';
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS accent TEXT NOT NULL DEFAULT '';
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS sns TEXT NOT NULL DEFAULT '';
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS cover_pos TEXT NOT NULL DEFAULT '';
ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS layout TEXT NOT NULL DEFAULT '';
`;

// ---------- 드라이버 ----------
let driverPromise;
// Vercel 의 Supabase 연동은 POSTGRES_URL 로 넣어주므로 그것도 받는다
const dbUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const useRemote = () => !!dbUrl();

// 연결 문자열의 sslmode 등은 pg 에서 아래 ssl 설정을 덮어써 인증서 검증 오류(self-signed certificate)를 낸다 → 제거
function stripSslParams(url) {
  try {
    const u = new URL(url);
    for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  } catch { return url; }
}

async function makeDriver() {
  if (useRemote()) {
    pg.types.setTypeParser(20, (v) => Number(v));    // bigint (COUNT 등) → number
    pg.types.setTypeParser(1700, (v) => Number(v));  // numeric (SUM 등) → number
    const url = stripSslParams(dbUrl());
    const local = /@(localhost|127\.0\.0\.1)/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX || 3),       // 서버리스: 인스턴스당 연결을 적게
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: process.env.DATABASE_SSL_VERIFY === '1' },
    });
    pool.on('error', (e) => console.error('DB 풀 오류', e.message));
    return {
      query: (text, params) => pool.query(text, params),
      async applySchema() {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query('SELECT pg_advisory_xact_lock(727001)'); // 동시에 뜬 인스턴스끼리 스키마 생성 경쟁 방지
          await c.query(SCHEMA);
          await c.query("INSERT INTO meta(key,value) VALUES('schema',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [String(SCHEMA_VERSION)]);
          await c.query('COMMIT');
        } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
      },
    };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL 이 설정되지 않았습니다. Vercel 환경 변수에 Supabase Postgres 연결 문자열을 넣어주세요.');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || 'data/pgdata';
  if (dir !== 'memory') (await import('node:fs')).mkdirSync((await import('node:path')).dirname(dir), { recursive: true }); // PGlite 는 상위 폴더를 만들지 않는다
  const lite =new PGlite({ dataDir: dir === 'memory' ? undefined : dir, parsers: { 20: (v) => Number(v), 1700: (v) => Number(v) } });
  await lite.waitReady;
  return {
    query: (text, params) => lite.query(text, params),
    async applySchema() {
      await lite.exec(SCHEMA);
      await lite.query("INSERT INTO meta(key,value) VALUES('schema',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [String(SCHEMA_VERSION)]);
    },
  };
}

function init() {
  driverPromise ??= (async () => {
    const d = await makeDriver();
    // 스키마 버전 확인 (meta 테이블이 없으면 새 DB). 오류에 의존하지 않고 to_regclass 로 존재 여부를 먼저 본다
    let ok = false;
    if ((await d.query("SELECT to_regclass('public.meta') AS t")).rows[0]?.t)
      ok = (await d.query("SELECT value FROM meta WHERE key='schema'")).rows[0]?.value === String(SCHEMA_VERSION);
    if (!ok) await d.applySchema();
    return d;
  })().catch((e) => { driverPromise = undefined; throw e; });
  return driverPromise;
}

// SQLite 스타일(? 자리표시자, INSERT OR IGNORE) → Postgres
const cache = new Map();
function translate(sql) {
  let t = cache.get(sql);
  if (t) return t;
  let s = sql;
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(s);
  if (ignore) s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
  let i = 0;
  s = s.replace(/\?/g, () => '$' + ++i);
  if (/^\s*INSERT/i.test(s)) {
    if (ignore) s += ' ON CONFLICT DO NOTHING';
    if (!/RETURNING/i.test(s)) s += ' RETURNING id';
  }
  cache.set(sql, s);
  return s;
}

async function run(sql, params) {
  const d = await init();
  try {
    return await d.query(translate(sql), params.map((v) => (v === undefined ? null : v)));
  } catch (e) {
    // 주소의 잘못된 숫자 ID(예: /posts/abc) 같은 입력은 "결과 없음"으로 처리
    if (e.code === '22P02' || e.code === '22003') return { rows: [], rowCount: 0, affectedRows: 0 };
    throw e;
  }
}

export const db = {
  prepare(sql) {
    return {
      get: async (...p) => (await run(sql, p)).rows[0],
      all: async (...p) => (await run(sql, p)).rows,
      run: async (...p) => {
        const r = await run(sql, p);
        return { changes: r.rowCount ?? r.affectedRows ?? 0, lastInsertRowid: r.rows?.[0]?.id };
      },
    };
  },
  ready: () => init().then(() => true),
};

// ---------- 공통 도우미 ----------
export const isPaid = (s) => !!s && s.tier === 'paid' && (!s.paid_until || s.paid_until > new Date().toISOString());
export const hasPaid = (nl) => nl.price_monthly > 0 || nl.price_yearly > 0;
export const feePct = () => Math.min(50, Math.max(0, Number(process.env.PLATFORM_FEE_PCT ?? 10)));
export const now = () => new Date().toISOString();

export const baseUrl = () => {
  const b = process.env.BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || `http://localhost:${process.env.PORT || 3000}`;
  return b.replace(/\/+$/, '');
};

// 쉼표/#로 구분된 태그 문자열 정리 (중복 제거, 최대 10개·30자)
export const cleanTags = (s) => [...new Set(String(s || '').split(/[,#\n]/).map((t) => t.trim().slice(0, 30)).filter(Boolean))].slice(0, 10).join(',');

export const dailySendLimit = () => Math.max(1, Number(process.env.DAILY_SEND_LIMIT || 1000));
export const sentLast24h = async (newsletterId) => (await db.prepare(`SELECT COUNT(*) n FROM send_log l JOIN posts p ON p.id=l.post_id
  WHERE p.newsletter_id=? AND l.sent_at>?`).get(newsletterId, new Date(Date.now() - 864e5).toISOString())).n;
