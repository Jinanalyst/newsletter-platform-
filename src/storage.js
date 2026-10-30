// 이미지 저장소.
//  - 배포: Supabase Storage (공개 버킷). 서버에서만 SUPABASE_SERVICE_ROLE_KEY 로 업로드하고, 키는 브라우저로 나가지 않는다.
//  - 로컬 개발: SUPABASE_SERVICE_ROLE_KEY 가 없으면 uploads/ 폴더에 저장 (Vercel 에서는 파일 시스템 쓰기가 불가하므로 사용하지 않음)
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = () => process.env.SUPABASE_BUCKET || 'uploads';
export const storageRemote = () => !!(BASE() && KEY());
const publicPrefix = () => `${BASE()}/storage/v1/object/public/${BUCKET()}/`;

// 이 서비스가 저장한 이미지 주소인지 (로고 등 사용자 입력 검증용)
export const isOwnImageUrl = (u) => {
  const s = String(u || '');
  if (/^\/uploads\/[\w.]+$/.test(s)) return true;
  return !!BASE() && s.startsWith(publicPrefix()) && /^[\w.]+$/.test(s.slice(publicPrefix().length));
};

let bucketReady;
function ensureBucket() {
  bucketReady ??= fetch(`${BASE()}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, apikey: KEY(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET(), name: BUCKET(), public: true, file_size_limit: 4 * 1024 * 1024, allowed_mime_types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] }),
  }).then(() => true, () => false); // 이미 있으면 오류 응답이 오지만 무시한다
  return bucketReady;
}

export async function saveImage(buf, ext, mime) {
  const name = `${randomBytes(12).toString('hex')}.${ext}`;
  if (storageRemote()) {
    await ensureBucket();
    const r = await fetch(`${BASE()}/storage/v1/object/${BUCKET()}/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY()}`, apikey: KEY(), 'Content-Type': mime, 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
      body: buf,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.error('Storage 업로드 실패', r.status, await r.text().catch(() => ''));
      throw new Error('이미지를 저장하지 못했습니다. 저장소 설정을 확인하세요.');
    }
    return publicPrefix() + name;
  }
  if (process.env.VERCEL) throw new Error('이미지 저장소가 설정되지 않았습니다. 환경 변수 SUPABASE_SERVICE_ROLE_KEY 를 설정하세요.');
  mkdirSync('uploads', { recursive: true });
  writeFileSync(`uploads/${name}`, buf);
  return `/uploads/${name}`;
}

// ---------- 강의 영상·자료 (비공개) ----------
// Vercel 함수는 요청 본문이 4.5MB 로 제한되므로 영상은 서버를 거치지 않는다.
//  - 배포: 서버가 Supabase 서명 업로드 주소만 발급 → 브라우저가 Storage 로 직접 PUT. 재생도 짧게 유효한 서명 주소로만.
//  - 로컬 개발: 서버가 data/media/ 에 직접 저장
const MEDIA_BUCKET = () => process.env.SUPABASE_MEDIA_BUCKET || 'course-media';
const sbHeaders = () => ({ Authorization: `Bearer ${KEY()}`, apikey: KEY(), 'Content-Type': 'application/json' });
export const MEDIA_DIR = 'data/media';

let mediaBucketReady;
const ensureMediaBucket = () => (mediaBucketReady ??= fetch(`${BASE()}/storage/v1/bucket`, {
  method: 'POST', headers: sbHeaders(), body: JSON.stringify({ id: MEDIA_BUCKET(), name: MEDIA_BUCKET(), public: false }),
}).then(() => true, () => false)); // 이미 있으면 오류 응답이 오지만 무시한다

// → { url, headers } : 브라우저가 이 주소로 파일을 PUT 한다
export async function createMediaUpload(name, mime) {
  if (storageRemote()) {
    await ensureMediaBucket();
    const r = await fetch(`${BASE()}/storage/v1/object/upload/sign/${MEDIA_BUCKET()}/${name}`, { method: 'POST', headers: sbHeaders(), body: '{}', signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { console.error('업로드 주소 발급 실패', r.status, JSON.stringify(j)); throw new Error('업로드를 시작하지 못했습니다. 저장소 설정을 확인하세요.'); }
    return { url: `${BASE()}/storage/v1${j.url}`, headers: { 'Content-Type': mime } };
  }
  if (process.env.VERCEL) throw new Error('저장소가 설정되지 않았습니다. 환경 변수 SUPABASE_SERVICE_ROLE_KEY 를 설정하세요.');
  mkdirSync(MEDIA_DIR, { recursive: true });
  return { url: `/create/upload/${name}`, headers: { 'Content-Type': 'application/octet-stream' } };
}

// 원격 저장소의 5분짜리 재생·다운로드 주소 (로컬 개발이면 null)
export async function signedMediaUrl(name, seconds = 300) {
  if (!storageRemote()) return null;
  const r = await fetch(`${BASE()}/storage/v1/object/sign/${MEDIA_BUCKET()}/${name}`, { method: 'POST', headers: sbHeaders(), body: JSON.stringify({ expiresIn: seconds }), signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.signedURL ? `${BASE()}/storage/v1${j.signedURL}` : null;
}
