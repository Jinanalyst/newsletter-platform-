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

## Vercel 배포
서버리스에 맞게 구성되어 있습니다: 데이터는 **Postgres(Supabase)**, 이미지는 **Supabase Storage**, 예약 발송·시리즈 메일은 **크론 엔드포인트**(`/api/cron`)가 처리합니다.
`DATABASE_URL`이 없으면 로컬 개발용 내장 Postgres(PGlite, `data/pgdata`)로 동작하므로 `npm start`는 그대로 쓸 수 있습니다.

### 1) Supabase 준비
1. **Project Settings → Database → Connection string**에서 **Transaction pooler**(포트 6543) 문자열을 복사해 `DATABASE_URL`로 씁니다. 비밀번호가 포함되니 저장소·채팅에 올리지 마세요.
   테이블은 첫 요청 때 자동으로 만들어집니다.
2. **Project Settings → API**의 `service_role` 키를 `SUPABASE_SERVICE_ROLE_KEY`로 씁니다 (**서버 전용 비밀 키**, 브라우저·코드·채팅에 노출 금지).
   이미지 업로드용 공개 버킷(`uploads`)은 첫 업로드 때 자동 생성됩니다.
3. **Authentication → URL Configuration**에 배포 주소를 추가합니다: Site URL = `https://내도메인`, Redirect URLs = `https://내도메인/**`.

### 2) Vercel 프로젝트
1. Vercel에서 GitHub 저장소를 **Import** (Framework Preset: Other). 빌드 설정은 건드리지 않아도 됩니다(`vercel.json` 포함).
2. **Settings → Environment Variables**에 `.env.example`의 값을 넣습니다. 최소 필수:
   `DATABASE_URL`, `SECRET`(긴 랜덤 문자열), `BASE_URL`(배포 주소), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`FROM_EMAIL`(없으면 메일 발송이 실패합니다), `CRON_SECRET`(긴 랜덤 문자열).
3. 결제를 쓰면 `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`을 추가하고 Stripe 웹훅 주소를 `https://내도메인/stripe/webhook`으로 등록합니다.

### 3) 예약 발송이 나가게 하려면 (중요)
예약·시리즈·이어 보내기는 `/api/cron`이 주기적으로 호출돼야 처리됩니다.
- Vercel **Hobby** 요금제의 Cron은 **하루 1회**만 가능해서 `vercel.json`은 하루 1회로 되어 있습니다. 예약 시각이 정확하려면 아래 둘 중 하나를 쓰세요.
  - **GitHub Actions(무료, 5분마다)**: `.github/workflows/tick.yml`이 이미 들어 있습니다. 저장소 **Settings → Secrets and variables → Actions**에 `APP_URL`(예: `https://내도메인`)과 `CRON_SECRET`(Vercel에 넣은 값과 동일)을 등록하면 됩니다. (GitHub 스케줄은 몇 분 늦을 수 있습니다.)
  - **Vercel Pro**: `vercel.json`의 `schedule`을 `*/5 * * * *`로 바꿉니다.
- 지금 발송을 누르면 요청 안에서 최대 약 20초 동안 먼저 보내고, 남은 수신자는 위 주기 작업이 이어서 보냅니다(구독자가 수백 명 이상이면 몇 번에 나뉘어 나갈 수 있음).

### 알아둘 제한
- 요청 본문이 4.5MB로 제한되어 **이미지는 3MB 이하**만 올릴 수 있습니다.
- 한 번의 함수 실행은 최대 60초입니다. 대량 발송은 위처럼 여러 번에 나뉩니다.
- 요청 제한(로그인·구독 신청 등)은 DB에 기록해 여러 인스턴스에서도 동작합니다.
- 로컬 개발 데이터(`data/`)는 배포 DB로 옮겨지지 않습니다.

서버형 호스팅(Railway, Render, Fly.io 등)에 올릴 때도 같은 코드를 쓸 수 있고, `npm start`로 실행하면 내장 스케줄러가 주기 작업을 처리합니다(`DATABASE_URL`을 설정해 Postgres를 쓰세요).
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
