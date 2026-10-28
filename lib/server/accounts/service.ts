import { deleteSessionsByUser } from '@/lib/server/auth/session-store'
import 'server-only'
import { backend, BackendError, qs, type PageResponse, seg } from '@/lib/api/backend'
import type { AccountStatus } from '@/lib/accounts'
import type { Role } from '@/lib/permissions'

export const ACCOUNT_PAGE_SIZE = 20

export type AccountFilter = {
  role: Role | null
  orgId: string | null // 연맹 또는 업체 id
  status: AccountStatus | null
  keyword: string
  page: number
  /** 최종 접속내역 탭은 마지막 로그인 순, 계정 조회 탭은 발급일 순 */
  sort?: 'created' | 'lastLogin'
}

type BeAccount = {
  id: string
  loginId: string
  name: string
  role: Role
  orgName: string | null
  /** 발급 후 아직 로그인 안 함 (BE가 lastLoginAt으로 계산) */
  pending: boolean
  active: boolean
  lastLoginAt: string | null
  lastLoginIp: string | null
  lastLoginUserAgent: string | null
  createdAt: string
}

export async function listAccounts(filter: AccountFilter) {
  // 계정 목록을 BE에서 가져온다. 필터·정렬·페이징은 쿼리스트링으로 전달.
  const res = await backend.get<PageResponse<BeAccount>>(
    `/api/v1/accounts${qs({
      role: filter.role ?? undefined,
      orgId: filter.orgId ?? undefined,
      status: filter.status ?? undefined,
      keyword: filter.keyword || undefined,
      sort: filter.sort,
      page: filter.page,
    })}`,
  )
  return { total: res.total, rows: res.rows }
}

export type AccountRow = Awaited<ReturnType<typeof listAccounts>>['rows'][number]

/** 소속 선택지(연맹·직접 운영 업체). 업체 계정은 직접 운영 업체에만 준다 (대행 업체는 연맹이 처리).
 *  hasAccount: 이미 계정이 있는 소속 — 소속당 계정은 1개라 발급 화면에서 뺀다 */
export async function listAccountOrgs() {
  return backend.get<{ affiliates: { id: string; name: string; hasAccount: boolean }[]; partners: { id: string; name: string; hasAccount: boolean }[] }>(
    '/api/v1/accounts/orgs',
  )
}

export type AccountOrg = Awaited<ReturnType<typeof listAccountOrgs>>['partners'][number]

// 계정 발급·비밀번호 초기화·활성 토글은 BE(POST /api/v1/accounts...)가 Keycloak Admin API와 DB를 같이 처리한다.
// FE는 BE를 호출하고, 자기 소유인 로그인 세션(Session)만 정리한다.

export type AccountWriteError =
  | 'required' | 'nameLength' | 'loginIdFormat' | 'invalidOrg' | 'affiliateNameTaken' | 'orgHasAccount'
  | 'loginIdTaken' | 'keycloakSyncFailed' | 'resetSelf' | 'toggleSelf' | 'notFound'

/** BE 에러 응답 {code} → FE 에러 키 */
function writeError(e: unknown): AccountWriteError {
  if (e instanceof BackendError) {
    const m = e.message.match(/"code"\s*:\s*"([A-Za-z]+)"/)
    if (m) return m[1] as AccountWriteError
  }
  throw e
}

type IssueInput = { role: Role; name: string; loginId: string; affiliateId: string | null; partnerId: string | null; newAffiliateName?: string | null }

export async function createAccount(input: IssueInput) {
  try {
    const r = await backend.post<{ id: string; loginId: string; partnerId: string | null; tempPassword: string }>('/api/v1/accounts', input)
    return { ok: true as const, user: { id: r.id, loginId: r.loginId, partnerId: r.partnerId }, tempPassword: r.tempPassword }
  } catch (e) {
    return { ok: false as const, error: writeError(e) }
  }
}

/** 임시 비밀번호로 초기화 → 그 계정의 FE 로그인 세션도 모두 끊는다 */
export async function resetAccountPassword(userId: string) {
  try {
    const r = await backend.post<{ loginId: string; tempPassword: string }>(`/api/v1/accounts/${seg(userId)}/reset-password`)
    await deleteSessionsByUser(userId)
    return { ok: true as const, loginId: r.loginId, tempPassword: r.tempPassword }
  } catch (e) {
    return { ok: false as const, error: writeError(e) }
  }
}

/** 활성/비활성 뒤집기 → 그 계정의 FE 로그인 세션도 모두 끊는다 */
export async function toggleAccountActive(userId: string) {
  try {
    const r = await backend.post<{ active: boolean }>(`/api/v1/accounts/${seg(userId)}/toggle-active`)
    await deleteSessionsByUser(userId)
    return { ok: true as const, active: r.active }
  } catch (e) {
    return { ok: false as const, error: writeError(e) }
  }
}
