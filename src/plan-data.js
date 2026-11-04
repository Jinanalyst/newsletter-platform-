// 요금제 정의와 카드 HTML (요금제 페이지·랜딩 공용). 다른 모듈을 가져오지 않아 어디서든 쓸 수 있다
// 가격·수수료·한도를 바꿀 때는 PLAN_CONFIG 만 고치면 요금제 페이지, 비교표, 기능 제한, 수수료 계산에 모두 반영된다.
//  - 수수료는 결제마다 금액·요율을 기록하므로 바꿔도 지난 결제 내역은 그대로다
//  - 페이앱에는 등록된 자동 결제의 금액을 바꾸는 기능이 없어, 가격을 바꾸면 새로 결제하는 사람부터 적용된다
// subscribers: null 이면 무제한 · seats: 소유자 포함 인원 · stats: 1 기본, 2 상세, 3 고급
// automation: 0 없음, 1 기본(메일 단계·며칠 뒤 발송), 2 고급(조건부 발송·일시정지·날짜 지정)
export const PLAN_CONFIG = {
  free: { name: 'Free', price: 0, feePct: 8, subscribers: 1000, monthly: 2000, seats: 1, stats: 1, groups: false, domain: false, automation: 0, api: false, branding: false, desc: '누구나 무료로 시작하는 플랜' },
  pro: { name: 'Pro', price: 9900, feePct: 4, subscribers: 10000, monthly: 20000, seats: 1, stats: 2, groups: true, domain: true, automation: 1, api: false, branding: true, desc: '독자가 늘어나는 크리에이터를 위한 플랜' },
  business: { name: 'Business', price: 29900, feePct: 2, subscribers: null, monthly: 100000, seats: 5, stats: 3, groups: true, domain: true, automation: 2, api: true, branding: true, desc: '팀과 브랜드를 위한 플랜' },
};
export const POPULAR_PLAN = 'pro';
export const PLANS = { pro: PLAN_CONFIG.pro, business: PLAN_CONFIG.business }; // 결제할 수 있는 플랜

export const won = (n) => '₩' + Number(n).toLocaleString('ko-KR');
const num = (n) => Number(n).toLocaleString('ko-KR');
const STATS = { 1: '기본', 2: '상세', 3: '고급' };
const AUTOMATION = { 0: '—', 1: '기본', 2: '고급' };
const yes = (v) => (v ? '지원' : '—');

// 카드에 넣는 기능 목록
const features = (t, p) => [
  t('뉴스레터 발행 무제한'),
  p.subscribers === null ? t('구독자 무제한') : t('구독자 최대 {n}명', { n: num(p.subscribers) }),
  t('이메일 월 {n}건 발송', { n: num(p.monthly) }),
  t('유료 뉴스레터 판매'),
  t('예약 발행'),
  t(`${STATS[p.stats]} 구독자 및 매출 통계`),
  ...(p.groups ? [t('구독자 그룹별 관리')] : []),
  ...(p.domain ? [t('개인 도메인 연결')] : []),
  p.seats > 1 ? t('팀원 최대 {n}명', { n: p.seats }) : t('팀원 {n}명', { n: p.seats }),
  ...(p.api ? [t('외부 서비스 연동')] : []),
];

