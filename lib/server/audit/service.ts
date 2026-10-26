import 'server-only'
import { backend, qs } from '@/lib/api/backend'
import type { AccessKind, AuditAction, AuditCategory, AuditDetail, LoginAction, LoginResult, LoginSearchField } from '@/lib/audit'
import type { Role } from '@/lib/permissions'
import type { SessionUser } from '@/lib/server/auth/session'

// 관리자 메뉴 조회(작업 이력·로그인 내역·접근 기록·계정 변동·업체 작업 이력). 조회·범위 판단은 전부 BE(/api/v1/activity/*)가 한다.
// 범위: 작업 이력·업체 이력은 크로스허브 전체 · 연맹 대행 업체 / 로그인·접근·계정 변동은 크로스허브만. 쓰기도 BE (각 쓰기 API 안에서).

export const AUDIT_PAGE_SIZE = 20

type Page<T> = { rows: T[]; total: number }

export type AuditFilter = {
  from: string // YYYY-MM-DD (일본 시간)
  to: string
  partnerId: string | null
  category: AuditCategory | null
  page: number
}

type BeAuditRow = {
  id: string
  action: string
  targetId: string | null
  targetName: string | null
  detail: AuditDetail | null
  createdAt: string
  partnerName: string | null
  userName: string
  userLoginId: string
  userRole: Role
  userOrgName: string | null
}

export async function listAuditLogs(_user: SessionUser, filter: AuditFilter) {
  const res = await backend.get<Page<BeAuditRow>>(
    `/api/v1/activity/audit${qs({ from: filter.from, to: filter.to, partnerId: filter.partnerId, category: filter.category, page: filter.page })}`,
  )
  return {
    total: res.total,
    rows: res.rows.map((r) => ({
      ...r,
      action: r.action as AuditAction,
      /** targetName이 보는 사람 언어의 AI 번역이면 true (상품 대상만, 페이지에서 채운다) */
      targetNameAi: false,
    })),
  }
}

export type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>['rows'][number]

// ── 로그인 내역 · 접근 기록 (크로스허브만 본다) ──

export type LogFilter = { from: string; to: string; keyword: string; page: number }

export type LoginLogFilter = LogFilter & {
  action: LoginAction | null
  result: LoginResult | null
  field: LoginSearchField
  exact: boolean // 일치: 체크하면 검색어와 똑같은 것만, 아니면 포함하는 것
}

export type LoginLogRow = {
  id: string
  loginId: string
  userName: string | null
  event: 'login' | 'logout' | 'failed'
  failReason: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export async function listLoginLogs(filter: LoginLogFilter): Promise<Page<LoginLogRow>> {
  return backend.get<Page<LoginLogRow>>(
    `/api/v1/activity/logins${qs({
      from: filter.from,
      to: filter.to,
      action: filter.action,
      result: filter.result,
      field: filter.field,
      exact: filter.exact ? 'true' : undefined,
      keyword: filter.keyword || undefined,
      page: filter.page,
    })}`,
  )
}

export type AccessLogRow = {
  id: string
  menu: string
  kind: AccessKind
  path: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
  userName: string
  userLoginId: string
}

export async function listAccessLogs(filter: LogFilter & { menu: string | null; kind: AccessKind | null }): Promise<Page<AccessLogRow>> {
  return backend.get<Page<AccessLogRow>>(
    `/api/v1/activity/access${qs({ from: filter.from, to: filter.to, menu: filter.menu, kind: filter.kind, keyword: filter.keyword || undefined, page: filter.page })}`,
  )
}

// ── 계정 변동 이력 (계정 관리 탭). 대상 계정 기준으로 발급·비밀번호·활성 상태 변동을 보여준다 ──

export type AccountChangeRow = {
  id: string
  action: AuditAction
  targetLoginId: string | null
  targetName: string | null
  actorName: string
  actorLoginId: string
  bySelf: boolean
  createdAt: string
}

export async function listAccountChanges(filter: LogFilter & { action: AuditAction | null }): Promise<Page<AccountChangeRow>> {
  return backend.get<Page<AccountChangeRow>>(
    `/api/v1/activity/account-changes${qs({ from: filter.from, to: filter.to, action: filter.action, keyword: filter.keyword || undefined, page: filter.page })}`,
  )
}

// ── 업체 작업 이력 (업체 관리 탭). 등록·수수료율 변경·활성/비활성. 크로스허브 전체 · 연맹 대행 업체 ──

export type PartnerHistoryRow = {
  id: string
  action: AuditAction
  /** 업체명이 바뀌었으면 지금 이름, 없으면 기록 당시 이름 */
  partnerName: string
  detail: AuditDetail | null
  actorName: string
  actorLoginId: string
  createdAt: string
}

export async function listPartnerHistory(
  _user: SessionUser,
  filter: LogFilter & { partnerId: string | null; action: AuditAction | null },
): Promise<Page<PartnerHistoryRow>> {
  return backend.get<Page<PartnerHistoryRow>>(
    `/api/v1/activity/partner-history${qs({ from: filter.from, to: filter.to, partnerId: filter.partnerId, action: filter.action, page: filter.page })}`,
  )
}
