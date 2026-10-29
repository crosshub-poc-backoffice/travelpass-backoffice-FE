import { getLocale, getTranslations } from 'next-intl/server'
import { PageTabs } from '@/components/page-tabs'
import { ACCOUNT_STATUSES, type AccountStatus } from '@/lib/accounts'
import {
  ACCESS_KINDS,
  AUDIT_CATEGORIES,
  AUDIT_TABS,
  LOGIN_ACTIONS,
  LOGIN_RESULTS,
  LOGIN_SEARCH_FIELDS,
  type AccessKind,
  type AuditCategory,
  type AuditTab,
  type LoginAction,
  type LoginResult,
  type LoginSearchField,
} from '@/lib/audit'
import { ROLES, canAccess, type Menu, type Role } from '@/lib/permissions'
import { ACCOUNT_PAGE_SIZE, listAccounts } from '@/lib/server/accounts/service'
import { parseLogPeriod, parsePage } from '@/lib/server/audit/params'
import { AUDIT_PAGE_SIZE, listAccessLogs, listAuditLogs, listLoginLogs } from '@/lib/server/audit/service'
import { requireMenu } from '@/lib/server/auth/session'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { AccessLogsView } from './access-logs-view'
import { AuditLogsView } from './audit-logs-view'
import { LastAccessView } from './last-access-view'
import { LoginLogsView } from './login-logs-view'

type Params = {
  tab?: string
  from?: string
  to?: string
  partner?: string
  category?: string
  role?: string
  status?: string
  action?: string
  result?: string
  field?: string
  exact?: string
  menu?: string
  kind?: string
  q?: string
  page?: string
}

// 접근 기록의 "메뉴" 필터 선택지 (lib/permissions.ts의 메뉴와 같은 이름)
const LOG_MENUS: Menu[] = [
  'dashboard',
  'products',
  'inquiries',
  'partners',
  'accounts',
  'activityLogs',
  'settings',
]

// 관리자 메뉴. 탭: 작업 이력(크로스허브·연맹) / 로그인 내역·최종 접속내역·접근 기록(크로스허브만).
// 연맹은 대행 업체에 남은 작업만 본다 (메뉴권한표). 기본 기간은 최근 30일
export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireMenu('activityLogs')
  const t = await getTranslations('audit')
  const sp = await searchParams
  // 로그인·접속 기록은 계정 관리 권한(크로스허브)이 있어야 본다
  const canSeeLogs = canAccess(user.role, 'accounts')
  const requested = AUDIT_TABS.includes(sp.tab as AuditTab) ? (sp.tab as AuditTab) : 'actions'
  const tab: AuditTab = canSeeLogs ? requested : 'actions'
  const keyword = (sp.q ?? '').trim().slice(0, 50)

  let body: React.ReactNode
  if (tab === 'logins') {
    const filter = {
      ...parseLogPeriod(sp),
      keyword,
      action: LOGIN_ACTIONS.includes(sp.action as LoginAction) ? (sp.action as LoginAction) : null,
      result: LOGIN_RESULTS.includes(sp.result as LoginResult) ? (sp.result as LoginResult) : null,
      field: LOGIN_SEARCH_FIELDS.includes(sp.field as LoginSearchField) ? (sp.field as LoginSearchField) : 'loginId',
      exact: sp.exact === '1',
    }
    const logs = await listLoginLogs(filter)
    body = <LoginLogsView rows={logs.rows} total={logs.total} filter={filter} pageSize={AUDIT_PAGE_SIZE} />
  } else if (tab === 'lastAccess') {
    const filter = {
      role: ROLES.includes(sp.role as Role) ? (sp.role as Role) : null,
      orgId: null,
      status: ACCOUNT_STATUSES.includes(sp.status as AccountStatus) ? (sp.status as AccountStatus) : null,
      keyword,
      page: parsePage(sp.page),
      sort: 'lastLogin' as const,
    }
    const { total, rows } = await listAccounts(filter)
    body = <LastAccessView accounts={rows} total={total} filter={filter} pageSize={ACCOUNT_PAGE_SIZE} />
  } else if (tab === 'access') {
    const filter = {
      ...parseLogPeriod(sp),
      keyword,
      menu: LOG_MENUS.includes(sp.menu as Menu) ? (sp.menu as Menu) : null,
      kind: ACCESS_KINDS.includes(sp.kind as AccessKind) ? (sp.kind as AccessKind) : null,
    }
    const logs = await listAccessLogs(filter)
    body = <AccessLogsView rows={logs.rows} total={logs.total} filter={filter} menus={LOG_MENUS} pageSize={AUDIT_PAGE_SIZE} />
  } else {
    const filter = {
      ...parseLogPeriod(sp),
      partnerId: user.managedPartners.some((p) => p.id === sp.partner) ? sp.partner! : null,
      category: AUDIT_CATEGORIES.includes(sp.category as AuditCategory) ? (sp.category as AuditCategory) : null,
    }
    const logs = await listAuditLogs(user, filter)
    // 상품 대상 기록의 상품명은 보는 사람 언어로 (AI 번역이면 ✨)
    const isProduct = (r: (typeof logs.rows)[number]) => r.action.startsWith('product_') && !!r.targetId && !!r.targetName
    const trName = await productNameLocalizer(logs.rows.filter(isProduct).map((r) => r.targetId!), await getLocale())
    const rows = logs.rows.map((r) => {
      if (!isProduct(r)) return r
      const n = trName(r.targetId!, r.targetName!)
      return { ...r, targetName: n.name, targetNameAi: n.ai }
    })
    body = <AuditLogsView rows={rows} total={logs.total} filter={filter} pageSize={AUDIT_PAGE_SIZE} partners={user.managedPartners} />
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">ADMIN</p>
          <h1>{t('title')}</h1>
        </div>
      </section>
      {canSeeLogs && (
        <PageTabs
          active={tab}
          tabs={AUDIT_TABS.map((key) => ({
            key,
            label: t(`tab.${key}`),
            href: key === 'actions' ? '/activity-logs' : { pathname: '/activity-logs', query: { tab: key } },
          }))}
        />
      )}
      {body}
    </>
  )
}
