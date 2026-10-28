import express from 'express';
import './db.js';
import { pub } from './public.js';
import { dash } from './dashboard.js';
import { pro } from './pro.js';
import { ed } from './editor.js';
import { fileURLToPath } from 'node:url';
import { billing, stripeWebhook } from './billing.js';
import { loadUser } from './auth.js';
import { sbRouter, sbEnabled } from './supabase.js';
import { page } from './views.js';
import { startScheduler } from './send.js';

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});
// Stripe 웹훅은 서명 검증을 위해 원본 바이트가 필요하므로 다른 파서보다 먼저 연결
app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);
app.use('/static', express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: 0, index: false, dotfiles: 'deny' }));
app.use('/uploads', express.static('uploads', { maxAge: '7d', index: false, dotfiles: 'deny' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(loadUser);
app.use((req, res, next) => {
  res.page = (title, body, opts = {}) => res.send(page(title, body, { user: req.user, ...opts }));
  next();
});
app.use(sbRouter); // SUPABASE_URL 설정 시 가입·로그인·재설정을 Supabase가 처리 (미설정이면 아래 기본 라우트로 통과)
app.use(pub);
app.use(billing);
app.use(ed);   // 글 작성 도구 (블록 에디터·템플릿·가져오기)
app.use(dash);
app.use(pro);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`뉴스레터 플랫폼 실행 중 → http://localhost:${port}  (로그인: ${sbEnabled() ? 'Supabase Auth' : '자체 계정'})`);
  startScheduler();
});
