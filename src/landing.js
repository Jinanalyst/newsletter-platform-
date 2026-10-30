// 메인 랜딩 페이지 — 컨셉: "누구나 자신의 이야기를 세상에 펼칠 수 있는 공간"
import { h } from './render.js';
import { tr, langSwitcher } from './i18n.js';
import { ago, authorName } from './note-utils.js';
import { bizInfo } from './business.js';
import { planCards, PLAN_CSS, won } from './plan-data.js';

// 브랜드: 네이비 #0F172A · 블루 #3B82F6 · 배경 #F8FAFC · 그레이 #94A3B8
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#0F172A"/><rect x="11" y="7" width="6.5" height="21" rx="3.2" fill="#fff"/><circle cx="26" cy="27" r="5" fill="#3B82F6"/></svg>')}">`;

const MARK = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="9" y="4" width="7.5" height="26" rx="3.75" fill="currentColor"/><circle cx="26" cy="29" r="5.5" fill="#3B82F6"/></svg>`;

const CSS = `
:root{--navy:#0F172A;--blue:#3B82F6;--bg:#F8FAFC;--gray:#94A3B8;--line:#E2E8F0;--soft:#EEF3FF;color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--navy);font:16px/1.7 'Pretendard','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;letter-spacing:-.015em;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:break-word}
a{color:inherit;text-decoration:none}
.wrap{max-width:1160px;margin:0 auto;padding:0 28px}
.wm{font:800 26px/1 'Poppins','Plus Jakarta Sans','Pretendard',-apple-system,'Segoe UI',sans-serif;letter-spacing:-.06em}
.wm i{color:var(--blue);font-style:normal}
/* 내비게이션 */
header{position:sticky;top:0;z-index:20;background:rgba(248,250,252,.82);backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid transparent;transition:border-color .2s}
header.scrolled{border-color:var(--line)}
.nav{display:flex;align-items:center;gap:36px;height:72px}
.nav .links{display:flex;gap:30px;font-size:15px;color:#475569}
.nav .links a:hover{color:var(--navy)}
.nav .sp{flex:1}
.nav .login{font-size:15px;color:#475569}
.pill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:12px 24px;font-size:15px;font-weight:600;border:1px solid var(--navy);background:var(--navy);color:#fff;transition:transform .15s,box-shadow .15s,background .15s;cursor:pointer}
.pill:hover{transform:translateY(-1px);box-shadow:0 10px 24px -10px rgba(15,23,42,.5)}
.pill.sm{padding:9px 20px;font-size:14px}
.pill.ghost{background:#fff;color:var(--navy);border-color:var(--line)}
.pill.ghost:hover{border-color:var(--navy);box-shadow:none}
.pill.white{background:#fff;color:var(--navy);border-color:#fff}
/* 히어로 */
.hero{position:relative;overflow:hidden;background:radial-gradient(1100px 520px at 78% 8%,#DCE8FF 0,rgba(220,232,255,0) 70%),linear-gradient(180deg,#EEF3FF 0,var(--bg) 100%)}
.hero .wrap{display:grid;grid-template-columns:1.02fr 1fr;align-items:center;gap:40px;padding-top:72px;padding-bottom:96px;min-height:640px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;color:#475569;background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 14px 6px 10px;margin-bottom:28px}
.eyebrow::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--blue)}
h1{font-size:clamp(40px,6.2vw,72px);line-height:1.14;font-weight:800;letter-spacing:-.045em;margin:0 0 26px}
h1 em{font-style:normal;color:var(--blue)}
.lead{font-size:19px;line-height:1.75;color:#475569;margin:0 0 38px;max-width:30em}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.cta .pill{padding:15px 28px;font-size:16px}
.note{margin-top:22px;font-size:13.5px;color:var(--gray)}
/* 히어로 카드 */
.stack{position:relative;height:500px}
.pc{position:absolute;background:#fff;border-radius:22px;box-shadow:0 30px 60px -24px rgba(30,58,138,.35),0 2px 6px rgba(15,23,42,.04);overflow:hidden}
.pc .img{height:150px;position:relative;overflow:hidden}
.pc svg{display:block;width:100%;height:100%}
.pc .bd{padding:18px 20px 20px}
.pc .t{font-weight:700;font-size:17px;line-height:1.4;letter-spacing:-.03em}
.pc .by{display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13px;color:#64748B}
.pc .av{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#93C5FD,#3B82F6)}
.pc p{margin:0;font-size:13.5px;line-height:1.65;color:#64748B}
.pc .ft{display:flex;gap:14px;margin-top:14px;font-size:12.5px;color:var(--gray)}
.pc .ft b{color:var(--blue);font-weight:600}
.pc.a{left:-2%;top:120px;width:230px;transform:rotate(-7deg);opacity:.95;animation:fl 9s ease-in-out infinite}
.pc.b{right:-3%;top:70px;width:250px;transform:rotate(8deg);opacity:.96;animation:fl 11s ease-in-out -3s infinite}
.pc.c{left:15%;top:26px;width:330px;transform:rotate(-5deg);z-index:2;animation:fl 10s ease-in-out -6s infinite}
.pc.c .img{height:190px}
@keyframes fl{0%,100%{translate:0 0}50%{translate:0 -10px}}
/* 모션: 배경 블롭 · 헤드라인 등장 · 카드 패럴랙스 · 떠다니는 뱃지 · 종이비행기 · 마퀴 · 스크롤 등장 */
.hero .wrap{position:relative;z-index:1}
.blobs{position:absolute;inset:0;pointer-events:none}
.blobs i{position:absolute;border-radius:50%;filter:blur(64px);opacity:.55;animation:drift 18s ease-in-out infinite alternate}
.blobs i:nth-child(1){width:380px;height:380px;background:#BFD4FF;left:-90px;top:-70px}
.blobs i:nth-child(2){width:320px;height:320px;background:#D9CCFF;right:6%;top:38%;animation-delay:-6s}
.blobs i:nth-child(3){width:260px;height:260px;background:#C4F0E6;left:40%;bottom:-130px;animation-delay:-11s}
@keyframes drift{to{transform:translate(70px,46px) scale(1.18)}}
.rise{animation:rise .9s cubic-bezier(.2,.8,.2,1) var(--d,0s) both}
@keyframes rise{from{opacity:0;transform:translateY(28px)}}
h1 .ln{display:block}
h1 em{display:inline-block;background:linear-gradient(90deg,#3B82F6,#8B5CF6,#06B6D4,#3B82F6);background-size:240% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 6s linear infinite}
@keyframes shine{to{background-position:-240% 0}}
.pc{transition:transform .3s ease-out}
.pc.a{transform:rotate(-7deg) translate(calc(var(--mx,0)*-16px),calc(var(--my,0)*-10px));animation:pop .9s cubic-bezier(.2,.8,.2,1) .35s both,fl 9s ease-in-out infinite}
.pc.b{transform:rotate(8deg) translate(calc(var(--mx,0)*18px),calc(var(--my,0)*-12px));animation:pop .9s cubic-bezier(.2,.8,.2,1) .5s both,fl 11s ease-in-out -3s infinite}
.pc.c{transform:rotate(-5deg) translate(calc(var(--mx,0)*8px),calc(var(--my,0)*8px));animation:pop .9s cubic-bezier(.2,.8,.2,1) .2s both,fl 10s ease-in-out -6s infinite}
@keyframes pop{from{opacity:0;scale:.88;translate:0 36px}}
.bdg{position:absolute;z-index:3;background:#fff;border:1px solid var(--line);border-radius:999px;padding:9px 16px;font-size:13px;color:#475569;box-shadow:0 16px 34px -16px rgba(30,58,138,.45);white-space:nowrap;animation:pop .8s cubic-bezier(.2,.8,.2,1) 1s both,fl 7s ease-in-out infinite}
.bdg b{color:var(--blue);font-weight:700}
.bdg.x{left:-4%;bottom:70px}.bdg.y{right:0;bottom:24px;animation-delay:1.2s,-2s}
.bdg::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#22C55E;margin-right:8px;box-shadow:0 0 0 0 rgba(34,197,94,.5);animation:ping 2s infinite}
@keyframes ping{70%{box-shadow:0 0 0 9px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.plane{position:absolute;left:0;top:0;width:34px;height:34px;z-index:4;offset-path:path('M -30 420 C 110 330, 200 450, 320 330 S 500 150, 580 10');offset-rotate:auto;animation:fly 8s ease-in-out 1.4s infinite;opacity:0;filter:drop-shadow(0 6px 8px rgba(59,130,246,.35))}
@keyframes fly{0%{offset-distance:0%;opacity:0}8%{opacity:1}88%{opacity:1}100%{offset-distance:100%;opacity:0}}
.mq{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff;padding:18px 0;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
.mqt{display:flex;gap:44px;width:max-content;animation:mq 34s linear infinite;font-size:17px;font-weight:600;color:#94A3B8;letter-spacing:-.02em}
.mqt span::after{content:'✦';margin-left:44px;color:#BFD4FF}
.mq:hover .mqt{animation-play-state:paused}
@keyframes mq{to{transform:translateX(-50%)}}
.js .rv{opacity:0;transform:translateY(26px);transition:opacity .7s ease var(--d,0s),transform .7s cubic-bezier(.2,.8,.2,1) var(--d,0s)}
.js .rv.in{opacity:1;transform:none}
.step{transition:transform .2s,box-shadow .2s,border-color .2s}
.step:hover{transform:translateY(-4px);border-color:#C7D7F5;box-shadow:0 20px 40px -26px rgba(59,130,246,.5)}
.f .ic{transition:transform .25s,background .2s,color .2s}
.f:hover .ic{background:var(--blue);color:#fff;transform:rotate(-8deg) scale(1.1)}
.bandin::after{content:'';position:absolute;width:420px;height:420px;border-radius:50%;background:radial-gradient(closest-side,rgba(139,92,246,.35),rgba(139,92,246,0));left:-120px;bottom:-200px;animation:drift 16s ease-in-out infinite alternate}
.bandin::before{animation:drift 14s ease-in-out infinite alternate-reverse}
.bandin .pill{animation:ring 2.6s infinite}
@keyframes ring{0%{box-shadow:0 0 0 0 rgba(255,255,255,.45)}70%,100%{box-shadow:0 0 0 16px rgba(255,255,255,0)}}
@media(max-width:980px){.plane{display:none}.bdg.x{left:2%}}
@media(max-width:560px){.bdg{display:none}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto}.js .rv{opacity:1;transform:none}.plane{display:none}}
/* 섹션 공통 */
section{padding:112px 0}
.kicker{font-size:14px;font-weight:600;color:var(--blue);margin-bottom:14px}
h2{font-size:clamp(30px,4vw,46px);line-height:1.25;font-weight:800;letter-spacing:-.04em;margin:0 0 18px}
.sub{font-size:18px;color:#64748B;margin:0 0 56px;max-width:34em}
/* 3단계 */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.step{background:#fff;border:1px solid var(--line);border-radius:24px;padding:34px 30px 32px}
.step .n{font:800 15px 'Poppins','Pretendard',sans-serif;color:var(--blue);margin-bottom:34px;display:flex;align-items:center;gap:10px}
.step .n::after{content:'';flex:1;height:1px;background:var(--line)}
.step h3{font-size:24px;letter-spacing:-.035em;margin:0 0 12px}
.step p{margin:0;color:#64748B;font-size:15.5px}
/* 기능 */
.feat{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.fg{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid var(--line);border-radius:24px;overflow:hidden;background:var(--line);gap:1px}
.f{background:#fff;padding:34px 32px 36px}
.f .ic{width:42px;height:42px;border-radius:12px;background:var(--soft);display:grid;place-items:center;margin-bottom:22px;color:var(--blue)}
.f .ic svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.f h3{font-size:18.5px;letter-spacing:-.03em;margin:0 0 8px}
.f p{margin:0;color:#64748B;font-size:15px;line-height:1.7}
/* 탐색 */
.ex{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
.xc{display:block;background:#fff;border:1px solid var(--line);border-radius:20px;padding:24px;transition:transform .18s,box-shadow .18s,border-color .18s}
.xc:hover{transform:translateY(-3px);border-color:#C7D7F5;box-shadow:0 18px 36px -22px rgba(59,130,246,.5)}
.xc .top{display:flex;gap:12px;align-items:center;margin-bottom:14px}
.xc img,.xc .lg{width:46px;height:46px;border-radius:14px;object-fit:cover;background:var(--soft);display:grid;place-items:center;font-weight:800;color:var(--blue);font-size:18px}
.xc b{font-size:17px;letter-spacing:-.03em;display:block;line-height:1.3}
.xc small{color:var(--gray);font-size:13px}
.xc p{margin:0;color:#64748B;font-size:14.5px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.empty{border:1px dashed #CBD5E1;border-radius:24px;padding:56px 28px;text-align:center;color:#64748B;background:#fff}
/* CTA 밴드 */
.band{padding:0 0 112px}
.bandin{background:var(--navy);color:#fff;border-radius:32px;padding:80px 40px;text-align:center;position:relative;overflow:hidden}
.bandin::before{content:'';position:absolute;width:520px;height:520px;border-radius:50%;background:radial-gradient(closest-side,rgba(59,130,246,.45),rgba(59,130,246,0));right:-120px;top:-220px}
.bandin h2{color:#fff;position:relative}
.bandin p{color:#94A3B8;margin:0 0 34px;position:relative;font-size:18px}
.bandin .pill{position:relative;padding:15px 30px;font-size:16px}
footer{border-top:1px solid var(--line);padding:44px 0 56px;color:#64748B;font-size:14px}
footer .wrap{display:flex;gap:28px;align-items:center;flex-wrap:wrap}
footer .sp{flex:1}
footer .fcol{flex-direction:column;align-items:stretch;gap:0}
footer .fr{display:flex;gap:12px 28px;align-items:center;flex-wrap:wrap}
footer .fb{border-top:1px solid var(--line);margin-top:28px;padding-top:20px;display:flex;flex-direction:column;gap:12px}
footer .fl{display:flex;gap:6px 22px;flex-wrap:wrap;font-size:13.5px}
footer .biz{display:flex;gap:2px 18px;flex-wrap:wrap;font-size:12.5px;color:#94A3B8;line-height:1.7}
footer .fcp{font-size:12.5px;color:#94A3B8}
footer a:hover{color:var(--navy)}
footer .langsw{font-size:13px;display:inline-flex;gap:14px}footer .langsw b{color:var(--navy);font-weight:600}
html[lang=ja] body,html[lang=zh] body{word-break:normal}
.mark{width:26px;height:26px}
/* 커뮤니티 포스트 */
.nts{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.nc{display:flex;gap:14px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:22px;transition:transform .18s,box-shadow .18s,border-color .18s}
.nc:hover{transform:translateY(-3px);border-color:#C7D7F5;box-shadow:0 18px 36px -22px rgba(59,130,246,.5)}
.nca{width:42px;height:42px;border-radius:50%;flex:0 0 42px;display:grid;place-items:center;color:#fff;font-weight:700}
.nc .nm{display:flex;gap:8px;align-items:baseline}.nc .nm b{font-size:15.5px}.nc small{color:var(--gray);font-size:13px}
.nc p{margin:4px 0 10px;color:#334155;font-size:15px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.nc .ct{font-size:13px;color:var(--gray)}
.sec-cta{margin-top:28px}
@media(max-width:980px){.nts{grid-template-columns:1fr}}
@media(max-width:980px){
  .hero .wrap{grid-template-columns:1fr;padding-top:48px;padding-bottom:72px;min-height:0}
  .stack{height:440px;max-width:520px;margin:20px auto 0;width:100%}
  .steps,.fg{grid-template-columns:1fr}
  section{padding:80px 0}
  .nav .links{display:none}
}
@media(max-width:560px){
  .wrap{padding:0 20px}.nav{gap:14px;height:64px}.nav .login{display:none}
  .lead{font-size:17px}.stack{height:400px}.pc.c{left:6%;width:76%}.pc.a{width:44%;left:-6%}.pc.b{width:44%;right:-6%}
  .bandin{padding:56px 24px;border-radius:24px}
}
`;

const ICON = {
  block: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="4" rx="1.2"/><rect x="3.5" y="10" width="10" height="4" rx="1.2"/><rect x="3.5" y="16" width="14" height="4" rx="1.2"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.6 0-2.8.8-2.8 2s1 1.7 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.3-.5-2.9-1.4M12 6v2M12 16v2"/></svg>',
  import: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>',
};

const mountain = (c1, c2, c3) => `<svg viewBox="0 0 300 190" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g${c1.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="300" height="190" fill="url(#g${c1.slice(1)})"/><path d="M0 120 90 62l56 46 52-34 102 62v54H0z" fill="${c3}" opacity=".45"/><path d="M0 146 70 100l62 40 70-52 98 70v32H0z" fill="${c3}" opacity=".7"/><rect y="132" width="300" height="60" fill="#fff" opacity=".28"/></svg>`;

export function landingPage({ user, list, notes = [], courses = [], lang = 'ko' }) {
  const t = tr(lang);
  const cta = user
    ? `<a class="pill" href="/app">${t('내 뉴스레터로 이동 →')}</a>`
    : `<a class="pill" href="/signup">${t('지금 시작하기 →')}</a><a class="pill ghost" href="#explore">${t('뉴스레터 탐색하기')}</a>`;
  const explore = list.length
    ? `<div class="ex">${list.map((n) => `<a class="xc" href="/n/${h(n.slug)}"><div class="top">${n.logo ? `<img src="${h(n.logo)}" alt="">` : `<span class="lg">${h([...n.name][0] || '·')}</span>`}
<div><b>${h(n.name)}</b><small>${h(n.owner || t('발행자'))} · ${t('구독자 {n}명 · 글 {p}편', { n: n.subs, p: n.posts })}</small></div></div><p>${h(n.description || t('아직 소개가 없습니다.'))}</p></a>`).join('')}</div>`
    : `<div class="empty"><b style="color:var(--navy);font-size:18px">${t('아직 열려 있는 뉴스레터가 없어요.')}</b><br>${t('첫 번째 이야기의 주인공이 되어보세요.')}<br><br><a class="pill sm" href="/signup">${t('뉴스레터 만들기')}</a></div>`;
  const courseCards = courses.length
    ? `<div class="cg">${courses.map((c) => `<a class="cc" href="/c/${c.id}"><div class="ct"${c.thumbnail ? ` style="background-image:url('${h(c.thumbnail)}')"` : ''}>${c.thumbnail ? '' : '<span>▶</span>'}<em>${t(c.kind === 'product' ? '디지털 상품' : '강의')}</em></div>
<div class="cb"><b>${h(c.title)}</b><small>${h(c.author || t('크리에이터'))}</small><div class="cp">${c.pricing === 'free' || !c.price ? t('무료') : c.pricing === 'monthly' ? `${won(c.price)}<i> / ${t('월')}</i>` : won(c.price)}</div></div></a>`).join('')}</div>`
    : `<div class="empty"><b style="color:var(--navy);font-size:18px">${t('아직 올라온 강의가 없어요.')}</b><br>${t('첫 번째 크리에이터가 되어보세요.')}</div>`;
  const noteCards = notes.length
    ? `<div class="nts">${notes.map((n) => `<a class="nc" href="/posts/${n.id}"><span class="nca" style="background:hsl(${(n.user_id * 47) % 360} 55% 46%)">${h([...authorName(n)][0] || '?')}</span><div><div class="nm"><b>${h(authorName(n))}</b><small>${ago(n.created_at, t)}</small></div><p>${h(n.body.slice(0, 180))}</p><div class="ct">♥ ${n.likes} · ${t('댓글')} ${n.comments}</div></div></a>`).join('')}</div>`
    : `<div class="empty"><b style="color:var(--navy);font-size:18px">${t('아직 포스트가 없어요. 첫 글을 남겨 보세요.')}</b></div>`;
  const words = ['에세이', '인터뷰', '큐레이션', '리뷰', '일기', '뉴스', '칼럼', '레시피', '여행기', '투자 노트', '기술 블로그', '육아 일지'];

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(t('lett. — 당신의 이야기가 시작되는 곳'))}</title>
<meta name="description" content="${h(t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간. 뉴스레터를 만들고, 독자를 만나고, 콘텐츠로 성장하세요.'))}">
<meta property="og:title" content="${h(t('lett. — 당신의 이야기가 시작되는 곳'))}"><meta property="og:description" content="${h(t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간.'))}">
<meta name="theme-color" content="#F8FAFC">${FAVICON}<style>${CSS}</style></head><body>
<header id="hd"><div class="wrap nav"><a href="/" class="wm" aria-label="${t('lett. 홈')}">lett<i>.</i></a>
<nav class="links" aria-label="${t('주요 메뉴')}"><a href="#how">${t('시작하기')}</a><a href="#features">${t('기능')}</a><a href="/posts">${t('포스트')}</a><a href="#courses">${t('강의')}</a><a href="#explore">${t('탐색')}</a></nav><span class="sp"></span>
${user ? `<a class="login" href="/app/profile">${t('프로필')}</a><a class="pill sm" href="/app">${t('내 뉴스레터')}</a>` : `<a class="login" href="/login">${t('로그인')}</a><a class="pill sm" href="/signup">${t('시작하기')}</a>`}</div></header>

<main>
<div class="hero" id="hero"><div class="blobs" aria-hidden="true"><i></i><i></i><i></i></div><div class="wrap"><div>
<span class="eyebrow rise">${t('글쓰기부터 발송, 구독자 관리까지 한 곳에서')}</span>
<h1><span class="ln rise" style="--d:.1s">${t('당신의 이야기가')}</span><span class="ln rise" style="--d:.25s"><em>${t('시작되는 곳.')}</em></span></h1>
<p class="lead rise" style="--d:.4s">${t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간.')}<br>${t('뉴스레터를 만들고, 독자를 만나고, 콘텐츠로 성장하세요.')}</p>
<div class="cta rise" style="--d:.55s">${cta}</div><p class="note rise" style="--d:.7s">${t('무료로 시작할 수 있어요 · 카드 등록 없이 바로 만들기')}</p></div>
<div class="stack" id="stack" aria-hidden="true">
<svg class="plane" viewBox="0 0 34 34"><path d="M3 17 31 4 24 30 17 20z" fill="#3B82F6"/><path d="M17 20 31 4 14 15z" fill="#93C5FD"/></svg>
<div class="bdg x"><b>+128</b> ${t('새 구독자')}</div><div class="bdg y">${t('이번 주 열람률')} <b>62%</b></div>
<div class="pc a"><div class="img">${mountain('#DBE4F2', '#EEF2F8', '#5B6B86')}</div><div class="bd"><div class="t">${t('이번 주 도시 산책')}</div><p>${t('걷다 보면 보이는 것들')}</p></div></div>
<div class="pc b"><div class="img">${mountain('#D7EBDD', '#EEF6F0', '#3C7B5A')}</div><div class="bd"><div class="t">${t('주말의 식물 일기')}</div><p>${t('작은 화분에서 배운 것')}</p></div></div>
<div class="pc c"><div class="img">${mountain('#C9D6EA', '#E8EEF7', '#64748B')}</div><div class="bd"><div class="t">${t('월요일 아침, 한 가지 생각')}</div>
<div class="by"><span class="av"></span>${t('발행자 · 주간 뉴스레터')}</div><p>${t('이번 주에 마음에 남은 이야기를 천천히 정리했어요. 함께 생각해 보실래요?')}</p>
<div class="ft"><span><b>●</b> ${t('이메일로 발송')}</span><span>${t('웹에도 게시')}</span></div></div></div></div></div></div>

<div class="mq" aria-hidden="true"><div class="mqt">${[...Array(2)].map(() => words.map((w) => `<span>${t(w)}</span>`).join('')).join('')}</div></div>

<section id="how"><div class="wrap"><div class="kicker">HOW IT WORKS</div><h2>${t('쓰고, 보내고, 키우세요.')}</h2>
<p class="sub">${t('복잡한 설정 없이 세 단계면 충분합니다. 나머지는 lett.가 맡을게요.')}</p>
<div class="steps">
<div class="step"><div class="n">01</div><h3>${t('쓰세요')}</h3><p>${t('블록을 쌓듯 글을 쓰고, 이미지와 링크를 더하세요. 자동 저장과 버전 기록으로 쓰던 글을 잃어버릴 걱정이 없어요.')}</p></div>
<div class="step"><div class="n">02</div><h3>${t('보내세요')}</h3><p>${t('이메일로 발송하고 웹 페이지에도 함께 게시하세요. 테스트 발송으로 먼저 확인하고, 원하는 시각에 예약할 수 있어요.')}</p></div>
<div class="step"><div class="n">03</div><h3>${t('키우세요')}</h3><p>${t('구독 페이지와 추천 링크로 독자를 만나고, 열람률과 클릭률로 어떤 글이 사랑받는지 확인하세요.')}</p></div></div></div></section>

<section id="features" class="feat"><div class="wrap"><div class="kicker">FEATURES</div><h2>${t('이야기에만 집중할 수 있게.')}</h2>
<p class="sub">${t('창작에 필요한 도구를 갖췄습니다.')}</p>
<div class="fg">
<div class="f"><div class="ic">${ICON.block}</div><h3>${t('블록 에디터')}</h3><p>${t('/ 한 번으로 제목, 목록, 인용, 이미지를 추가하세요. 템플릿으로 자주 쓰는 구조를 저장할 수 있어요.')}</p></div>
<div class="f"><div class="ic">${ICON.globe}</div><h3>${t('이메일과 웹을 동시에')}</h3><p>${t('같은 글이 받은편지함과 공개 페이지, RSS에 함께 나갑니다. 미리보기로 두 모양을 모두 확인하세요.')}</p></div>
<div class="f"><div class="ic">${ICON.clock}</div><h3>${t('예약·자동 발송')}</h3><p>${t('원하는 시각에 보내고, 새 구독자에게는 환영 메일과 시리즈 메일이 자동으로 이어집니다.')}</p></div>
<div class="f"><div class="ic">${ICON.chart}</div><h3>${t('한눈에 보는 성과')}</h3><p>${t('구독자 추이, 열람률, 클릭률, 링크별 반응까지. 다음 글의 힌트가 숫자에 있어요.')}</p></div>
<div class="f"><div class="ic">${ICON.coin}</div><h3>${t('유료 구독')}</h3><p>${t('월간·연간 구독을 열고 유료 전용 글을 발행하세요. 매출과 정산 내역도 한곳에서 확인합니다.')}</p></div>
<div class="f"><div class="ic">${ICON.import}</div><h3>${t('쉬운 이사')}</h3><p>${t('Substack, Medium, 워드프레스 등 RSS가 있는 곳의 글을 가져오고, 기존 구독자는 CSV로 옮겨오세요.')}</p></div></div></div></section>

<section id="posts"><div class="wrap"><div class="kicker">COMMUNITY</div><h2>${t('모두의 이야기를 가볍게 나눠요.')}</h2>
<p class="sub">${t('짧은 생각을 남기고, 좋아요와 댓글로 이야기를 나눠 보세요.')}</p>${noteCards}
<div class="cta sec-cta"><a class="pill" href="/posts">${t('포스트 전체 보기 →')}</a></div></div></section>

<section id="courses" class="feat"><div class="wrap"><div class="kicker">CREATE</div><h2>${t('지금 인기 있는 강의와 상품.')}</h2>
<p class="sub">${t('크리에이터가 직접 만든 강의와 디지털 상품을 만나 보세요.')}</p><style>.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
.cc{display:block;text-decoration:none;color:inherit;border:1px solid var(--line);border-radius:18px;background:#fff;overflow:hidden;transition:border-color .15s,box-shadow .15s,transform .15s}
.cc:hover{border-color:var(--blue);transform:translateY(-3px);box-shadow:0 20px 40px -26px var(--blue)}
.ct{position:relative;aspect-ratio:16/9;background:#EEF2F8 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:26px}
.ct em{position:absolute;left:12px;top:12px;font-style:normal;font-size:12px;font-weight:600;background:rgba(15,23,42,.78);color:#fff;border-radius:999px;padding:3px 10px}
.cb{padding:16px 18px 18px;display:flex;flex-direction:column;gap:3px}.cb b{font-size:16.5px;line-height:1.4;letter-spacing:-.02em;color:var(--navy)}
.cb small{color:#64748B;font-size:13.5px}.cp{margin-top:8px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:var(--navy)}.cp i{font-style:normal;font-weight:500;color:#64748B;font-size:14px}</style>
${courseCards}
<div class="cta sec-cta"><a class="pill" href="/create">${t('내 강의 만들기 →')}</a></div></div></section>

<section id="explore"><div class="wrap"><div class="kicker">EXPLORE</div><h2>${t('지금 펼쳐지고 있는 이야기들.')}</h2>
<p class="sub">${t('마음에 드는 뉴스레터를 구독해 보세요.')}</p>${explore}</div></section>

<section id="pricing" class="feat"><div class="wrap"><div class="kicker">PRICING</div><h2>${t('요금제')}</h2>
<p class="sub" style="margin-bottom:0">${t('부가세 포함 · 결제일로부터 7일 이내 환불 가능')} · <a href="/refund" style="text-decoration:underline">${t('환불 정책')}</a></p>
${PLAN_CSS}${planCards(t, () => `<button class="plbtn off" disabled>${t('준비 중')}</button>`)}</div></section>

<div class="band"><div class="wrap"><div class="bandin"><h2>${t('오늘, 첫 번째 이야기를')}<br>${t('시작해 보세요.')}</h2><p>${t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간.')}</p>
<a class="pill white" href="${user ? '/app' : '/signup'}">${user ? t('내 뉴스레터로 이동') : t('무료로 시작하기')} →</a></div></div></div>
</main>

<footer><div class="wrap fcol"><div class="fr"><a href="/" class="wm" style="font-size:22px;color:var(--navy)">lett<i>.</i></a><span>${t('당신의 이야기가 시작되는 곳')}</span><span class="sp"></span>
${user ? `<a href="/app">${t('내 뉴스레터')}</a>` : `<a href="/login">${t('로그인')}</a><a href="/signup">${t('시작하기')}</a>`}${langSwitcher(lang)}</div>
<div class="fb"><div class="fl"><a href="/pricing">${t('요금제')}</a><a href="/privacy">${t('개인정보처리방침')}</a><a href="/refund">${t('환불 정책')}</a></div>${bizInfo(t)}<div class="fcp">© ${new Date().getFullYear()} lett.</div></div></div></footer>
<script>const hd=document.getElementById('hd');const f=()=>hd.classList.toggle('scrolled',scrollY>8);addEventListener('scroll',f,{passive:true});f();
(function(){var rm=matchMedia('(prefers-reduced-motion:reduce)').matches;
// 스크롤 등장: 같은 묶음 안에서는 순서대로 조금씩 늦게
document.querySelectorAll('.steps,.fg,.ex,.cg').forEach(function(g){[].forEach.call(g.children,function(c,i){c.style.setProperty('--d',i*.08+'s')})});
var els=document.querySelectorAll('.kicker,section h2,.sub,.step,.f,.xc,.cc,.empty,.bandin');
if(!rm&&'IntersectionObserver' in window){document.documentElement.classList.add('js');
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;var el=e.target;el.classList.add('in');io.unobserve(el);setTimeout(function(){el.classList.remove('rv','in');el.style.removeProperty('--d')},1400)})},{threshold:.15,rootMargin:'0px 0px -40px 0px'});
els.forEach(function(el){el.classList.add('rv');io.observe(el)})}
// 히어로 카드 패럴랙스
var hero=document.getElementById('hero'),st=document.getElementById('stack');
if(!rm&&matchMedia('(hover:hover)').matches){hero.addEventListener('pointermove',function(e){var r=hero.getBoundingClientRect();st.style.setProperty('--mx',((e.clientX-r.left)/r.width-.5)*2);st.style.setProperty('--my',((e.clientY-r.top)/r.height-.5)*2)});
hero.addEventListener('pointerleave',function(){st.style.setProperty('--mx',0);st.style.setProperty('--my',0)})}
})()</script>
</body></html>`;
}
