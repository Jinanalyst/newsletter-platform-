import { h } from './render.js';
import { FAVICON } from './landing.js';

const CSS = `
:root{--bg:#F8FAFC;--card:#fff;--ink:#0F172A;--mute:#64748B;--line:#E2E8F0;--soft:#F1F5F9;--accent:#0F172A;--accent-ink:#fff;--blue:#3B82F6;--blue-soft:#EEF3FF;--bad:#DC2626}
@media(prefers-color-scheme:dark){:root{--bg:#0B1120;--card:#111A2E;--ink:#E5EAF3;--mute:#94A3B8;--line:#1E293B;--soft:#16213A;--accent:#3B82F6;--accent-ink:#fff;--blue:#60A5FA;--blue-soft:#14233F;--bad:#F87171}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 'Pretendard','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;letter-spacing:-.015em;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:break-word}
a{color:var(--ink);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px;transition:text-decoration-color .15s}
a:hover{text-decoration-color:var(--blue)}
.wrap{max-width:640px;margin:0 auto;padding:56px 24px 96px}
.wrap.wide{max-width:960px}
nav{display:flex;gap:2px 18px;flex-wrap:wrap;align-items:center;padding:14px 28px;border-bottom:1px solid var(--line);font-size:14px;position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 86%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(14px);backdrop-filter:saturate(1.4) blur(14px)}
nav a{color:var(--mute);text-decoration:none;padding:2px 0;border-bottom:1px solid transparent}
nav a:hover{color:var(--ink)}
nav a.on{color:var(--ink);border-bottom-color:var(--blue)}
nav b{font-weight:600;color:var(--ink)}
.wm{font:800 22px/1 'Poppins','Plus Jakarta Sans','Pretendard',-apple-system,'Segoe UI',sans-serif;letter-spacing:-.06em;color:var(--ink)!important;border:0!important}
.wm i{color:#3B82F6;font-style:normal}
nav .brand,nav a b{color:var(--ink)}
nav .sp{flex:1}
nav .btn{padding:5px 16px}
nav form{margin:0}nav form button{border:0;background:none;padding:2px 0;color:var(--mute);font-size:14px;border-radius:0}
nav form button:hover{color:var(--ink)}
.row.nowrap{flex-wrap:nowrap}.row.nowrap>input{flex:1 1 auto;min-width:0;width:auto}
input[type=file]{border:0;padding:0;background:none;font-size:13px;color:var(--mute)}
input[type=file]::file-selector-button{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:5px 12px;margin-right:12px;cursor:pointer}
.wrap>.msg+*:not(.msg){margin-top:28px}
h1{font-size:28px;line-height:1.3;font-weight:800;margin:0 0 10px;letter-spacing:-.04em}
h2{font-size:13px;font-weight:700;color:var(--blue);margin:44px 0 14px;letter-spacing:.02em}
p{margin:0 0 14px}
code{font:12.5px ui-monospace,Consolas,monospace;background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.mute{color:var(--mute);font-size:13.5px}
.card{border:1px solid var(--line);border-radius:16px;padding:24px;margin:16px 0;background:var(--card)}
input,select,textarea{width:100%;font:inherit;font-size:14.5px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue) 18%,transparent)}
input[type=checkbox]{width:auto;accent-color:var(--blue)}
textarea{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13.5px;line-height:1.65}
label{display:block;font-size:13px;color:var(--mute);margin:16px 0 6px}
button,.btn{font:inherit;font-size:14px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:8px 20px;text-decoration:none;display:inline-block;transition:border-color .15s,background .15s,transform .15s,box-shadow .15s}
button:hover,.btn:hover{border-color:var(--blue)}
button.primary,.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
button.primary:hover,.btn.primary:hover{opacity:1;border-color:var(--accent);transform:translateY(-1px);box-shadow:0 10px 22px -12px color-mix(in srgb,var(--accent) 70%,transparent)}
button.danger{color:var(--bad)}
button.sm{padding:3px 12px;font-size:12.5px}
button:disabled{opacity:.4;cursor:not-allowed}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.row>*{flex:0 0 auto}.row>.grow{flex:1 1 200px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:11px 8px 11px 0;border-bottom:1px solid var(--line);vertical-align:middle}
th{color:var(--mute);font-weight:400;font-size:12.5px}
tr:last-child td{border-bottom:0}
.card table{margin:-6px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;border-top:1px solid var(--line);border-left:1px solid var(--line);margin:20px 0;background:var(--card);border-radius:16px;overflow:hidden}
.stat{padding:18px 20px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px;color:var(--mute)}
.stat b{display:block;font-size:28px;font-weight:700;color:var(--ink);letter-spacing:-.02em;margin-bottom:2px}
.badge{font-size:12px;color:var(--mute);white-space:nowrap}
.badge::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--line);margin-right:6px;vertical-align:1px}
.badge.active::before,.badge.sent::before{background:var(--blue)}
.badge.scheduled::before,.badge.sending::before{background:var(--mute)}
.badge.unsubscribed::before{background:var(--bad)}
.msg{padding:12px 18px;margin:0 0 12px;background:var(--blue-soft);border-left:3px solid var(--blue);font-size:14px;border-radius:0 12px 12px 0}
.msg form{margin-left:6px}
.bars{display:flex;align-items:flex-end;gap:3px;height:64px}
.bars i{flex:1;background:var(--blue);min-height:2px;border-radius:3px 3px 0 0}
.tags label{display:inline-flex;gap:6px;align-items:center;margin:4px 14px 4px 0;color:var(--ink);font-size:14px}
.editor{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px}
@media(max-width:860px){.editor{grid-template-columns:1fr}.wrap{padding:36px 18px 72px}nav{padding:14px 18px}}
iframe{width:100%;height:560px;border:1px solid var(--line);border-radius:16px;background:#fff}
.honey{position:absolute;left:-9999px}
.logo{width:64px;height:64px;border-radius:16px;object-fit:cover;background:var(--soft);border:1px solid var(--line)}
.hero{padding:56px 0 28px}.hero h1{font-size:38px;line-height:1.2;letter-spacing:-.03em;font-weight:600;margin-bottom:16px}
.hero p{font-size:17px;color:var(--mute)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.grid .card{margin:0}.grid a.card{text-decoration:none;color:inherit;display:block;transition:border-color .15s}
.grid a.card:hover{border-color:var(--blue);box-shadow:0 18px 36px -24px color-mix(in srgb,var(--blue) 60%,transparent)}
/* 블록 에디터 */
.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.sm-select{width:auto;font-size:12.5px;padding:3px 8px}
.blocks{border:1px solid var(--line);border-radius:16px;padding:16px 16px 16px 6px;min-height:260px;background:var(--card)}
.blk{display:flex;gap:2px;align-items:flex-start;padding:1px 0;border-radius:4px}
.blk .gut{display:flex;opacity:0;transition:opacity .12s;flex:0 0 auto;padding-top:3px}
.blk:hover .gut,.blk:focus-within .gut{opacity:1}
.gut button{border:0;background:none;color:var(--mute);padding:1px 5px;font-size:13px;cursor:pointer;border-radius:4px}
.gut button:hover{background:var(--soft);color:var(--ink);border:0}
.g-handle{cursor:grab}
.bbody{flex:1;min-width:0;position:relative}
.blk textarea{border:0;padding:4px 8px;resize:none;overflow:hidden;background:transparent;font:inherit;line-height:1.7;display:block;border-radius:4px}
.blk textarea:focus{border:0;background:var(--soft);box-shadow:none}
.t-h1 textarea{font-size:26px;font-weight:600;line-height:1.3;letter-spacing:-.02em}
.t-h2 textarea{font-size:20px;font-weight:600;line-height:1.35}
.t-h3 textarea{font-size:16.5px;font-weight:600}
.t-quote textarea{border-left:3px solid var(--blue);border-radius:0;padding-left:14px;color:var(--mute)}
.t-code textarea{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:var(--soft);line-height:1.6}
.t-ul textarea,.t-ol textarea{padding-left:26px}
.t-ul .bbody::before,.t-ol .bbody::before{content:'•';position:absolute;left:10px;top:4px;color:var(--mute)}
.t-ol .bbody::before{content:attr(data-n) '.';font-size:13px;top:5px}
.t-hr hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.pw{border:1px dashed var(--blue);color:var(--blue);text-align:center;font-size:12.5px;padding:6px;border-radius:6px;margin:8px 0}
.imgctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px}.imgctl input{flex:1 1 160px;font-size:13px;padding:6px 10px}
.t-img img{max-width:100%;border-radius:6px;display:block;margin-top:4px}
.bmenu{position:absolute;z-index:50;width:232px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.1);padding:4px;max-height:330px;overflow:auto}
.bmenu button{display:flex;justify-content:space-between;gap:8px;width:100%;border:0;background:none;text-align:left;padding:7px 10px;border-radius:5px;font-size:13.5px}
.bmenu button.on,.bmenu button:hover{background:var(--blue-soft);border:0}
.bmenu span{color:var(--mute);font-size:12px}.bmenu .x b{color:var(--ink);font-weight:400}
.blk.dragging{opacity:.4}.drop-above{box-shadow:0 -2px 0 var(--blue)}.drop-below{box-shadow:0 2px 0 var(--blue)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--card)}
.seg button{border:0;border-radius:0;padding:5px 14px;font-size:12.5px;background:transparent}
.seg button.on{background:var(--accent);color:var(--accent-ink)}
.editor{grid-template-columns:minmax(0,1fr)}
.pvcol{position:fixed;inset:0;z-index:100;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px}
.pvcol[hidden]{display:none}
.pvbox{background:var(--card);border-radius:16px;padding:16px;width:min(960px,100%);max-height:100%;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)}
.grow-end{margin-left:auto}
.inbox{border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:8px;font-size:13.5px;background:var(--soft)}
.inbox b{font-weight:600}.inbox div{font-weight:500}.inbox span{color:var(--mute)}
.pvwrap iframe{height:620px}
.pvwrap.mobile iframe{width:375px;max-width:100%;display:block;margin:0 auto}
.check{list-style:none;margin:0;padding:0}
.check li{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line);font-size:14.5px}
.check li:last-child{border-bottom:0}
.check .dot{width:14px;height:14px;border:1px solid var(--mute);border-radius:50%;flex:0 0 14px;position:relative;top:2px}
.check li.done{color:var(--mute)}
.check li.done .dot{background:var(--blue);border-color:var(--blue)}
.check li.done a{color:var(--mute)}
`;

