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
  });
  return transport;
}

export const smtpConfigured = () => !!process.env.SMTP_HOST;

// fromName: 뉴스레터 이름, replyTo: 발행자 이메일. 실제 발신 주소는 플랫폼 공통(FROM_EMAIL).
export async function sendMail({ to, subject, html, text, headers, fromName = '뉴스레터', replyTo }) {
  const fromEmail = process.env.FROM_EMAIL || 'newsletter@localhost';
  const t = getTransport();
  if (!t) {
    mkdirSync('outbox', { recursive: true });
    const safe = to.replace(/[^a-z0-9@.]/gi, '_');
    writeFileSync(`outbox/${Date.now()}_${safe}.html`, `<!-- To: ${to}\nSubject: ${String(subject).replace(/-->/g, '--&gt;')} -->\n${html}`);
    console.log(`[outbox] ${to} — ${subject}`);
    return;
  }
  await t.sendMail({ from: `"${fromName.replace(/"/g, '')}" <${fromEmail}>`, replyTo, to, subject, html, text, headers });
}