// 플랜별 기능 비교표: [기능, 플랜 → 표시 값]
const COMPARE = [
  ['플랫폼 거래 수수료', (p, t) => `<b>${p.feePct}%</b>`],
  ['월 이용료', (p, t) => `${won(p.price)}`],
  ['뉴스레터 발행', (p, t) => t('무제한')],
  ['구독자', (p, t) => (p.subscribers === null ? t('무제한') : t('최대 {n}명', { n: num(p.subscribers) }))],
  ['이메일 월 발송량', (p, t) => t('{n}건', { n: num(p.monthly) })],
  ['유료 뉴스레터 판매', (p, t) => t('지원')],
  ['예약 발행', (p, t) => t('지원')],
  ['구독자·매출 통계', (p, t) => t(STATS[p.stats])],
  ['구독자 그룹별 관리', (p, t) => t(yes(p.groups))],
  ['개인 도메인 연결', (p, t) => t(yes(p.domain))],
  ['팀원', (p, t) => (p.seats > 1 ? t('최대 {n}명', { n: p.seats }) : t('{n}명', { n: p.seats }))],
  ['외부 서비스 연동', (p, t) => t(yes(p.api))],
  ['이메일 자동화', (p, t) => t(AUTOMATION[p.automation])],
  ['Lett 브랜딩 제거', (p, t) => t(yes(p.branding))],
];
export const compareTable = (t, current = '') => `<h2 class="cmph">${t('플랜별 기능 비교')}</h2><div class="cmpw"><table class="cmp"><thead><tr><th>${t('기능')}</th>${Object.entries(PLAN_CONFIG).map(([k, p]) => `<th${k === current ? ' class="on"' : ''}>${p.name}</th>`).join('')}</tr></thead><tbody>${COMPARE.map(([f, cell]) => `<tr><td>${t(f)}</td>${Object.entries(PLAN_CONFIG).map(([k, p]) => `<td${k === current ? ' class="on"' : ''}>${cell(p, t)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

// button(key, plan) → 카드 아래에 들어갈 버튼 HTML. current 는 지금 쓰는 플랜
export const planCards = (t, button, current = '') => `<div class="pls">${Object.entries(PLAN_CONFIG).map(([key, p]) => `<div class="pl${key === POPULAR_PLAN ? ' hot' : ''}${key === current ? ' cur' : ''}">${key === POPULAR_PLAN ? `<span class="plbadge">${t('가장 인기 있는 요금제')}</span>` : ''}<h3>${p.name}${key === current ? ` <small>${t('현재 요금제')}</small>` : ''}</h3><p class="pld">${t(p.desc)}</p>
<div class="pr"><b>${won(p.price)}</b><span>/ ${t('월')}</span></div>
<div class="plfee"><b>${p.feePct}%</b><span>${t('플랫폼 거래 수수료')}</span></div>
<ul>${features(t, p).map((f) => `<li>${f}</li>`).join('')}</ul>${button(key, p)}</div>`).join('')}</div>`;

export const PLAN_CSS = `<style>.pls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:22px;max-width:960px;align-items:stretch}
.pl{position:relative;display:flex;flex-direction:column;border:1px solid #E2E8F0;border-radius:20px;background:#fff;padding:26px;color:#0F172A}
.pl.hot{border-color:#3B82F6;box-shadow:0 18px 40px -26px #3B82F6}
.plbadge{position:absolute;top:-12px;left:22px;background:#3B82F6;color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700;white-space:nowrap}
.pl h3{margin:0 0 4px;font-size:22px;font-weight:800;letter-spacing:-.03em;color:#0F172A}.pl h3 small{margin-left:4px;font-size:12px;font-weight:600;color:#2563EB;letter-spacing:0}.pl .pld{margin:0;color:#64748B;font-size:14px}
.pr{margin:14px 0 8px}.pr b{font-size:32px;letter-spacing:-.04em}.pr span{color:#64748B;margin-left:4px}
.plfee{display:flex;align-items:baseline;gap:8px;background:#F1F5F9;border-radius:12px;padding:8px 14px;margin-bottom:16px;font-size:13.5px;color:#475569}.plfee b{font-size:20px;color:#0F172A;letter-spacing:-.03em}
.pl ul{flex:1;padding-left:18px;margin:0 0 22px;font-size:14.5px}.pl li{margin:6px 0}
.pl form{margin:0}
.pl .plbtn{display:block;width:100%;text-align:center;border:1px solid #0F172A;background:#0F172A;color:#fff;border-radius:999px;padding:10px 18px;font:inherit;font-size:14.5px;font-weight:600;text-decoration:none;cursor:pointer}
.pl .plbtn.ghost{background:#fff;color:#0F172A}
.pl .plbtn:disabled,.pl .plbtn.off{background:#F1F5F9;border-color:#E2E8F0;color:#64748B;cursor:not-allowed;opacity:1}
.cmph{margin:44px 0 12px;font-size:22px;font-weight:800;letter-spacing:-.03em;color:#0F172A}
.cmpw{overflow-x:auto;max-width:960px;background:#fff;border:1px solid #E2E8F0;border-radius:16px}.cmp{width:100%;border-collapse:collapse;font-size:15px;min-width:520px;color:#0F172A}
.cmp th,.cmp td{text-align:left;padding:13px 14px;border-bottom:1px solid #EEF2F6}.cmp th{font-weight:700;border-bottom-color:#E2E8F0;font-size:14px;color:#0F172A}.cmp tr:last-child td{border-bottom:0}
.cmp td:not(:first-child){color:#475569}.cmp td b{color:#0F172A}.cmp .on{background:#EEF3FF}
.cmp th:first-child,.cmp td:first-child{position:sticky;left:0;background:#fff}
@media(max-width:860px){.pls{grid-template-columns:minmax(0,1fr);gap:22px}.cmp{font-size:14px}.cmp th,.cmp td{padding:11px 10px}}</style>`;
