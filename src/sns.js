// 발행자의 SNS·외부 링크: 설정 폼 입력 → 검증 → JSON 저장 → 공개 페이지 아이콘 렌더
import { h } from './render.js';

const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// key · 표시 이름 · 입력 예시 · 아이콘
export const SNS = [
  ['instagram', '인스타그램', 'https://instagram.com/아이디', svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6" fill="currentColor"/>')],
  ['x', 'X (트위터)', 'https://x.com/아이디', svg('<path d="M4 4l16 16M20 4L4 20"/>')],
  ['threads', '스레드', 'https://threads.net/@아이디', svg('<path d="M16.5 9.5C16 6.5 14 5 12 5c-3 0-5 2.5-5 7s2 7 5 7c2.6 0 4.5-1.600 4.500-3.800 0-2.300-2-3.200-4.500-3.200-1.800 0-2.800.8-2.800 1.900 0 1 1 1.700 2.200 1.700 2 0 3.100-1.400 3.100-4.600"/>')],
  ['youtube', '유튜브', 'https://youtube.com/@채널', svg('<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.500v5l4.500-2.500z" fill="currentColor"/>')],
  ['facebook', '페이스북', 'https://facebook.com/페이지', svg('<path d="M14 8.500h2.500V5H14c-2 0-3.500 1.500-3.500 3.500V11H8v3.500h2.500V21H14v-6.500h2.500L17 11h-3V8.500z"/>')],
  ['blog', '블로그', 'https://blog.naver.com/아이디', svg('<path d="M5 4.500h14v15H5z"/><path d="M8.500 9h7M8.500 12.500h7M8.500 16h4"/>')],
  ['website', '웹사이트', 'https://내사이트.com', svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>')],
];

// 'instagram.com/abc' 처럼 http 가 빠진 입력은 https 를 붙이고, 그 밖의 형식(javascript: 등)은 버린다
function cleanUrl(v) {
  let s = String(v || '').trim().slice(0, 300);
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  if (!/^https?:\/\/[^\s/.]+\.[^\s]+$/i.test(s)) return '';
  return s;
}

// 폼 본문(sns_instagram 등) → 저장용 JSON 문자열
export function parseSns(body) {
  const out = {};
  for (const [k] of SNS) { const u = cleanUrl(body[`sns_${k}`]); if (u) out[k] = u; }
  return JSON.stringify(out);
}

export function readSns(nl) {
  try { return JSON.parse(nl.sns || '{}') || {}; } catch { return {}; }
}

// 설정 폼의 입력 칸들
export function snsFields(nl = {}) {
  const v = readSns(nl);
  return SNS.map(([k, label, ph, icon]) => `<div class="snsrow"><span class="snsico">${icon}</span><input name="sns_${k}" value="${h(v[k] || '')}" placeholder="${h(label)} — ${h(ph)}" aria-label="${h(label)}" maxlength="300"></div>`).join('');
}

// 공개 페이지에 표시할 아이콘 링크들
export function snsLinks(nl) {
  const v = readSns(nl);
  const items = SNS.filter(([k]) => v[k]).map(([k, label, , icon]) => `<a href="${h(v[k])}" target="_blank" rel="noopener noreferrer me" title="${h(label)}" aria-label="${h(label)}">${icon}</a>`);
  return items.length ? `<div class="lp-sns">${items.join('')}</div>` : '';
}