// user: 로그인한 사용자, nl: 대시보드에서 작업 중인 뉴스레터
export function page(title, body, { user = null, nl = null, active = '', wide = false, msg = '', head = '', bare = false } = {}) {
  // bare: 상단 내비게이션·본문 래퍼 없이 body 를 그대로 출력 (랜딩형 페이지)
  if (bare) return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title>${FAVICON}${head}
<style>${CSS}</style></head><body>${body}</body></html>`;
  const logout = `<form method="post" action="/logout"><button>로그아웃</button></form>`;
  let nav;
  if (nl) {
    nav = `<nav><a href="/app">←</a><a href="/app/n/${nl.id}" class="brand"><b>${h(nl.name)}</b></a>
${[['', '대시보드'], ['posts', '글'], ['subscribers', '구독자'], ['automation', '자동화'], ['growth', '성장'], ['revenue', '수익'], ['settings', '설정']]
  .map(([p, l]) => `<a href="/app/n/${nl.id}${p ? '/' + p : ''}" class="${active === p ? 'on' : ''}">${l}</a>`).join('')}
<span class="sp"></span><a href="/n/${h(nl.slug)}" target="_blank">공개 페이지 ↗</a>${logout}</nav>`;
  } else if (user) {
    nav = `<nav><a href="/" class="wm" aria-label="lett. 홈">lett<i>.</i></a><a href="/app" class="${active === 'app' ? 'on' : ''}">내 뉴스레터</a>
<a href="/app/profile" class="${active === 'profile' ? 'on' : ''}">프로필</a><span class="sp"></span><span class="mute">${h(user.name || user.email)}</span>${logout}</nav>`;
  } else {
    nav = `<nav><a href="/" class="wm" aria-label="lett. 홈">lett<i>.</i></a><span class="sp"></span><a href="/login">로그인</a><a class="btn primary sm" href="/signup">시작하기</a></nav>`;
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title>${FAVICON}${head}
<style>${CSS}</style></head><body>${nav}
<div class="wrap${wide ? ' wide' : ''}">${user && !user.verified ? `<div class="msg"><b>이메일 인증이 필요합니다.</b> 인증 전에는 메일 발송·예약·테스트가 제한되고 구독을 받을 수 없습니다.
<form method="post" action="/app/resend-verification" style="display:inline"><button class="sm">인증 메일 다시 받기</button></form></div>` : ''}${msg ? `<div class="msg">${h(msg)}</div>` : ''}${body}</div></body></html>`;
}

export const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');
