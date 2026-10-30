// 이메일 인증을 마친 상태의 테스트 계정을 Supabase Auth 에 만든다 (PG사 심사용 등).
// 이미 가입만 해 둔(인증 전) 계정이면 새로 만들지 않고 그 계정만 "인증 완료"로 바꾼다. 비밀번호를 함께 주면 비밀번호도 바꾼다.
// 서버 비밀 키(SUPABASE_SERVICE_ROLE_KEY)가 필요하므로 .env 가 있는 내 컴퓨터에서만 실행한다.
//   node --env-file=.env scripts/create-test-account.mjs [이메일] [비밀번호]
// 비밀번호를 생략하면 무작위로 만들어 이 터미널에만 한 번 보여준다. 처음 로그인할 때 서비스 DB 에 사용자가 자동으로 연결된다.
import { randomBytes } from 'node:crypto';

const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const email = (process.argv[2] || 'test@lett.live').toLowerCase();
const generated = !process.argv[3];
const password = process.argv[3] || randomBytes(12).toString('base64url');

if (!base || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다. (.env 를 확인하세요)'); process.exit(1); }
if (password.length < 8) { console.error('비밀번호는 8자 이상이어야 합니다.'); process.exit(1); }

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const api = (path, method, body) => fetch(`${base}/auth/v1/admin/${path}`, { method, headers: H, body: body && JSON.stringify(body) });

// 이미 있는 계정인지 먼저 찾는다
let existing = null;
for (let page = 1; page <= 20 && !existing; page++) {
  const lr = await api(`users?page=${page}&per_page=1000`, 'GET');
  const lj = await lr.json().catch(() => ({}));
  if (!lr.ok) { console.error(`계정 조회 실패 (${lr.status}): ${lj.msg || lj.message || ''}`); process.exit(1); }
  existing = (lj.users || []).find((u) => (u.email || '').toLowerCase() === email) || null;
  if (!lj.users?.length || lj.users.length < 1000) break;
}

if (existing) {
  const patch = { email_confirm: true, ...(process.argv[3] ? { password } : {}) };
  const ur = await api(`users/${existing.id}`, 'PUT', patch);
  const uj = await ur.json().catch(() => ({}));
  if (!ur.ok) { console.error(`실패 (${ur.status}): ${uj.msg || uj.message || JSON.stringify(uj)}`); process.exit(1); }
  console.log(`${email} 계정을 이메일 인증 완료 상태로 바꿨습니다.${process.argv[3] ? ' (비밀번호도 변경됨)' : ' (비밀번호는 그대로)'}`);
  process.exit(0);
}

const r = await api('users', 'POST', { email, password, email_confirm: true, user_metadata: { name: 'Test' } });
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`실패 (${r.status}): ${j.msg || j.message || JSON.stringify(j)}`); process.exit(1); }
console.log(`만들었습니다: ${email} (이메일 인증 완료 상태)`);
if (generated) console.log(`비밀번호: ${password}   ← 지금만 표시됩니다. 안전한 곳에 적어 두세요.`);
