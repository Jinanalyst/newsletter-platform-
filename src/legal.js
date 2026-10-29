// 개인정보처리방침 · 환불 정책 (푸터에서 연결). 한국어·영어 본문, 일본어·중국어는 영어로 안내한다
import { Router } from 'express';
import { h } from './render.js';

export const legal = Router();

const EFFECTIVE = '2026-10-29';
const contact = () => process.env.SUPPORT_EMAIL || process.env.FROM_EMAIL || '';

const CSS = `<style>.lg h2{margin:34px 0 10px}.lg ul,.lg ol{margin:0 0 14px;padding-left:22px}.lg li{margin:4px 0}.lg .tbl{width:100%;border-collapse:collapse;font-size:14px;margin:6px 0 14px}.lg .tbl th,.lg .tbl td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}.lg .tbl th{color:var(--mute);font-weight:600;white-space:nowrap}</style>`;
const mail = (lang) => (contact() ? `<a href="mailto:${h(contact())}">${h(contact())}</a>` : lang === 'ko' ? '서비스 내 문의 채널' : 'the in-service contact channel');

const PRIVACY = {
  ko: () => `<h1>개인정보처리방침</h1><p class="mute">시행일 ${EFFECTIVE}</p>
<p>체인랩스(사업자등록번호 382-25-02223)가 운영하는 lett.(이하 "서비스")는 이용자의 개인정보를 소중히 다루며, 관련 법령을 준수합니다. 이 방침은 어떤 정보를 왜 수집하고, 어떻게 쓰고 보호하는지 설명합니다.</p>
<h2>1. 수집하는 개인정보</h2>
<table class="tbl"><tr><th>구분</th><th>항목</th><th>수집 시점</th></tr>
<tr><td>회원(발행자)</td><td>이메일, 이름(선택), 소개(선택), 비밀번호(암호화 저장) 또는 Google 계정 식별자</td><td>회원가입·프로필 수정</td></tr>
<tr><td>구독자</td><td>이메일, 닉네임(선택), 구독 상태, 유료 구독 여부, 메일 열람·링크 클릭 기록</td><td>뉴스레터 구독</td></tr>
<tr><td>결제</td><td>결제 일시·금액·플랜, 결제 식별자 (카드번호 등 결제 수단 정보는 결제대행사가 처리하며 서비스는 저장하지 않습니다)</td><td>유료 구독 결제</td></tr>
<tr><td>방문 기록</td><td>접속 IP·브라우저 정보를 날짜와 함께 해시한 익명 방문자 값, 유입 사이트 도메인, 조회한 페이지</td><td>공개 페이지·글 열람</td></tr>
<tr><td>커뮤니티</td><td>작성한 포스트·댓글·좋아요</td><td>이용자가 직접 작성</td></tr></table>
<h2>2. 이용 목적</h2>
<ul><li>회원 식별, 로그인 유지, 이메일 인증, 비밀번호 재설정</li><li>뉴스레터 발송, 구독 확인·해지 처리, 발행자에게 제공하는 통계(열람률·클릭률 등)</li><li>유료 구독 결제 처리와 환불</li><li>서비스 개선, 부정 이용 방지, 법령상 의무 이행</li></ul>
<h2>3. 보유 및 이용 기간</h2>
<ul><li>회원 정보: 회원 탈퇴 시까지 (탈퇴 후 지체 없이 파기)</li><li>구독자 정보: 구독 해지 또는 발행자가 삭제할 때까지</li><li>결제 기록: 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 5년</li><li>방문 기록: 집계 목적으로만 사용하며 이름·이메일과 연결하지 않는 익명 값입니다</li></ul>
<h2>4. 처리 위탁 및 제3자 제공</h2>
<p>서비스 운영을 위해 아래 업체에 처리를 위탁합니다. 그 밖에 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않으며, 법령에 따라 요구되는 경우에만 예외로 합니다.</p>
<table class="tbl"><tr><th>수탁자</th><th>위탁 업무</th></tr>
<tr><td>Stripe, 결제대행(PG)사</td><td>유료 구독·요금제 결제 처리</td></tr><tr><td>SMTP 메일 발송 사업자</td><td>뉴스레터·인증 메일 발송</td></tr>
<tr><td>Supabase, 호스팅 사업자(Vercel 등)</td><td>데이터 저장, 파일 저장, 서비스 호스팅</td></tr><tr><td>Google</td><td>Google 계정으로 로그인 (선택)</td></tr></table>
<p class="mute">일부 수탁자의 서버는 국외에 있을 수 있으며, 이 경우 이전되는 항목은 위 표의 수탁 업무에 필요한 범위로 한정됩니다.</p>
<h2>5. 쿠키</h2>
<ul><li><b>sid</b>: 로그인 상태를 유지하는 필수 쿠키입니다 (최대 14일).</li><li><b>lang</b>: 선택한 표시 언어를 기억합니다 (최대 1년).</li><li>방문 통계는 쿠키 없이 집계하며, 광고·추적용 쿠키는 사용하지 않습니다.</li></ul>
<h2>6. 이용자의 권리</h2>
<p>이용자는 언제든지 자신의 개인정보를 열람·정정·삭제하거나 처리 정지를 요청할 수 있습니다. 구독자는 모든 메일 하단의 해지 링크로 직접 구독을 해지할 수 있고, 회원은 프로필·설정에서 정보를 수정하거나 문의를 통해 탈퇴를 요청할 수 있습니다.</p>
<h2>7. 안전성 확보 조치</h2>
<ul><li>비밀번호는 단방향 암호화(해시)하여 저장합니다.</li><li>전송 구간은 HTTPS로 보호하고, 데이터 접근 권한을 필요한 범위로 제한합니다.</li><li>로그인 시도·요청 횟수 제한으로 부정 접근을 줄입니다.</li></ul>
<h2>8. 문의처</h2>
<p>개인정보 관련 문의: ${mail('ko')}</p>
<h2>9. 방침 변경</h2>
<p>이 방침이 바뀌는 경우 시행 7일 전에 이 페이지에 공지합니다.</p>`,
  en: () => `<h1>Privacy Policy</h1><p class="mute">Effective ${EFFECTIVE}</p>
<p>lett. ("the Service") handles your personal information with care and complies with applicable law. This policy explains what we collect, why, and how it is used and protected.</p>
<h2>1. Information we collect</h2>
<table class="tbl"><tr><th>Who</th><th>Data</th><th>When</th></tr>
<tr><td>Members (publishers)</td><td>Email, name and bio (optional), password (stored hashed) or Google account ID</td><td>Sign-up, profile edits</td></tr>
<tr><td>Subscribers</td><td>Email, nickname (optional), subscription status, paid status, email open and link-click records</td><td>Subscribing</td></tr>
<tr><td>Payments</td><td>Date, amount, plan and payment ID. Card details are handled by the payment processor and are not stored by the Service.</td><td>Paid subscription</td></tr>
<tr><td>Visits</td><td>An anonymous visitor value (IP and browser info hashed with the date), referring domain, page viewed</td><td>Viewing public pages</td></tr>
<tr><td>Community</td><td>Posts, comments and likes you write</td><td>When you post</td></tr></table>
<h2>2. How we use it</h2>
<ul><li>Account identification, sign-in, email verification, password reset</li><li>Sending newsletters, handling subscribe/unsubscribe, and statistics shown to publishers</li><li>Processing paid subscriptions and refunds</li><li>Improving the Service, preventing abuse and meeting legal obligations</li></ul>
<h2>3. Retention</h2>
<ul><li>Member data: until the account is deleted</li><li>Subscriber data: until the subscriber unsubscribes or the publisher removes them</li><li>Payment records: 5 years as required by Korean e-commerce law</li><li>Visit records: anonymous values used only for aggregate statistics</li></ul>
<h2>4. Processors and third parties</h2>
<table class="tbl"><tr><th>Processor</th><th>Purpose</th></tr><tr><td>Stripe, payment gateway (PG) provider</td><td>Payment processing for paid subscriptions and plans</td></tr><tr><td>SMTP email provider</td><td>Sending newsletters and verification email</td></tr>
<tr><td>Supabase and hosting providers (e.g. Vercel)</td><td>Data and file storage, hosting</td></tr><tr><td>Google</td><td>Optional Google sign-in</td></tr></table>
<p>We do not provide personal information to other third parties without consent, except where required by law. Some processors may operate servers outside Korea.</p>
<h2>5. Cookies</h2>
<ul><li><b>sid</b>: required sign-in session cookie (up to 14 days).</li><li><b>lang</b>: remembers your display language (up to 1 year).</li><li>Visit statistics are cookie-free. We do not use advertising or tracking cookies.</li></ul>
<h2>6. Your rights</h2>
<p>You may access, correct or delete your information, or ask us to stop processing it, at any time. Subscribers can unsubscribe with the link at the bottom of every email; members can edit their profile or contact us to close the account.</p>
<h2>7. Security</h2>
<ul><li>Passwords are stored as one-way hashes.</li><li>Data in transit is protected with HTTPS and access is limited to what is needed.</li><li>Rate limits reduce abusive access.</li></ul>
<h2>8. Contact</h2><p>Privacy inquiries: ${mail('en')}</p>
<h2>9. Changes</h2><p>We will announce changes on this page at least 7 days before they take effect.</p>`,
};

