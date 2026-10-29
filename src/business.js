// 사업자 정보 (전자상거래법상 푸터 표시 항목). 사업자등록증 기준. 렌더 모듈만 가져와 landing·views 어디서든 쓸 수 있다
import { h } from './render.js';

export const BIZ = {
  name: '체인랩스',
  owner: '장진우',
  regNo: '382-25-02223',
  address: '경기도 성남시 중원구 여수울로 50, 406동 403호 (여수동, 연꽃마을)',
};

// 통신판매업 신고번호·고객센터는 신고/개통 후 환경 변수로 채우면 푸터에 나타난다
const env = () => ({
  mailOrderNo: process.env.BIZ_MAIL_ORDER_NO || '',
  email: process.env.SUPPORT_EMAIL || '',
  phone: process.env.SUPPORT_PHONE || '',
});

export function bizInfo(t = (s) => s) {
  const e = env();
  const items = [
    [t('상호'), BIZ.name], [t('대표'), BIZ.owner], [t('사업자등록번호'), BIZ.regNo],
    ...(e.mailOrderNo ? [[t('통신판매업 신고번호'), e.mailOrderNo]] : []),
    [t('주소'), BIZ.address],
    ...(e.email ? [[t('이메일'), e.email]] : []),
    ...(e.phone ? [[t('전화'), e.phone]] : []),
  ];
  return `<div class="biz">${items.map(([k, v]) => `<span>${h(k)} ${h(v)}</span>`).join('')}</div>`;
}
