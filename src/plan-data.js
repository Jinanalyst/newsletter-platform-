// 요금제 정의와 카드 HTML (요금제 페이지·랜딩 공용). 다른 모듈을 가져오지 않아 어디서든 쓸 수 있다
export const PLANS = {
  pro: { name: 'Pro', price: 15000, desc: '혼자 시작하는 발행자를 위한 플랜', features: ['이메일 월 10,000건 발송', '고급 분석', '사용자 지정 도메인', '기본 이메일 자동화', 'Lett 브랜딩 제거'] },
  business: { name: 'Business', price: 30000, desc: '브랜드와 여러 뉴스레터를 위한 플랜', features: ['Pro의 모든 기능', '이메일 월 50,000건 발송', '고급 이메일 자동화', '팀원 5명 초대', 'API 연동'] },
};

// 플랜별 기능 비교표: [기능, Free, Pro, Business]
const COMPARE = [
  ['뉴스레터 발행', '무제한', '무제한', '무제한'],
  ['무료 구독자', '무제한', '무제한', '무제한'],
  ['유료 콘텐츠 판매', '지원', '지원', '지원'],
  ['이메일 월 발송량', '1,000건', '10,000건', '50,000건'],
  ['기본 통계', '지원', '지원', '지원'],
  ['고급 분석', '—', '지원', '지원'],
  ['예약 발행', '지원', '지원', '지원'],
  ['사용자 지정 도메인', '—', '지원', '지원'],
  ['이메일 자동화', '—', '기본', '고급'],
  ['팀원 초대', '—', '—', '5명'],
  ['API 연동', '—', '—', '지원'],
  ['Lett 브랜딩 제거', '—', '지원', '지원'],
];
export const compareTable = (t) => `<h2 class="cmph">${t('플랜별 기능 비교')}</h2><div class="cmpw"><table class="cmp"><thead><tr><th>${t('기능')}</th><th>Free</th><th>Pro</th><th>Business</th></tr></thead><tbody>${COMPARE.map(([f, ...v]) => `<tr><td>${t(f)}</td>${v.map((c) => `<td>${t(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const won = (n) => '₩' + Number(n).toLocaleString('ko-KR');

// button(key, plan) → 카드 아래에 들어갈 버튼 HTML
export const planCards = (t, button) => `<div class="pls">${Object.entries(PLANS).map(([key, p]) => `<div class="pl${key === 'business' ? ' hot' : ''}"><h3>${p.name}</h3><p class="pld">${t(p.desc)}</p>
<div class="pr"><b>${won(p.price)}</b><span>/ ${t('월')}</span></div>
<ul>${p.features.map((f) => `<li>${t(f)}</li>`).join('')}</ul>${button(key, p)}</div>`).join('')}</div>`;

export const PLAN_CSS = `<style>.pls{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px;max-width:760px}
.pl{border:1px solid #E2E8F0;border-radius:20px;background:#fff;padding:26px;color:#0F172A}
.pl.hot{border-color:#3B82F6;box-shadow:0 18px 40px -26px #3B82F6}
.pl h3{margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.03em;color:#0F172A}.pl .pld{margin:0;color:#64748B;font-size:14px}
.pr{margin:14px 0}.pr b{font-size:32px;letter-spacing:-.04em}.pr span{color:#64748B;margin-left:4px}
.pl ul{padding-left:18px;margin:0 0 22px;font-size:15px}.pl li{margin:6px 0}
.pl .plbtn{display:inline-block;border:1px solid #0F172A;background:#0F172A;color:#fff;border-radius:999px;padding:10px 24px;font:inherit;font-size:14.5px;font-weight:600;text-decoration:none;cursor:pointer}
.pl .plbtn:disabled,.pl .plbtn.off{background:#F1F5F9;border-color:#E2E8F0;color:#64748B;cursor:not-allowed}
.cmph{margin:44px 0 12px;font-size:22px;font-weight:800;letter-spacing:-.03em}
.cmpw{overflow-x:auto;max-width:900px}.cmp{width:100%;border-collapse:collapse;font-size:15px;min-width:520px}
.cmp th,.cmp td{text-align:left;padding:13px 10px;border-bottom:1px solid #EEF2F6}.cmp th{font-weight:700;border-bottom-color:#E2E8F0}
.cmp td:not(:first-child){color:#475569}
@media(max-width:700px){.pls{grid-template-columns:1fr}}</style>`;
