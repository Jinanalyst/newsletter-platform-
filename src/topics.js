// 커뮤니티 글과 크리에이터(뉴스레터)가 함께 쓰는 탐색 카테고리. 키는 DB 에 저장되고, 라벨은 화면에서 번역한다.
export const TOPICS = [
  ['finance', '경제·금융'],
  ['tech', '기술·IT'],
  ['business', '비즈니스'],
  ['life', '라이프스타일'],
];
// 커뮤니티에는 '질문'이 추가로 있다
export const NOTE_TOPICS = [...TOPICS, ['question', '질문']];
export const topicKey = (v, list = NOTE_TOPICS) => (list.some(([k]) => k === v) ? v : '');

// LIKE 패턴용 이스케이프 (사용자 입력의 % _ \ 를 문자 그대로 검색)
export const likePat = (q) => '%' + String(q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
// 최근 7일 기준 시각(ISO)
export const weekAgo = () => new Date(Date.now() - 7 * 86400_000).toISOString();
