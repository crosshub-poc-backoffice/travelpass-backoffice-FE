// 역할별 메뉴 권한. 메뉴권한표.md 기준이며 서버(권한 확인)와 화면(메뉴 표시)이 같이 쓴다.

export const ROLES = ['crosshub', 'affiliate', 'partner'] as const
export type Role = (typeof ROLES)[number]

export type Menu =
  | 'dashboard'
  | 'products'
  | 'inquiries'
  | 'partners'
  | 'accounts'
  | 'activityLogs'
  | 'settings'

// full = 조회 + 등록·수정·삭제·처리, read = 조회만, none = 접근 불가
type Access = 'full' | 'read' | 'none'

const MENU_ACCESS: Record<Menu, Record<Role, Access>> = {
  dashboard: { crosshub: 'read', affiliate: 'read', partner: 'read' },
  products: { crosshub: 'full', affiliate: 'full', partner: 'full' },
  inquiries: { crosshub: 'full', affiliate: 'full', partner: 'full' },
  // 연맹은 대행 업체만, 업체는 자기 업체만("내 업체 정보") — 범위는 세션의 managedPartners로 거른다.
  // 업체 등록·활성화·운영방식·수수료율은 서비스(lib/server/partners/service.ts)에서 역할별로 막는다
  partners: { crosshub: 'full', affiliate: 'full', partner: 'full' },
  // 계정 관리(계정 발급·연맹 추가)는 크로스허브만
  accounts: { crosshub: 'full', affiliate: 'none', partner: 'none' },
  // 관리자 메뉴(작업 이력·접속 기록)는 크로스허브만, 조회만
  activityLogs: { crosshub: 'read', affiliate: 'none', partner: 'none' },
  // 내 언어·비밀번호 설정
  settings: { crosshub: 'full', affiliate: 'full', partner: 'full' },
}

export function canAccess(role: Role, menu: Menu): boolean {
  return MENU_ACCESS[menu][role] !== 'none'
}

export function canEdit(role: Role, menu: Menu): boolean {
  return MENU_ACCESS[menu][role] === 'full'
}

/** 상품 등록(새로 만들기)은 연맹·업체만. 크로스허브는 등록된 상품의 수정·삭제·승인만 한다 */
export function canCreateProduct(role: Role): boolean {
  return role !== 'crosshub'
}

/** 이미 노출중/숨김인 상품에 연맹·업체가 올린 변경요청(수정·삭제·숨김전환)의 승인·반려는 크로스허브만 */
export function canApproveChangeRequest(role: Role): boolean {
  return role === 'crosshub'
}