const REFUND = {
  ko: () => `<h1>환불 정책</h1><p class="mute">시행일 ${EFFECTIVE}</p>
<h2>1. 환불 기간</h2>
<p>Pro·Business 요금제와 뉴스레터 유료 구독 모두, <b>결제일로부터 7일 이내</b>에 요청하시면 결제 금액을 환불해 드립니다. 월간·연간 플랜 모두 동일합니다.</p>
<h2>2. 7일이 지난 경우</h2>
<p>결제일로부터 7일이 지난 뒤에는 환불이 어렵습니다. 다만 구독은 언제든 해지할 수 있으며, 해지하면 이미 결제한 기간이 끝날 때까지 유료 혜택을 이용하고 <b>다음 결제부터 청구되지 않습니다.</b></p>
<h2>3. 환불 요청 방법</h2>
<p>${mail('ko')}로 아래 내용을 보내 주세요.</p><ul><li>구독 시 사용한 이메일 주소</li><li>구독 중인 뉴스레터 이름</li><li>결제일과 결제 금액</li></ul>
<h2>4. 처리 절차</h2>
<ul><li>요청이 접수되면 결제 내역과 기간을 확인한 뒤 처리 결과를 이메일로 안내합니다.</li><li>환불은 원래 결제하신 수단으로 진행되며, 결제 수단·카드사에 따라 실제 반영까지 시간이 걸릴 수 있습니다.</li><li>환불이 완료되면 해당 뉴스레터의 유료 구독 혜택은 종료됩니다.</li></ul>
<h2>5. 문의</h2><p>환불 관련 문의: ${mail('ko')}</p>`,
  en: () => `<h1>Refund Policy</h1><p class="mute">Effective ${EFFECTIVE}</p>
<h2>1. Refund window</h2>
<p>For the Pro and Business plans and for newsletter paid subscriptions, you can request a refund <b>within 7 days of the payment date</b>. This applies to both monthly and yearly plans.</p>
<h2>2. After 7 days</h2>
<p>Refunds are not available once 7 days have passed since payment. You can still cancel at any time: paid benefits continue until the end of the period you already paid for, and <b>you will not be charged again.</b></p>
<h2>3. How to request</h2>
<p>Email ${mail('en')} with:</p><ul><li>The email address you subscribed with</li><li>The newsletter name</li><li>The payment date and amount</li></ul>
<h2>4. Process</h2>
<ul><li>We verify the payment and date, then email you the result.</li><li>Refunds go back to the original payment method; it may take some time to appear depending on your card or bank.</li><li>Paid benefits for that newsletter end once the refund is completed.</li></ul>
<h2>5. Contact</h2><p>Refund inquiries: ${mail('en')}</p>`,
};

const view = (doc, title) => (req, res) => {
  const lang = doc[req.lang] ? req.lang : req.lang === 'ko' ? 'ko' : 'en';
  res.page(title[lang], `${CSS}<div class="lg">${doc[lang]()}</div>`, { head: `<meta name="robots" content="index,follow">` });
};
legal.get('/privacy', view(PRIVACY, { ko: '개인정보처리방침', en: 'Privacy Policy' }));
legal.get('/refund', view(REFUND, { ko: '환불 정책', en: 'Refund Policy' }));
