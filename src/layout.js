// 공개 페이지 레이아웃: 발행자가 공개 페이지에서 직접 편집한 설정(JSON)의 검증 · 적용
export const WIDTHS = ['narrow', 'normal', 'wide'];
export const VIEWS = ['list', 'grid'];
export const HEROES = ['compact', 'normal', 'tall'];
// 상단 배치: stack=소개 위·구독 폼 아래(기본), left=소개 왼쪽·폼 오른쪽, right=폼 왼쪽·소개 오른쪽
export const SPLITS = ['stack', 'left', 'right'];

export function readLayout(nl) {
  let v = {};
  try { v = JSON.parse(nl.layout || '{}') || {}; } catch { /* 깨진 값은 기본값으로 */ }
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);
  return {
    width: WIDTHS.includes(v.width) ? v.width : 'normal',
    view: VIEWS.includes(v.view) ? v.view : 'list',
    hero: HEROES.includes(v.hero) ? v.hero : 'normal',
    split: SPLITS.includes(v.split) ? v.split : 'stack',
    order: ids(v.order),
    hidden: ids(v.hidden),
  };
}

// 요청 본문 → 저장용 JSON. 이 뉴스레터의 글 id 만 남긴다
export function cleanLayout(body, validIds) {
  const ok = new Set(validIds);
  const l = readLayout({ layout: JSON.stringify(body || {}) });
  l.order = l.order.filter((id) => ok.has(id));
  l.hidden = l.hidden.filter((id) => ok.has(id));
  return l;
}

// 저장된 순서대로 정렬: 순서에 없는 새 글은 맨 위(최신순), 그다음 지정된 순서
export function applyOrder(posts, layout) {
  const rank = new Map(layout.order.map((id, i) => [id, i]));
  const fresh = posts.filter((p) => !rank.has(p.id));
  const ranked = posts.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  return [...fresh, ...ranked];
}
