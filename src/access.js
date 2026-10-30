// 뉴스레터 접근 권한: 소유자 또는 초대를 수락한 팀원. 팀원은 설정·삭제·레이아웃을 제외한 운영 화면을 쓸 수 있다
import { db } from './db.js';

export const OWNER_ONLY = /^\/app\/n\/\d+\/(settings|delete|layout)(\/|$)/;

export const findNewsletter = async (id, user) => {
  const nl = await db.prepare(`SELECT n.* FROM newsletters n WHERE n.id=? AND (n.owner_id=? OR EXISTS
    (SELECT 1 FROM team_members m WHERE m.newsletter_id=n.id AND m.user_id=? AND m.status='active'))`).get(id, user.id, user.id);
  return nl && { ...nl, is_owner: nl.owner_id === user.id };
};
