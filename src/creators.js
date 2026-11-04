// 크리에이터 탐색: 공개된 뉴스레터를 카드로 둘러보고 프로필(/n/:slug)에서 구독한다. 구독·결제 흐름은 프로필 쪽 기존 코드를 그대로 쓴다.
import { Router } from 'express';
import { db, publicUrl } from './db.js';
import { h } from './render.js';
import { won } from './plan-data.js';
import { TOPICS, topicKey, likePat, weekAgo } from './topics.js';
import { EXPLORE_CSS, qs, searchForm, toolbar, emptyState, errorState, LOADING_JS } from './explore-ui.js';

export const creators = Router();
const PAGE = 12;
const SORTS = [['top', '인기순'], ['new', '최신순'], ['subs', '구독자순']];
const TYPES = [['', '전체'], ['free', '무료'], ['paid', '유료']];
// 인기 점수: 최근 7일 신규 구독자(×3) + 최근 7일 공개 페이지 방문(×1). 동점이면 전체 구독자, 최신순
const ORDER = {
  top: '(subs7 * 3 + views7) DESC, subs DESC, id DESC',
  new: 'id DESC',
  subs: 'subs DESC, id DESC',
};
// 자리표시자 순서: 주간 시각 ×2
const LIST_SELECT = `SELECT n.id, n.slug, n.name, n.description, n.logo, n.topic, n.price_monthly, n.price_yearly, n.subdomain, n.custom_domain, n.domain_verified_at,
  COALESCE(NULLIF(u.name,''), u.email) AS owner,
  (SELECT COUNT(*) FROM subscribers s WHERE s.newsletter_id=n.id AND s.status='active') AS subs,
  (SELECT COUNT(*) FROM subscribers s WHERE s.newsletter_id=n.id AND s.status='active' AND s.confirmed_at>=?) AS subs7,
  (SELECT COUNT(*) FROM page_views v WHERE v.newsletter_id=n.id AND v.created_at>=?) AS views7
  FROM newsletters n JOIN users u ON u.id=n.owner_id WHERE u.verified=1`;

const topicLabel = (k) => TOPICS.find(([key]) => key === k)?.[1] || '';
const compact = (n) => (n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '만' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + '천' : String(n));

const card = (n, t) => {
  const paid = n.price_monthly > 0 || n.price_yearly > 0;
  const price = paid ? won(n.price_monthly > 0 ? n.price_monthly : n.price_yearly) + (n.price_monthly > 0 ? ' / ' + t('월') : ' / ' + t('년')) : '';
  return `<article class="xcard"><div class="crow"><span class="cav" style="background:hsl(${(n.id * 47) % 360} 55% 46%)">${n.logo ? `<img src="${h(n.logo)}" alt="" loading="lazy">` : h([...n.name][0] || '·')}</span>
<div style="min-width:0"><span class="cname"><a href="${h(publicUrl(n))}">${h(n.name)}</a></span><div class="cby">${h(n.owner)}</div></div></div>
<p class="pv">${h(n.description || t('아직 소개가 없습니다.'))}</p>
<div class="xtags">${n.topic ? `<span class="tag">${h(t(topicLabel(n.topic)))}</span>` : ''}<span class="tag ${paid ? 'paid' : 'free'}">${paid ? t('유료 구독') : t('무료 구독')}</span></div>
<div class="xstat"><span>${t('구독자 {n}명', { n: compact(Number(n.subs)) })}</span>${paid ? `<span style="margin-left:auto">${h(price)}</span>` : ''}</div></article>`;
};

creators.get('/creators', async (req, res) => {
  const t = req.t;
  const q = String(req.query.q || '').trim().slice(0, 60);
  const cat = topicKey(String(req.query.cat || ''), TOPICS);
  const sort = ORDER[req.query.sort] ? String(req.query.sort) : 'top';
  const type = ['free', 'paid'].includes(req.query.type) ? String(req.query.type) : '';
  const pageNo = Math.max(0, Math.min(500, Number(req.query.page) || 0));
  const week = weekAgo();
  const where = [], args = [week, week];
  if (cat) { where.push('topic=?'); args.push(cat); }
  if (type === 'paid') where.push('(price_monthly>0 OR price_yearly>0)');
  if (type === 'free') where.push('(price_monthly=0 AND price_yearly=0)');
  if (q) { where.push('(name ILIKE ? OR description ILIKE ? OR owner ILIKE ?)'); args.push(likePat(q), likePat(q), likePat(q)); }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const here = (p = {}) => qs('/creators', { q, cat, type, sort: sort === 'top' ? '' : sort, page: pageNo, ...p });
  let body;
  try {
    const rows = await db.prepare(`SELECT * FROM (${LIST_SELECT}) x ${cond} ORDER BY ${ORDER[sort]} LIMIT ${PAGE + 1} OFFSET ${pageNo * PAGE}`).all(...args);
    const more = rows.length > PAGE;
    body = rows.length
      ? `<div class="xgrid">${rows.slice(0, PAGE).map((n) => card(n, t)).join('')}</div>`
      : emptyState({ t, q: q || cat || type ? q || t('선택한 조건') : '', reset: '/creators', title: t('아직 크리에이터가 없어요'), hint: t('첫 번째 크리에이터가 되어보세요.'), cta: `<a class="btn primary" href="/signup">${t('뉴스레터 만들기')}</a>` });
    body += more || pageNo ? `<p class="xmore">${pageNo ? `<a class="btn" href="${here({ page: pageNo - 1 })}">← ${t('이전')}</a>` : ''}${more ? `<a class="btn" href="${here({ page: pageNo + 1 })}">${t('더 보기')}</a>` : ''}</p>` : '';
  } catch (e) {
    console.error('creators list', e);
    body = errorState(t, here());
  }
  const link = (p) => qs('/creators', { q, cat, sort: sort === 'top' ? '' : sort, type, ...p });
  res.page(t('크리에이터 탐색'), `${EXPLORE_CSS}<div class="xhead"><div class="xgrow"><h1>${t('크리에이터 탐색')}</h1><p class="mute">${t('마음에 드는 크리에이터와 뉴스레터를 찾아 구독해 보세요.')}</p></div>
${searchForm('/creators', q, { cat, type, sort: sort === 'top' ? '' : sort }, t, t('크리에이터·뉴스레터 검색'))}</div>
${toolbar({ action: '/creators', cats: TOPICS, cat, sorts: SORTS, sort, defSort: 'top', q, extra: { type }, t })}
<div class="xfilter"><span>${t('구독 유형')}</span>${TYPES.map(([k, l]) => `<a class="chip${type === k ? ' on' : ''}" href="${link({ type: k, page: 0 })}">${t(l)}</a>`).join('')}</div>
${body}${LOADING_JS}`, { wide: true, active: 'creators', head: `<meta name="description" content="${h(t('마음에 드는 크리에이터와 뉴스레터를 찾아 구독해 보세요.'))}">` });
});
