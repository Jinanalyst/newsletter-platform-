// 메인 랜딩 페이지 — 컨셉: "누구나 자신의 이야기를 세상에 펼칠 수 있는 공간" (미니멀 디자인 · 주소 입력 → 로그인 → 자동 지정)
import { publicUrl } from './db.js';
import { h } from './render.js';
import { tr, langSwitcher } from './i18n.js';
import { ago, authorName } from './note-utils.js';
import { bizInfo } from './business.js';
import { planCards, compareTable, PLAN_CSS, won } from './plan-data.js';

// 브랜드: 네이비 #0F172A · 블루 · 배경 #F8FAFC · 그레이 #94A3B8
export const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#0F172A"/><rect x="11" y="7" width="6.5" height="21" rx="3.2" fill="#fff"/><circle cx="26" cy="27" r="5" fill="#3B82F6"/></svg>')}">`;

const CSS = `
:root{--navy:#0F172A;--blue:#2447F0;--bg:#F8FAFC;--gray:#94A3B8;--mute:#5A6578;--line:#E2E8F0;--soft:#EEF3FF;color-scheme:light}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--navy);font:16px/1.7 'Pretendard','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;letter-spacing:-.015em;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:break-word}
a{color:inherit;text-decoration:none}
.wrap{max-width:1160px;margin:0 auto;padding:0 28px}
.wm{font:800 26px/1 'Poppins','Plus Jakarta Sans','Pretendard',-apple-system,'Segoe UI',sans-serif;letter-spacing:-.06em}
.wm i{color:var(--blue);font-style:normal}
/* 내비게이션 */
header{position:sticky;top:0;z-index:20;background:rgba(248,250,252,.86);backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid transparent;transition:border-color .2s}
header.scrolled{border-color:var(--line)}
.nav{display:flex;align-items:center;gap:36px;height:72px}
.nav .links{display:flex;gap:28px;font-size:15px;color:#475569}
.nav .links a:hover,.nav .login:hover{color:var(--blue)}
.nav .sp{flex:1}
.nav .login{font-size:15px;color:#475569}
.pill{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border-radius:999px;padding:0 24px;font-size:15px;font-weight:600;border:1px solid var(--navy);background:var(--navy);color:#fff;transition:transform .2s,box-shadow .2s;cursor:pointer;font-family:inherit}
.pill:hover{transform:translateY(-2px);box-shadow:0 10px 24px -10px rgba(15,23,42,.5)}
.pill.sm{min-height:40px;padding:0 20px;font-size:14px}
.pill.white{background:#fff;color:var(--navy);border-color:#fff}
.pill.blue{background:var(--blue);border-color:var(--blue)}
/* 히어로 */
.hero .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:56px;padding-top:72px;padding-bottom:96px}
.hero .l{flex:1 1 480px;min-width:0}.hero .r{flex:1 1 380px;min-width:0;position:relative;padding:24px 0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:14px;color:#475569;background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 16px 6px 12px;margin:0 0 28px}
.eyebrow::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--blue)}
h1{font-size:clamp(40px,6.2vw,72px);line-height:1.14;font-weight:800;letter-spacing:-.045em;margin:0}
h1 em{font-style:normal;color:var(--blue);position:relative;display:inline-block}
h1 em::after{content:'';position:absolute;left:0;right:0;bottom:.04em;height:.08em;background:currentColor;transform-origin:left;animation:sweep .9s .9s cubic-bezier(.2,.7,.2,1) both}
.lead{font-size:19px;line-height:1.75;color:#475569;margin:28px 0 0;max-width:30em;font-weight:300}
.claim{margin:44px 0 0;display:flex;flex-wrap:wrap;gap:12px;max-width:560px}
.claim .in{flex:1 1 280px;display:flex;align-items:center;min-height:60px;padding:0 20px;background:#fff;border:1px solid #D5DCE6;border-radius:14px}
.claim .in:focus-within{outline:2px solid var(--blue);outline-offset:2px}
.claim input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:18px;color:var(--navy);padding:0}
.claim input::placeholder{color:#8590A2}.claim .sfx{font-size:18px;color:#6B7689;white-space:nowrap}
.claim button{min-height:60px;padding:0 28px;border:0;border-radius:14px;background:var(--blue);color:#fff;font:inherit;font-size:17px;font-weight:600;cursor:pointer;animation:pulse 2.2s ease-out infinite;transition:transform .25s,box-shadow .25s}
.claim button:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(36,71,240,.28)}
.hint{margin:16px 0 0;font-size:14px;color:var(--mute)}.hint b{font-weight:600;color:var(--navy)}
.hint .caret{display:inline-block;width:2px;height:1.1em;background:var(--blue);margin-left:2px;vertical-align:-.15em;animation:blink 1s steps(1) infinite}
.err{margin:14px 0 0;max-width:560px;padding:12px 16px;border-radius:12px;background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;font-size:14.5px}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:40px}
.cta .pill{min-height:52px;padding:0 28px;font-size:16px}
.cta .pill.ghost{background:#fff;color:var(--navy);border-color:var(--line)}
.sublinks{margin:20px 0 0;display:flex;flex-wrap:wrap;gap:8px 24px;font-size:15px;color:#6B7689}
.sublinks a{color:var(--navy);font-weight:500;border-bottom:1px solid var(--navy)}
/* 발송 미리보기 카드 */
.mail{background:#fff;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(36,71,240,.25);animation:float 7s ease-in-out infinite}
.mail .bd{padding:22px 24px 26px}.mail .t{font-weight:700;font-size:18px;letter-spacing:-.03em}
.mail .by{display:flex;align-items:center;gap:8px;margin:10px 0 14px;font-size:13px;color:var(--mute)}
.mail .av{width:24px;height:24px;border-radius:50%;background:var(--blue);opacity:.35}
.mail .ft{display:flex;gap:16px;margin-top:18px;font-size:12.5px;color:var(--mute)}.mail .ft b{color:var(--blue)}
.sk{background:linear-gradient(90deg,#E2E8F0 0,#F1F5F9 50%,#E2E8F0 100%);background-size:400px 100%;animation:shimmer 1.8s linear infinite;border-radius:5px;height:9px;margin-top:9px}
.sk.img{height:150px;border-radius:0;margin:0}
.bdg{position:absolute;z-index:2;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 16px;font-size:13px;color:#475569;white-space:nowrap;display:inline-flex;align-items:center;gap:8px;animation:bob 5s ease-in-out infinite}
.bdg b{color:var(--blue);font-weight:700}.bdg.x{left:0;bottom:8px}.bdg.y{right:0;top:0;animation-delay:-2s}
.bdg.x::before{content:'';width:8px;height:8px;border-radius:50%;background:#22A05A;animation:ping 2s infinite}
/* 마퀴 */
.mq{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff;padding:18px 0;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}
.mqt{display:flex;gap:40px;width:max-content;animation:marq 40s linear infinite;font-size:17px;font-weight:500;color:#8590A2}
.mqt span::after{content:'✦';margin-left:40px;color:#C9D3E6}.mq:hover .mqt{animation-play-state:paused}
/* 섹션 공통 */
section{padding:112px 0 0}
.kicker{font-size:14px;font-weight:600;color:var(--blue);margin-bottom:12px}
h2{font-size:clamp(30px,4vw,46px);line-height:1.25;font-weight:800;letter-spacing:-.04em;margin:0 0 16px}
.sub{font-size:18px;color:var(--mute);margin:0 0 48px;max-width:34em}
.alt{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:112px;padding:96px 0}
/* 3단계 */
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.step{background:#fff;border:1px solid var(--line);border-radius:24px;padding:34px 30px 32px}
.step .n{font-size:15px;font-weight:700;color:var(--blue);margin-bottom:30px}
.step h3{font-size:24px;letter-spacing:-.035em;margin:0 0 12px}.step p{margin:0;color:var(--mute);font-size:15.5px;font-weight:300}
.lift{transition:transform .3s,border-color .3s,box-shadow .3s}
.lift:hover{transform:translateY(-5px);border-color:var(--blue);box-shadow:0 18px 36px -24px rgba(36,71,240,.5)}
/* 기능 */
.fg{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 56px}
.f{display:flex;gap:20px;padding:28px 0;border-top:1px solid #D5DCE6;transition:padding-left .3s}.f:hover{padding-left:12px}
.f .no{font-size:14px;color:var(--blue);font-weight:600;padding-top:4px;min-width:24px}
.f h3{margin:0;font-size:20px;letter-spacing:-.03em;font-weight:600}.f p{margin:8px 0 0;color:var(--mute);font-size:15.5px;font-weight:300}
/* 탐색 */
.ex{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
.xc{display:block;background:#fff;border:1px solid var(--line);border-radius:20px;padding:24px}
.xc .top{display:flex;gap:12px;align-items:center;margin-bottom:14px}
.xc img,.xc .lg{width:46px;height:46px;border-radius:14px;object-fit:cover;background:var(--soft);display:grid;place-items:center;font-weight:800;color:var(--blue);font-size:18px}
.xc b{font-size:17px;letter-spacing:-.03em;display:block;line-height:1.3}.xc small{color:#6B7689;font-size:13px}
.xc p{margin:0;color:var(--mute);font-size:14.5px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.empty{border:1px dashed #CBD5E1;border-radius:24px;padding:56px 28px;text-align:center;color:var(--mute);background:#fff}
/* 커뮤니티 · 강의 */
.nts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
.nc{display:flex;gap:14px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:22px}
.nca{width:42px;height:42px;border-radius:50%;flex:0 0 42px;display:grid;place-items:center;color:#fff;font-weight:700}
.nc .nm{display:flex;gap:8px;align-items:baseline}.nc .nm b{font-size:15.5px}.nc small{color:#6B7689;font-size:13px}
.nc p{margin:4px 0 10px;color:#334155;font-size:15px;line-height:1.65;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.nc .ct{font-size:13px;color:#6B7689}
.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
.cc{display:block;border:1px solid var(--line);border-radius:18px;background:#fff;overflow:hidden}
.cc .ct{position:relative;aspect-ratio:16/9;background:#EEF2F8 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#8590A2;font-size:26px}
.cc .ct em{position:absolute;left:12px;top:12px;font-style:normal;font-size:12px;font-weight:600;background:var(--navy);color:#fff;border-radius:999px;padding:3px 12px}
.cb{padding:16px 18px 18px;display:flex;flex-direction:column;gap:3px}.cb b{font-size:16.5px;line-height:1.4;letter-spacing:-.02em}
.cb small{color:var(--mute);font-size:13.5px}.cp{margin-top:8px;font-weight:800;font-size:18px;letter-spacing:-.03em}.cp i{font-style:normal;font-weight:500;color:var(--mute);font-size:14px}
.sec-cta{margin-top:28px}
#pricing .kicker,#pricing h2,#pricing .sub,#pricing .cmph{text-align:center}
#pricing .sub,#pricing .pls,#pricing .cmpw{margin-left:auto;margin-right:auto}
/* CTA 밴드 */
.band{padding:112px 0}
.bandin{background:var(--navy);color:#fff;border-radius:32px;padding:clamp(48px,8vw,88px) 32px;text-align:center}
.bandin h2{color:#fff}.bandin p{color:#A9B4C6;margin:0 0 34px;font-size:18px}
.bandin .pill{min-height:56px;padding:0 34px;font-size:17px;animation:pulse 2.4s ease-out infinite}
footer{border-top:1px solid var(--line);padding:44px 0 56px;color:var(--mute);font-size:14px}
footer .wrap{display:flex;gap:28px;align-items:center;flex-wrap:wrap}
footer .sp{flex:1}
footer .fcol{flex-direction:column;align-items:stretch;gap:0}
footer .fr{display:flex;gap:12px 28px;align-items:center;flex-wrap:wrap}
footer .fb{border-top:1px solid var(--line);margin-top:28px;padding-top:20px;display:flex;flex-direction:column;gap:12px}
footer .fl{display:flex;gap:6px 22px;flex-wrap:wrap;font-size:13.5px}
footer .biz{display:flex;gap:2px 18px;flex-wrap:wrap;font-size:12.5px;color:#6B7689;line-height:1.7}
footer .fcp{font-size:12.5px;color:#6B7689}
footer a:hover{color:var(--blue)}
footer .langsw{font-size:13px;display:inline-flex;gap:14px}footer .langsw b{color:var(--navy);font-weight:600}
html[lang=ja] body,html[lang=zh] body{word-break:normal}
.live{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:2px 10px;border-radius:999px;background:#ECFDF3;color:#15803D;font-size:11px;font-weight:700;letter-spacing:.06em;vertical-align:1px}
.live i{width:7px;height:7px;border-radius:50%;background:#22A05A;animation:ping 2s infinite}
.fresh{animation:fresh 1.1s cubic-bezier(.2,.7,.2,1) both}
@keyframes fresh{from{opacity:0;transform:translateY(-14px) scale(.98);background:#EEF3FF}to{opacity:1;transform:none}}
/* 모션 */
@keyframes up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes sweep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes float{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-10px) rotate(1deg)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes shimmer{from{background-position:-200px 0}to{background-position:200px 0}}
@keyframes blink{50%{opacity:0}}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(36,71,240,.35)}100%{box-shadow:0 0 0 18px rgba(36,71,240,0)}}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(34,160,90,.5)}100%{box-shadow:0 0 0 9px rgba(34,160,90,0)}}
@keyframes marq{to{transform:translateX(-50%)}}
.rise{animation:up .9s cubic-bezier(.2,.7,.2,1) var(--d,0s) both}
.js .rv{opacity:0;transform:translateY(26px);transition:opacity .7s ease var(--d,0s),transform .7s cubic-bezier(.2,.8,.2,1) var(--d,0s)}
.js .rv.in{opacity:1;transform:none}
@media(max-width:980px){.nav .links{display:none}section{padding-top:80px}.alt{margin-top:80px;padding:72px 0}.hero .wrap{padding-top:40px;padding-bottom:64px}}
@media(max-width:560px){.wrap{padding:0 20px}.nav{gap:14px;height:64px}.nav .login{display:none}.lead{font-size:17px}.bdg{display:none}.nts{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto}.js .rv{opacity:1;transform:none}}
`;

