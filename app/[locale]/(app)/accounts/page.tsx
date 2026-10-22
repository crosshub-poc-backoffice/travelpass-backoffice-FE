import { ACCOUNT_STATUSES, ACCOUNT_TABS, type AccountStatus, type AccountTab } from '@/lib/accounts'
import { AUDIT_ACTIONS, type AuditAction } from '@/lib/audit'
import { ROLES, type Role } from '@/lib/permissions'
import { ACCOUNT_PAGE_SIZE, listAccountOrgs, listAccounts } from '@/lib/server/accounts/service'
import { parseLogPeriod, parsePage } from '@/lib/server/audit/params'
import { AUDIT_PAGE_SIZE, listAccountChanges } from '@/lib/server/audit/service'
import { requireMenu } from '@/lib/server/auth/session'
import { AccountChangesView } from './account-changes-view'
import { AccountsView } from './accounts-view'

type Params = {
  tab?: string
  role?: string
  org?: string
  status?: string
  from?: string
  to?: string
  action?: string
  q?: string
  page?: string
}

// 계정 관리. 크로스허브만 (메뉴권한표). 탭: 계정 조회 / 변동 이력
// 로그인 내역·최종 접속내역·접근 기록은 관리자 메뉴에 있다
// 검색 조건은 주소(?tab=&...)에 담는다 — 새로고침·뒤로가기해도 그대로 남는다
export default async function AccountsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireMenu('accounts')
  const sp = await searchParams
  const tab: AccountTab = ACCOUNT_TABS.includes(sp.tab as AccountTab) ? (sp.tab as AccountTab) : 'list'
  const keyword = (sp.q ?? '').trim().slice(0, 50)

  const accountFilter = {
    role: ROLES.includes(sp.role as Role) ? (sp.role as Role) : null,
    orgId: sp.org || null,
    status: ACCOUNT_STATUSES.includes(sp.status as AccountStatus) ? (sp.status as AccountStatus) : null,
    keyword,
    page: parsePage(sp.page),
  }
  const [{ total, rows }, orgs] = await Promise.all([
    tab === 'list' ? listAccounts(accountFilter) : Promise.resolve({ total: 0, rows: [] }),
    listAccountOrgs(),
  ])

  let body: React.ReactNode = null
  if (tab === 'changes') {
    // 변동 이력: 계정 발급·비밀번호 초기화/변경·활성/비활성
    const filter = {
      ...parseLogPeriod(sp),
      keyword,
      action: AUDIT_ACTIONS.includes(sp.action as AuditAction) ? (sp.action as AuditAction) : null,
    }
    const logs = await listAccountChanges(filter)
    body = <AccountChangesView rows={logs.rows} total={logs.total} filter={filter} pageSize={AUDIT_PAGE_SIZE} />
  }

  return (
    <AccountsView
      accounts={rows}
      total={total}
      filter={accountFilter}
      pageSize={ACCOUNT_PAGE_SIZE}
      affiliates={orgs.affiliates}
      partners={orgs.partners}
      tab={tab}
    >
      {body}
    </AccountsView>
  )
}
