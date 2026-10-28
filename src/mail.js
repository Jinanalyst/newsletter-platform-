import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';

let transport;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000, // 서버리스 시간 제한 안에서 멈추지 않도록
  });
  return transport;
}

export const smtpConfigured = () => !!process.env.SMTP_HOST;

// fromName: 뉴스레터 이름, replyTo: 발행자 이메일. 실제 발신 주소는 플랫폼 공통(FROM_EMAIL).
export async function sendMail({ to, subject, html, text, headers, fromName = '뉴스레터', replyTo }) {
  const fromEmail = process.env.FROM_EMAIL || 'newsletter@localhost';
  const t = getTransport();
  if (!t) {
    // 서버리스(Vercel)는 파일 시스템에 쓸 수 없으므로 개발용 outbox 저장을 쓰지 않고 명확히 실패시킨다
    if (process.env.VERCEL) throw new Error('SMTP 가 설정되지 않았습니다. 환경 변수 SMTP_HOST / SMTP_USER / SMTP_PASS / FROM_EMAIL 을 설정하세요.');
    mkdirSync('outbox', { recursive: true });
    const safe = to.replace(/[^a-z0-9@.]/gi, '_');
    writeFileSync(`outbox/${Date.now()}_${safe}.html`, `<!-- To: ${to}\nSubject: ${String(subject).replace(/-->/g, '--&gt;')} -->\n${html}`);
    console.log(`[outbox] ${to} — ${subject}`);
    return;
  }
  await t.sendMail({ from: `"${fromName.replace(/"/g, '')}" <${fromEmail}>`, replyTo, to, subject, html, text, headers });
}
