// 커뮤니티(/posts)와 크리에이터 탐색(/creators)이 함께 쓰는 탐색형 레이아웃: 검색창 · 가로 카테고리 · 정렬 · 카드 그리드 · 상태 화면
import { h } from './render.js';

export const EXPLORE_CSS = `<style>
.wrap.wide{max-width:1200px}
.xhead{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px}.xhead h1{margin:0}.xhead p{margin:4px 0 0}
.xhead .xgrow{flex:1;min-width:220px}
.xsearch{display:flex;gap:8px;flex:1 1 320px;max-width:460px;margin:0}
.xsearch input{border-radius:999px;padding:10px 18px;margin:0}.xsearch button{flex:0 0 auto}
.xbar{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);margin:0 0 16px;padding-bottom:12px}
.xcats{display:flex;gap:8px;overflow-x:auto;flex:1;min-width:0;scrollbar-width:none;padding:2px 0}.xcats::-webkit-scrollbar{display:none}
.xcats .chip{white-space:nowrap;flex:0 0 auto}
.xsort{display:flex;gap:6px;align-items:center;flex:0 0 auto}.xsort .chip{padding:4px 12px;font-size:12.5px}
.xfilter{display:flex;gap:8px;align-items:center;margin:0 0 16px;flex-wrap:wrap;color:var(--mute);font-size:13.5px}
.xgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;transition:opacity .15s}
.xgrid.loading{opacity:.45;pointer-events:none}
.xcard{position:relative;display:flex;flex-direction:column;gap:10px;border:1px solid var(--line);border-radius:16px;background:var(--card);padding:18px;transition:border-color .15s,box-shadow .15s,transform .15s;min-width:0}
.xcard:hover{border-color:var(--blue);box-shadow:0 18px 36px -24px color-mix(in srgb,var(--blue) 60%,transparent);transform:translateY(-2px)}
.xcard h3{margin:0;font-size:16.5px;line-height:1.4;letter-spacing:-.01em;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.xcard h3 a{color:inherit;text-decoration:none}.xcard h3 a::after{content:'';position:absolute;inset:0;border-radius:16px}
.xcard .pv{margin:0;color:var(--mute);font-size:14px;line-height:1.6;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;flex:1}
.xtags{display:flex;gap:6px;flex-wrap:wrap;min-height:22px}
.tag{font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 9px;background:var(--soft);color:var(--mute);white-space:nowrap}
.tag.hot{background:#FFF1E6;color:#EA580C}.tag.new{background:var(--blue-soft);color:var(--blue)}.tag.paid{background:#F3EEFF;color:#7C3AED}.tag.free{background:#E8F7EE;color:#16A34A}
.xmeta{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--mute)}.xmeta b{color:var(--ink);font-weight:600;font-size:13px}
.xmeta .av{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;flex:0 0 24px}
.xstat{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--mute);border-top:1px solid var(--line);padding-top:10px;margin-top:2px}
.xstat span,.xstat button{display:inline-flex;align-items:center;gap:5px}
.xstat button{position:relative;z-index:1;border:0;background:none;padding:0;color:var(--mute);font-size:13px;border-radius:0}.xstat button:hover{color:var(--ink);border:0}
.xstat svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.xstat .lk.on{color:#E11D48}.xstat .lk.on svg{fill:#E11D48;stroke:#E11D48}
.xsec{display:flex;align-items:center;gap:10px;margin:26px 0 12px}.xsec h2{margin:0;font-size:18px}.xsec small{color:var(--mute)}
.xmore{text-align:center;margin:28px 0 0;display:flex;gap:10px;justify-content:center}
.xstate{border:1px dashed var(--line);border-radius:16px;padding:52px 20px;text-align:center;color:var(--mute);margin-top:8px}
.xstate b{display:block;color:var(--ink);font-size:17px;margin-bottom:6px}.xstate .btn{margin-top:14px}
.xstate.err{border-color:#FCA5A5;background:#FEF2F2}
.xcard .crow{display:flex;align-items:center;gap:12px}
.xcard .cav{width:56px;height:56px;border-radius:50%;object-fit:cover;flex:0 0 56px;background:var(--soft);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:22px}
.xcard .cav img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.xcard .cname{font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}.xcard .cname a{color:inherit;text-decoration:none}.xcard .cname a::after{content:'';position:absolute;inset:0;border-radius:16px}
.xcard .cby{color:var(--mute);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr summary{list-style:none;cursor:pointer}.wr summary::-webkit-details-marker{display:none}
.wr .compose{margin-top:12px}
.compose .ti{border:0;border-bottom:1px solid var(--line);border-radius:0;padding:6px 0 10px;font-size:17px;font-weight:700;margin:0 0 6px;background:transparent}
.compose .ti:focus{box-shadow:none;border-color:var(--blue)}
.compose select{width:auto;border-radius:999px;padding:6px 14px;font-size:13px;margin:0}
@media(max-width:1180px){.xgrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:860px){.xgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.xbar{flex-direction:column;align-items:stretch;gap:10px}.xsort{justify-content:flex-start}}
@media(max-width:560px){.xgrid{grid-template-columns:1fr}.xsearch{max-width:none}}
</style>`;