// 탐색·강의·커뮤니티 구역의 HTML. 첫 화면과 실시간 갱신(/home/live)이 같은 모양을 쓰도록 따로 만든다
export function homeSections({ list, notes = [], courses = [], lang = 'ko' }) {
  const t = tr(lang);
  const explore = list.length
    ? `<div class="ex">${list.map((n) => `<a class="xc lift" href="${h(publicUrl(n))}"><div class="top">${n.logo ? `<img src="${h(n.logo)}" alt="">` : `<span class="lg">${h([...n.name][0] || '·')}</span>`}
<div><b>${h(n.name)}</b><small>${h(n.owner || t('발행자'))} · ${t('구독자 {n}명 · 글 {p}편', { n: n.subs, p: n.posts })}</small></div></div><p>${h(n.description || t('아직 소개가 없습니다.'))}</p></a>`).join('')}</div>`
    : `<div class="empty"><b style="color:var(--navy);font-size:18px">${t('아직 열려 있는 뉴스레터가 없어요.')}</b><br>${t('첫 번째 이야기의 주인공이 되어보세요.')}<br><br><a class="pill sm" href="/signup">${t('뉴스레터 만들기')}</a></div>`;
  const courseCards = courses.length
    ? `<div class="cg">${courses.map((c) => `<a class="cc lift" href="/c/${c.id}"><div class="ct"${c.thumbnail ? ` style="background-image:url('${h(c.thumbnail)}')"` : ''}>${c.thumbnail ? '' : '<span aria-hidden="true">▶</span>'}<em>${t(c.kind === 'product' ? '디지털 상품' : '강의')}</em></div>
<div class="cb"><b>${h(c.title)}</b><small>${h(c.author || t('크리에이터'))}</small><div class="cp">${c.pricing === 'free' || !c.price ? t('무료') : c.pricing === 'monthly' ? `${won(c.price)}<i> / ${t('월')}</i>` : won(c.price)}</div></div></a>`).join('')}</div>`
    : `<div class="empty"><b style="color:var(--navy);font-size:18px">${t('아직 올라온 강의가 없어요.')}</b><br>${t('첫 번째 크리에이터가 되어보세요.')}</div>`;
  const noteCards = notes.length
    ? `<div class="nts">${notes.map((n) => `<a class="nc lift" href="/posts/${n.id}"><span class="nca" style="background:hsl(${(n.user_id * 47) % 360} 55% 40%)">${h([...authorName(n)][0] || '?')}</span><div style="min-width:0"><div class="nm"><b>${h(authorName(n))}</b><small>${ago(n.created_at, t)}</small></div><p>${h(n.body.slice(0, 180))}</p><div class="ct">♥ ${n.likes} · ${t('댓글')} ${n.comments}</div></div></a>`).join('')}</div>`
    : `<div class="empty"><b style="color:var(--navy);font-size:18px">${t('아직 포스트가 없어요. 첫 글을 남겨 보세요.')}</b></div>`;
  return { explore, courseCards, noteCards };
}

