# 뉴스레터 플랫폼

여러 발행자가 가입해서 각자 뉴스레터를 만들고, 이메일로 발송하고, 독자가 구독하는 플랫폼 (초안).
기능 현황과 로드맵은 [FEATURES.md](FEATURES.md) 참고.

## 실행
```
npm install
copy .env.example .env     # 그리고 SECRET 값을 긴 랜덤 문자열로 변경
npm start
```
- 접속: http://localhost:3000 → "시작하기"로 가입 → 뉴스레터 개설 → 글 작성
- 독자용 구독 페이지: `http://localhost:3000/n/<내 뉴스레터 주소>`

## 배포 시 주의 (Vercel 등)
이 앱은 **계속 켜져 있는 Node 서버**를 전제로 합니다. 데이터는 로컬 SQLite 파일(`data/`), 이미지는 `uploads/` 폴더에 저장하고,
예약 발송·시리즈 메일은 서버 안의 타이머가 처리합니다.
- **Vercel 같은 서버리스 환경**은 파일 시스템이 유지되지 않고 백그라운드 타이머가 돌지 않아 그대로는 동작하지 않습니다
  (가입·글·구독자 데이터가 사라지고 예약 발송이 나가지 않음). Vercel에 올리려면 DB를 Supabase(Postgres)로, 이미지를 Supabase Storage로,
  예약 발송을 Vercel Cron으로 옮기는 작업이 필요합니다.
- **그대로 배포하려면** 디스크(볼륨)를 붙일 수 있는 서버형 호스팅(Railway, Render, Fly.io, VPS 등)을 사용하세요. 이때 `.env`의 값은 호스팅의 환경 변수 설정에 넣습니다.
- `.env`, `data/`, `uploads/`, `outbox/`는 저장소에 올라가지 않습니다(`.gitignore`).

## 메일 발송
`.env`에 SMTP 정보를 채우면 실제로 발송됩니다. 비워두면 `outbox/` 폴더에 HTML 파일로 저장되어
화면만 확인할 수 있습니다(구독 확인 메일 포함). Gmail은 앱 비밀번호가 필요합니다.

## 유료 구독 (Stripe)
1. Stripe 대시보드에서 API 비밀키를 받아 `.env`의 `STRIPE_SECRET_KEY`에 넣습니다 (처음엔 테스트 모드 키 `sk_test_...` 권장).
2. 개발 중에는 [Stripe CLI](https://stripe.com/docs/stripe-cli)로 웹훅을 전달합니다:
   `stripe listen --forward-to localhost:3000/stripe/webhook` → 출력되는 `whsec_...`를 `STRIPE_WEBHOOK_SECRET`에 넣습니다.
   운영에서는 대시보드에서 `{BASE_URL}/stripe/webhook` 엔드포인트를 만들고 `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted` 이벤트를 선택합니다.
3. 뉴스레터의 "수익" 탭에서 월간/연간 가격을 설정하면 `/n/<주소>/upgrade`에서 구독자가 결제할 수 있습니다.
   테스트 카드: `4242 4242 4242 4242`.

## Supabase 로그인
`.env`에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`가 있으면 가입·로그인·비밀번호 재설정·Google 로그인이 Supabase Auth로 처리됩니다
(없으면 자체 계정 방식). 글·구독자 등 데이터는 기존 SQLite에 그대로 저장되고, Supabase 사용자와 `users.supabase_id`로 연결됩니다.
**publishable 키만 사용하세요. `service_role`/secret 키는 이 앱에 넣지 않습니다.**

Supabase 대시보드에서 해야 할 설정:
1. **Authentication → URL Configuration**: Site URL = `BASE_URL`(예: `http://localhost:3000`), Redirect URLs에 `http://localhost:3000/**` 추가
   (운영 도메인을 쓰면 `https://내도메인/**`도 추가). 이 설정이 없으면 메일 링크가 로그인 페이지로 돌아오지 못합니다.
2. **Authentication → Emails → SMTP Settings**: 기본 내장 메일은 **시간당 몇 통**으로 제한되어 가입자가 늘면 인증 메일이 막힙니다. 운영 전 자체 SMTP를 연결하세요.
3. (선택) **Authentication → Sign In / Providers → Google**: Client ID/Secret 입력 후 활성화. 승인된 리디렉션 URI는 Google Cloud 콘솔에
   `https://<프로젝트>.supabase.co/auth/v1/callback`을 등록합니다.
4. 가입 확인 메일 링크는 **가입한 같은 브라우저**에서 열어야 자동 로그인됩니다(다른 기기에서 열면 인증만 완료되고 로그인 화면으로 이동).

## Google 로그인 (Supabase 없이 직접 연동하는 경우)
Google Cloud Console에서 OAuth 클라이언트를 만들고 승인된 리디렉션 URI에
`{BASE_URL}/auth/google/callback`을 등록한 뒤 `.env`의 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`을 채우세요.

## 구조
```
src/app.js        서버 진입점
src/auth.js       세션·비밀번호
src/public.js     홈, 가입/로그인, 뉴스레터 공개 페이지, 구독/해지, 추적
src/dashboard.js  발행자 영역(/app): 뉴스레터, 에디터, 구독자, 통계, 설정, 업로드
src/send.js       발송 엔진·예약 스케줄러
data/newsletter.db  SQLite (백업은 이 파일 + uploads/)
```
