import { AUDIT_ACTIONS, type AuditAction } from '@/lib/audit'
import { parseLogPeriod } from '@/lib/server/audit/params'
import { AUDIT_PAGE_SIZE, listPartnerHistory } from '@/lib/server/audit/service'
import { requireMenu } from '@/lib/server/auth/session'
import { listAffiliateOptions, listPartners } from '@/lib/server/partners/service'
import { SUPPORTED_CURRENCIES } from '@/lib/money'
import { PartnerHistoryView } from './partner-history-view'
import { PartnersView } from './partners-view'

// 업체 관리의 작업 이력 탭. 지금은 로그를 관리자 메뉴(크로스허브)에서만 보게 꺼 둔다 (10/15). 다시 열 때 true로
const PARTNER_HISTORY_TAB = false

type Params = { id?: string; tab?: string; from?: string; to?: string; partner?: string; action?: string; page?: string }

// 업체 관리. 탭: 업체 목록 / 작업 이력. 크로스허브는 전체 업체, 연맹은 대행 업체만 (메뉴권한표)
// 업체 계정은 탭 없이 "내 업체 정보"만 본다 (PartnersView)
export default async function PartnersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireMenu('partners')
  const sp = await searchParams
  const tab = PARTNER_HISTORY_TAB && sp.tab === 'history' && user.role !== 'partner' ? 'history' : 'list'
  const [partners, affiliates] = await Promise.all([
    listPartners(user),
    user.role === 'crosshub' ? listAffiliateOptions() : Promise.resolve([]),
  ])
  const currencies = user.role === 'crosshub' ? [...SUPPORTED_CURRENCIES] : []

  let body: React.ReactNode = null
  if (tab === 'history') {
    const filter = {
      ...parseLogPeriod(sp),
      keyword: '',
      partnerId: user.managedPartners.some((p) => p.id === sp.partner) ? sp.partner! : null,
      action: AUDIT_ACTIONS.includes(sp.action as AuditAction) ? (sp.action as AuditAction) : null,
    }
    const { total, rows } = await listPartnerHistory(user, filter)
    body = <PartnerHistoryView rows={rows} total={total} filter={filter} pageSize={AUDIT_PAGE_SIZE} partners={user.managedPartners} />
  }

  return (
    <PartnersView partners={partners} affiliates={affiliates} currencies={currencies} initialPartnerId={sp.id ?? null} tab={tab} showHistoryTab={PARTNER_HISTORY_TAB}>
      {body}
    </PartnersView>
  )
}
