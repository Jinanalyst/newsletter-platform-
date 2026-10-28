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
