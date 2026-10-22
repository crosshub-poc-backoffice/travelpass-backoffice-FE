// 계정 상태 구분. 화면(필터)과 서버(조회 조건)가 같이 쓴다
export const ACCOUNT_STATUSES = ['active', 'pending', 'inactive'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

// 계정 관리 화면의 탭. 로그인 내역·최종 접속내역·접근 기록은 관리자 메뉴에 있다
export const ACCOUNT_TABS = ['list', 'changes'] as const
export type AccountTab = (typeof ACCOUNT_TABS)[number]

/** 계정 발급 › 소속 연맹 선택지의 '새 연맹 추가'. 고르면 연맹명을 받아 연맹과 계정을 같이 만든다 */
export const NEW_AFFILIATE = '__new'
