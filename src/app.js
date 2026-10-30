import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pub } from './public.js';
import { feed } from './feed.js';
import { legal } from './legal.js';
import { plans } from './plans.js';
import { dash } from './dashboard.js';
import { pro } from './pro.js';
import { creator } from './create.js';
import { settle } from './settlement.js';
import { ed } from './editor.js';
import { billing, stripeWebhook } from './billing.js';
import { loadUser } from './auth.js';
import { sbRouter, sbEnabled } from './supabase.js';
import { page } from './views.js';
import { langMiddleware, langRoute, tr } from './i18n.js';
import { startScheduler, tick } from './send.js';

const app = express();
app.set('trust proxy', process.env.VERCEL ? 1 : 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});

// Stripe 웹훅은 서명 검증을 위해 원본 바이트가 필요하므로 다른 파서보다 먼저 연결
app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);

// 예약 발송·시리즈·이어 보내기를 처리하는 주기 작업. Vercel Cron(또는 외부 스케줄러)이 CRON_SECRET 과 함께 호출한다.
app.get('/api/cron', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET || '';
    const given = String(req.headers.authorization || '');
    const want = `Bearer ${secret}`;
    const okAuth = secret && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
    if (!okAuth) return res.status(401).json({ error: 'unauthorized' });
    res.json({ ok: true, ...(await tick(Number(process.env.CRON_BUDGET_MS || 50_000))) });
  } catch (e) { next(e); }
});

app.use('/static', express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: '5m', index: false, dotfiles: 'deny' }));
app.use('/uploads', express.static('uploads', { maxAge: '7d', index: false, dotfiles: 'deny' })); // 로컬 개발용 업로드 폴더
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
// Express 5 는 본문이 없는 POST(예: 입력칸 없는 "새 글" 버튼)에서 req.body 를 undefined 로 둔다 → 핸들러가 req.body.x 로 터지지 않게 빈 객체로
app.use((req, res, next) => { req.body ??= {}; next(); });
app.use(loadUser);
app.use(langMiddleware);
app.get('/lang/:code', langRoute);
app.use((req, res, next) => {
  res.page = (title, body, opts = {}) => res.send(page(title, body, { user: req.user, lang: req.lang, ...opts }));
  next();
});
app.use(sbRouter); // SUPABASE_URL 설정 시 가입·로그인·재설정을 Supabase가 처리 (미설정이면 아래 기본 라우트로 통과)
app.use(pub);
app.use(feed); // 커뮤니티 포스트(/posts)
app.use(legal); // 개인정보처리방침(/privacy) · 환불 정책(/refund)
app.use(creator); // 크리에이트(/create) · 상품 페이지(/c/:id)
app.use(settle); // 통합 정산(/settlement) · 운영자 정산 처리(/admin/payouts)
app.use(plans); // 요금제(/pricing) · 결제(PG 연동 지점)
app.use(billing);
app.use(ed);   // 글 작성 도구 (블록 에디터·템플릿·가져오기)
app.use(dash);
app.use(pro);

app.use((req, res) => res.status(404).page(req.t('찾을 수 없음'), `<h1>${req.t('페이지를 찾을 수 없습니다')}</h1><p><a href="/">${req.t('홈으로')}</a></p>`));
// 처리되지 않은 오류(DB 연결 문제 등): 내부 정보는 숨기고 로그에만 남긴다
app.use((err, req, res, next) => {
  console.error('요청 처리 오류', req.method, req.path, err);
  if (res.headersSent) return next(err);
  const t = req.t || tr('ko');
  const send = (body) => (res.page ? res.status(500).page(t('오류'), body) : res.status(500).send('서버 오류'));
  send(`<h1>${t('일시적인 오류가 발생했습니다')}</h1><p>${t('잠시 후 다시 시도해 주세요.')}</p><p><a href="/">${t('홈으로')}</a></p>`);
});

export default app;

// 로컬/서버형 호스팅: 직접 실행. Vercel 에서는 api/index.js 가 이 앱을 함수로 노출한다.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`뉴스레터 플랫폼 실행 중 → http://localhost:${port}  (로그인: ${sbEnabled() ? 'Supabase Auth' : '자체 계정'}, DB: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'Postgres' : '로컬 PGlite'})`);
    startScheduler();
  });
}
