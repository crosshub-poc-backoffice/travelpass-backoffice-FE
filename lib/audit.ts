// 작업 이력에 남기는 작업 종류. 앞부분(_ 앞)이 화면의 "작업 종류" 필터 묶음이다.
// 문구는 messages/<언어>.json의 audit.action.<작업>, audit.category.<묶음>

export const AUDIT_ACTIONS = [
  'account_issue',
  'account_password_reset',
  'account_password_change',
  'account_deactivate',
  'account_activate',
  'account_affiliate_create',
  'partner_create',
  'partner_info',
  'partner_deactivate',
  'partner_activate',
  'product_create',
  'product_update',
  'product_status',
  'product_delete',
  'product_translation',
  'inquiry_answer',
  'inquiry_translation',
  'scope_switch',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_CATEGORIES = ['product', 'inquiry', 'partner', 'account', 'scope'] as const

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

/** 바뀐 값. { 필드: [이전값, 새값] } */
export type AuditDetail = Record<string, [unknown, unknown]>


// 관리자 메뉴의 탭. 작업 이력은 크로스허브·연맹, 나머지는 크로스허브만 본다
export const AUDIT_TABS = ['actions', 'logins', 'lastAccess', 'access'] as const
export type AuditTab = (typeof AUDIT_TABS)[number]


// 로그인 내역은 저장값 하나(login·logout·failed)를 화면에서 액션·결과 두 칸으로 나눠 보여준다.
// 로그인 실패 = 액션 "로그인" + 결과 "실패"
export const LOGIN_ACTIONS = ['login', 'logout'] as const
export type LoginAction = (typeof LOGIN_ACTIONS)[number]
export const LOGIN_RESULTS = ['success', 'failed'] as const
export type LoginResult = (typeof LOGIN_RESULTS)[number]
// 검색 대상
export const LOGIN_SEARCH_FIELDS = ['loginId', 'name', 'ip'] as const
export type LoginSearchField = (typeof LOGIN_SEARCH_FIELDS)[number]

// 접근 기록의 행위. list = 목록 화면, view = 상세 화면, create·update·delete = 저장·삭제 버튼
export const ACCESS_KINDS = ['list', 'view', 'create', 'update', 'delete'] as const
export type AccessKind = (typeof ACCESS_KINDS)[number]