export function landingPage({ user, list, notes = [], courses = [], lang = 'ko', msg = '' }) {
  const t = tr(lang);
  const { explore, courseCards, noteCards } = homeSections({ list, notes, courses, lang });
  const cta = user
    ? `<div class="cta rise" style="--d:.4s"><a class="pill blue" href="/app">${t('내 뉴스레터로 이동 →')}</a></div>`
    : `<form class="claim rise" style="--d:.4s" action="/claim" method="get" id="claim">
<div class="in"><label for="sub" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${t('내 뉴스레터 주소')}</label>
<input id="sub" name="sub" placeholder="my-letter" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false" pattern="[a-z0-9][a-z0-9\\-]{2,29}" title="${h(t('영문 소문자·숫자·하이픈, 3~30자'))}"><span class="sfx">.lett.live</span></div>
<button>${t('지금 시작하기 →')}</button></form>
${msg ? `<div class="err" role="alert">${h(t(msg))}</div>` : ''}
<p class="hint rise" style="--d:.5s">${t('내 뉴스레터는')} <b id="shown">my-letter.lett.live</b><span class="caret" aria-hidden="true"></span> ${t('에서 열려요. 입력한 주소는 로그인 후 자동으로 연결됩니다.')}</p>`;
  const words = ['에세이', '인터뷰', '큐레이션', '리뷰', '일기', '뉴스', '칼럼', '레시피', '여행기', '투자 노트', '기술 블로그', '육아 일지'];
  const feat = (n, title, body) => `<div class="f"><span class="no">${n}</span><div><h3>${t(title)}</h3><p>${t(body)}</p></div></div>`;

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(t('lett. — 당신의 이야기가 시작되는 곳'))}</title>
<meta name="description" content="${h(t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간. 뉴스레터를 만들고, 독자를 만나고, 콘텐츠로 성장하세요.'))}">
<meta property="og:title" content="${h(t('lett. — 당신의 이야기가 시작되는 곳'))}"><meta property="og:description" content="${h(t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간.'))}">
<meta name="theme-color" content="#F8FAFC">${FAVICON}<style>${CSS}</style></head><body>
<header id="hd"><div class="wrap nav"><a href="/" class="wm" aria-label="${t('lett. 홈')}">lett<i>.</i></a>
<nav class="links" aria-label="${t('주요 메뉴')}"><a href="#how">${t('시작하기')}</a><a href="#features">${t('기능')}</a><a href="/posts">${t('포스트')}</a><a href="#courses">${t('강의')}</a><a href="#explore">${t('탐색')}</a><a href="#pricing">${t('요금제')}</a></nav><span class="sp"></span>
${user ? `<a class="login" href="/app/profile">${t('프로필')}</a><a class="pill sm" href="/app">${t('내 뉴스레터')}</a>` : `<a class="login" href="/login">${t('로그인')}</a><a class="pill sm" href="/signup">${t('시작하기')}</a>`}</div></header>

