// 새 뉴스레터의 기본 세팅: 환영 메일(켜짐) + 첫 글 초안
import { db, now } from './db.js';

export function createWelcome(nlId, nlName) {
  const sid = Number(db.prepare("INSERT INTO series(newsletter_id,name,created_at) VALUES(?,'환영 메일',?)").run(nlId, now()).lastInsertRowid);
  db.prepare("INSERT INTO posts(newsletter_id,kind,status,series_id,step_pos,delay_days,subject,body_md,created_at) VALUES(?,'step','auto',?,1,0,?,?,?)")
    .run(nlId, sid, `${nlName}에 오신 것을 환영합니다`,
      '{{name}}님, 구독해 주셔서 감사합니다.\n\n앞으로 이곳에서 다룰 이야기를 간단히 소개할게요.\n\n- 어떤 주제를 다루는지\n- 얼마나 자주 보내는지\n\n궁금한 점은 이 메일에 바로 답장해 주세요.\n', now());
  return sid;
}

// 자주 쓰는 글 구조 3종 (새 뉴스레터에 기본 제공, 템플릿 화면에서 다시 추가 가능)
const STARTERS = [
  ['주간 뉴스레터', '이번 주 이야기', '안녕하세요 {{name|독자}}님,\n\n이번 주에 전하고 싶은 이야기입니다.\n\n## 이번 주의 한 줄\n\n여기에 핵심을 적어보세요.\n\n## 읽을거리\n\n- [링크 제목](https://example.com) — 한 줄 설명\n- [링크 제목](https://example.com) — 한 줄 설명\n\n---\n\n읽어주셔서 감사합니다. 답장으로 의견을 들려주세요.\n'],
  ['공지', '알려드립니다', '{{name|독자}}님께 알려드립니다.\n\n## 무엇이 바뀌나요\n\n공지 내용을 적어주세요.\n\n> 중요한 한 줄을 강조할 때는 인용 블록을 쓰세요.\n\n[자세히 보기](https://example.com)\n'],
  ['큐레이션', '이번 주 링크 모음', '## 이번 주 링크\n\n1. [제목](https://example.com)\n2. [제목](https://example.com)\n3. [제목](https://example.com)\n\n## 한마디\n\n이번 주를 보내며 든 생각을 짧게 적어보세요.\n'],
];
export function addStarterTemplates(nlId) {
  for (const [name, subject, body] of STARTERS)
    db.prepare('INSERT INTO templates(newsletter_id,name,subject,body_md,created_at) VALUES(?,?,?,?,?)').run(nlId, name, subject, body, now());
}

export function seedNewsletter(nlId, nlName) {
  createWelcome(nlId, nlName);
  addStarterTemplates(nlId);
  db.prepare("INSERT INTO posts(newsletter_id,subject,preview,body_md,created_at) VALUES(?,?,?,?,?)")
    .run(nlId, '첫 번째 글', '첫 인사를 전합니다',
      '안녕하세요 {{name}}님,\n\n첫 번째 글입니다. 이 초안을 자유롭게 고쳐서 발송해 보세요.\n\n## 이번 호에서 다룰 것\n\n- 한 줄로 핵심 요약\n- [읽을거리 링크](https://example.com)\n\n읽어주셔서 감사합니다.\n', now());
}
