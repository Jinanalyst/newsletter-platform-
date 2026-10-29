// 요금제 정의와 카드 HTML (요금제 페이지·랜딩 공용). 다른 모듈을 가져오지 않아 어디서든 쓸 수 있다
export const PLANS = {
  pro: { name: 'Pro', price: 15000, desc: '혼자 시작하는 발행자를 위한 플랜', features: ['이메일 발송과 웹 아카이브', '자동화 메일(환영 메일·시리즈)', '유료 구독·수익 관리', '조회·열람·클릭 통계'] },
  business: { name: 'Business', price: 30000, desc: '브랜드와 여러 뉴스레터를 위한 플랜', features: ['Pro의 모든 기능', '여러 뉴스레터 운영', '공개 페이지 레이아웃·브랜드 편집', '성장·추천 도구'] },
};
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
@media(max-width:700px){.pls{grid-template-columns:1fr}}</style>`;