<main>
<div class="hero"><div class="wrap"><div class="l">
<p class="eyebrow rise">${t('글쓰기부터 발송, 구독자 관리까지 한 곳에서')}</p>
<h1><span class="rise" style="--d:.1s;display:block">${t('당신의 이야기가')}</span><span class="rise" style="--d:.2s;display:block"><em>${t('시작되는 곳.')}</em></span></h1>
<p class="lead rise" style="--d:.3s">${t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간.')}<br>${t('뉴스레터를 만들고, 독자를 만나고, 콘텐츠로 성장하세요.')}</p>
${cta}
<p class="sublinks rise" style="--d:.6s"><a href="#explore">${t('뉴스레터 탐색하기')}</a><span>${t('무료로 시작할 수 있어요 · 카드 등록 없이 바로 만들기')}</span></p></div>
<div class="r" aria-hidden="true"><div class="bdg x"><b>+128</b> ${t('새 구독자')}</div><div class="bdg y">${t('이번 주 열람률')} <b>62%</b></div>
<div class="mail"><div class="sk img"></div><div class="bd"><div class="t">${t('월요일 아침, 한 가지 생각')}</div><div class="by"><span class="av"></span>${t('발행자 · 주간 뉴스레터')}</div>
<div class="sk" style="margin-top:0"></div><div class="sk" style="width:90%"></div><div class="sk" style="width:62%"></div>
<div class="ft"><span><b>●</b> ${t('이메일로 발송')}</span><span>${t('웹에도 게시')}</span></div></div></div></div></div></div>

<div class="mq" aria-hidden="true"><div class="mqt">${[...Array(2)].map(() => words.map((w) => `<span>${t(w)}</span>`).join('')).join('')}</div></div>

<section id="how"><div class="wrap"><div class="kicker">HOW IT WORKS</div><h2>${t('쓰고, 보내고, 키우세요.')}</h2>
<p class="sub">${t('복잡한 설정 없이 세 단계면 충분합니다. 나머지는 lett.가 맡을게요.')}</p>
<div class="steps">
<div class="step lift"><div class="n">01</div><h3>${t('쓰세요')}</h3><p>${t('블록을 쌓듯 글을 쓰고, 이미지와 링크를 더하세요. 자동 저장과 버전 기록으로 쓰던 글을 잃어버릴 걱정이 없어요.')}</p></div>
<div class="step lift"><div class="n">02</div><h3>${t('보내세요')}</h3><p>${t('이메일로 발송하고 웹 페이지에도 함께 게시하세요. 테스트 발송으로 먼저 확인하고, 원하는 시각에 예약할 수 있어요.')}</p></div>
<div class="step lift"><div class="n">03</div><h3>${t('키우세요')}</h3><p>${t('구독 페이지와 추천 링크로 독자를 만나고, 열람률과 클릭률로 어떤 글이 사랑받는지 확인하세요.')}</p></div></div></div></section>

<section id="features" class="alt" style="padding-top:96px"><div class="wrap"><div class="kicker">FEATURES</div><h2>${t('이야기에만 집중할 수 있게.')}</h2>
<p class="sub">${t('창작에 필요한 도구를 갖췄습니다.')}</p>
<div class="fg">
${feat('01', '블록 에디터', '/ 한 번으로 제목, 목록, 인용, 이미지를 추가하세요. 템플릿으로 자주 쓰는 구조를 저장할 수 있어요.')}
${feat('02', '이메일과 웹을 동시에', '같은 글이 받은편지함과 공개 페이지, RSS에 함께 나갑니다. 미리보기로 두 모양을 모두 확인하세요.')}
${feat('03', '예약·자동 발송', '원하는 시각에 보내고, 새 구독자에게는 환영 메일과 시리즈 메일이 자동으로 이어집니다.')}
${feat('04', '한눈에 보는 성과', '구독자 추이, 열람률, 클릭률, 링크별 반응까지. 다음 글의 힌트가 숫자에 있어요.')}
${feat('05', '유료 구독', '월간·연간 구독을 열고 유료 전용 글을 발행하세요. 매출과 정산 내역도 한곳에서 확인합니다.')}
${feat('06', '쉬운 이사', 'Substack, Medium, 워드프레스 등 RSS가 있는 곳의 글을 가져오고, 기존 구독자는 CSV로 옮겨오세요.')}</div></div></section>

<section id="posts"><div class="wrap"><div class="kicker">COMMUNITY <span class="live" title="${h(t('실시간으로 갱신돼요'))}"><i></i>LIVE</span></div><h2>${t('모두의 이야기를 가볍게 나눠요.')}</h2>
<p class="sub">${t('짧은 생각을 남기고, 좋아요와 댓글로 이야기를 나눠 보세요.')}</p><div data-live="notes">${noteCards}</div>
<div class="sec-cta"><a class="pill" href="/posts">${t('포스트 전체 보기 →')}</a></div></div></section>

<section id="courses" class="alt"><div class="wrap"><div class="kicker">CREATE <span class="live" title="${h(t('실시간으로 갱신돼요'))}"><i></i>LIVE</span></div><h2>${t('지금 인기 있는 강의와 상품.')}</h2>
<p class="sub">${t('크리에이터가 직접 만든 강의와 디지털 상품을 만나 보세요.')}</p><div data-live="courses">${courseCards}</div>
<div class="sec-cta"><a class="pill" href="/create">${t('내 강의 만들기 →')}</a></div></div></section>

<section id="explore"><div class="wrap"><div class="kicker">EXPLORE <span class="live" title="${h(t('실시간으로 갱신돼요'))}"><i></i>LIVE</span></div><h2>${t('지금 펼쳐지고 있는 이야기들.')}</h2>
<p class="sub">${t('마음에 드는 뉴스레터를 구독해 보세요.')}</p><div data-live="explore">${explore}</div></div></section>

<section id="pricing" class="alt"><div class="wrap"><div class="kicker">PRICING</div><h2>${t('요금제')}</h2>
<p class="sub" style="margin-bottom:0">${t('부가세 포함 · 결제일로부터 7일 이내 환불 가능')} · <a href="/refund" style="text-decoration:underline">${t('환불 정책')}</a></p>
${PLAN_CSS}${planCards(t, () => `<button class="plbtn off" disabled>${t('준비 중')}</button>`)}${compareTable(t)}</div></section>

<div class="band"><div class="wrap"><div class="bandin rv"><h2>${t('오늘, 첫 번째 이야기를')}<br>${t('시작해 보세요.')}</h2><p>${t('누구나 자신의 이야기를 세상에 펼칠 수 있는 공간.')}</p>
<a class="pill white" href="${user ? '/app' : '/signup'}">${user ? t('내 뉴스레터로 이동') : t('무료로 시작하기')} →</a></div></div></div>
</main>

<footer><div class="wrap fcol"><div class="fr"><a href="/" class="wm" style="font-size:22px;color:var(--navy)">lett<i>.</i></a><span>${t('당신의 이야기가 시작되는 곳')}</span><span class="sp"></span>
${user ? `<a href="/app">${t('내 뉴스레터')}</a>` : `<a href="/login">${t('로그인')}</a><a href="/signup">${t('시작하기')}</a>`}${langSwitcher(lang)}</div>
<div class="fb"><div class="fl"><a href="/pricing">${t('요금제')}</a><a href="/privacy">${t('개인정보처리방침')}</a><a href="/refund">${t('환불 정책')}</a></div>${bizInfo(t)}<div class="fcp">© ${new Date().getFullYear()} lett.</div></div></div></footer>
<script>const hd=document.getElementById('hd');const f=()=>hd.classList.toggle('scrolled',scrollY>8);addEventListener('scroll',f,{passive:true});f();
(function(){var rm=matchMedia('(prefers-reduced-motion:reduce)').matches;
// 주소 입력: 아래 안내 문구에 바로 반영하고, 영문 소문자·숫자·하이픈만 남긴다
var sub=document.getElementById('sub'),shown=document.getElementById('shown');
if(sub&&shown){sub.addEventListener('input',function(){var v=sub.value.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,30);if(v!==sub.value)sub.value=v;shown.textContent=(v||'my-letter')+'.lett.live'})}
// 스크롤 등장: 같은 묶음 안에서는 순서대로 조금씩 늦게
document.querySelectorAll('.steps,.fg,.ex,.cg,.nts').forEach(function(g){[].forEach.call(g.children,function(c,i){c.style.setProperty('--d',i*.08+'s')})});
var els=document.querySelectorAll('.kicker,section h2,.sub,.step,.f,.xc,.cc,.nc,.empty,.pl,.cmpw,.bandin');
if(!rm&&'IntersectionObserver' in window){document.documentElement.classList.add('js');
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;var el=e.target;el.classList.add('in');io.unobserve(el);setTimeout(function(){el.classList.remove('rv','in');el.style.removeProperty('--d')},1400)})},{threshold:.15,rootMargin:'0px 0px -40px 0px'});
els.forEach(function(el){el.classList.add('rv');io.observe(el)})}
// 실시간 갱신: 10초마다 탐색·강의·커뮤니티를 다시 불러와 바뀐 부분만 교체한다 (화면이 보일 때만)
var live=document.querySelectorAll('[data-live]'),busy=false;
function tick(){if(document.hidden||busy||!live.length)return;busy=true;
fetch('/home/live',{headers:{Accept:'application/json'},cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(d){if(!d)return;
live.forEach(function(box){var html=d[box.dataset.live];if(typeof html!=='string'||html===box.dataset.html)return;
var first=box.dataset.html===undefined;box.dataset.html=html;if(first&&box.innerHTML.trim()===html.trim())return;
var old={};[].forEach.call(box.querySelectorAll('a[href]'),function(a){old[a.getAttribute('href')]=1});
box.innerHTML=html;if(rm)return;
[].forEach.call(box.querySelectorAll('a[href]'),function(a){if(!old[a.getAttribute('href')]){a.classList.add('fresh')}})})}).catch(function(){}).then(function(){busy=false})}
setInterval(tick,10000);document.addEventListener('visibilitychange',function(){if(!document.hidden)tick()});
})()</script>
</body></html>`;
}