// 쿼리스트링 조립: 값이 비어 있으면 생략한다
export const qs = (base, params) => {
  const s = Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== 0).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? `${base}?${s}` : base;
};

// 검색창 (카테고리·정렬 등 다른 조건은 hidden 으로 유지해 동시에 적용된다)
export const searchForm = (action, q, keep, t, ph) => `<form class="xsearch" method="get" action="${action}" role="search">
${Object.entries(keep).filter(([, v]) => v).map(([k, v]) => `<input type="hidden" name="${k}" value="${h(v)}">`).join('')}
<input type="search" name="q" value="${h(q)}" maxlength="60" placeholder="${h(ph)}" aria-label="${h(ph)}"><button class="primary">${t('검색')}</button></form>`;

// 가로 카테고리 + 정렬 줄. cats: [[key,label]], sorts: [[key,label]]
export const toolbar = ({ action, cats, cat, sorts, sort, defSort, q, extra = {}, t }) => {
  const link = (p) => qs(action, { q, cat, sort: sort === defSort ? '' : sort, ...extra, ...p });
  return `<div class="xbar"><nav class="xcats" aria-label="${t('카테고리')}">
${[['', t('전체')], ...cats.map(([k, l]) => [k, t(l)])].map(([k, l]) => `<a class="chip${cat === k ? ' on' : ''}" href="${link({ cat: k, page: 0 })}">${h(l)}</a>`).join('')}</nav>
<div class="xsort" role="group" aria-label="${t('정렬')}">${sorts.map(([k, l]) => `<a class="chip${sort === k ? ' on' : ''}" href="${link({ sort: k === defSort ? '' : k, page: 0 })}">${t(l)}</a>`).join('')}</div></div>`;
};

export const emptyState = ({ t, q, reset, title, hint, cta }) => `<div class="xstate"><b>${q ? t('"{q}"에 대한 결과가 없어요', { q: h(q) }) : title}</b>${q ? t('검색어를 바꾸거나 조건을 줄여 보세요.') : hint}<br>
${q ? `<a class="btn" href="${reset}">${t('조건 초기화')}</a>` : cta || ''}</div>`;

export const errorState = (t, retry) => `<div class="xstate err" role="alert"><b>${t('목록을 불러오지 못했어요')}</b>${t('잠시 후 다시 시도해 주세요.')}<br><a class="btn primary" href="${retry}">${t('다시 시도')}</a></div>`;

// 이동 중 목록을 흐리게 하고 스켈레톤을 보여주는 스크립트
export const LOADING_JS = `<script>(function(){var g=document.querySelector('.xgrid:not([data-sk])');
function go(){if(g)g.classList.add('loading')}
document.querySelectorAll('.xcats a,.xsort a,.xmore a').forEach(function(a){a.addEventListener('click',go)});
var f=document.querySelector('.xsearch');if(f)f.addEventListener('submit',go);
window.addEventListener('pageshow',function(e){if(e.persisted&&g)g.classList.remove('loading')})})();</script>`;
