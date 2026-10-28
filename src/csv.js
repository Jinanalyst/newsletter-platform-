// 구독자 가져오기용 느슨한 CSV 파서: 쉼표·세미콜론·탭 구분, 따옴표, 머리글 줄, 열 순서 자동 인식
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

// 반환: { rows: [{email, name}], invalid: 잘못된 줄 수, dup: 파일 안 중복 수 }
export function parseSubscribers(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 20).join('\n');
  const count = (c) => sample.split(c).length - 1;
  const d = count('\t') ? '\t' : count(';') > count(',') ? ';' : ',';
  const table = lines.map((l) => splitLine(l, d));

  // 첫 줄에 이메일이 없고 '이메일/email/이름/name' 같은 단어가 있으면 머리글로 본다
  let emailCol = -1, nameCol = -1;
  const head = table[0] || [];
  if (head.length && !head.some((c) => EMAIL_RE.test(c)) && head.some((c) => /mail|메일|name|이름|닉네임/i.test(c))) {
    emailCol = head.findIndex((c) => /mail|메일/i.test(c));
    nameCol = head.findIndex((c) => /name|이름|닉네임/i.test(c));
    table.shift();
  }

  const rows = [], seen = new Set();
  let invalid = 0, dup = 0;
  for (const cells of table) {
    const ei = emailCol >= 0 && EMAIL_RE.test(cells[emailCol] || '') ? emailCol : cells.findIndex((c) => EMAIL_RE.test(c));
    if (ei < 0) { invalid++; continue; }
    const email = cells[ei].toLowerCase();
    if (seen.has(email)) { dup++; continue; }
    seen.add(email);
    const name = nameCol >= 0 && nameCol !== ei ? cells[nameCol] : cells.find((c, i) => i !== ei && c && !EMAIL_RE.test(c));
    rows.push({ email, name: String(name || '').slice(0, 80) });
  }
  return { rows, invalid, dup };
}
