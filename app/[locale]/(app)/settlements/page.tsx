import { parseLogPeriod } from '@/lib/server/audit/params'
import { getLocale } from 'next-intl/server'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { listAffiliateShares, listPayments, listPgSettings } from '@/lib/server/payments/service'
import { listAffiliateSettlements, listMonthlySettlements, type AffiliateSettlementRow, type SettlementRow } from '@/lib/server/settlements/service'
import { MONTH_PATTERN, PAYMENT_TYPES, SETTLEMENT_TABS, jstToday, type PaymentTypeKey, type SettlementTab } from '@/lib/settlements'
import { PaymentSettingsView } from './payment-settings-view'
import { PaymentsView } from './payments-view'
import { SettlementsView } from './settlements-view'

type Params = { tab?: string; month?: string; from?: string; to?: string; type?: string; page?: string }

// 정산 관리. 탭: 정산(월별·업체별) / 결제내역(건별) / 결제 설정(크로스허브만: 통화별 PG·연맹 몫)
// 범위는 로그인 계정이 다룰 수 있는 업체(업체 전환으로 고른 업체가 있으면 그 업체). 지급완료 처리는 크로스허브만 (메뉴권한표)
export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireMenu('settlements')
  const sp = await searchParams
  const canManage = user.role === 'crosshub'
  let tab: SettlementTab = SETTLEMENT_TABS.includes(sp.tab as SettlementTab) ? (sp.tab as SettlementTab) : 'monthly'
  if (tab === 'settings' && !canManage) tab = 'monthly'
  const month = sp.month && MONTH_PATTERN.test(sp.month) ? sp.month : jstToday().slice(0, 7)

  let rows: SettlementRow[] = []
  let affiliateRows: AffiliateSettlementRow[] = []
  let schedules: { currency: string; payDay: number }[] = []
  let body: React.ReactNode = null
  if (tab === 'monthly') {
    // 연맹 몫: 크로스허브는 연맹 전체(지급 목록), 연맹은 자기 몫, 업체는 없음. 지급 일정은 월 선택기 옆 꼬리표용
    let settings: Awaited<ReturnType<typeof listPgSettings>>
    ;[rows, affiliateRows, settings] = await Promise.all([listMonthlySettlements(user, month), listAffiliateSettlements(user, month), listPgSettings()])
    schedules = settings.map((s) => ({ currency: s.currency, payDay: s.payDay }))
    // 상품명은 보는 사람 언어로 (AI 번역이면 표시)
    const trName = await productNameLocalizer(rows.flatMap((r) => r.lines.map((l) => l.productId)), await getLocale())
    rows = rows.map((r) => ({
      ...r,
      lines: r.lines.map((l) => {
        const n = trName(l.productId, l.productName)
        return { ...l, productName: n.name, productNameAi: n.ai }
      }),
    }))
  } else if (tab === 'payments') {
    const filter = { ...parseLogPeriod(sp), type: PAYMENT_TYPES.includes(sp.type as PaymentTypeKey) ? (sp.type as PaymentTypeKey) : null }
    const { rows: sourcePayments, total } = await listPayments(visiblePartnerIds(user), filter)
    const trName = await productNameLocalizer(sourcePayments.map((p) => p.productId), await getLocale())
    const payments = sourcePayments.map((p) => {
      const n = trName(p.productId, p.productName)
      return { ...p, productName: n.name, productNameAi: n.ai }
    })
    body = <PaymentsView rows={payments} total={total} filter={filter} />
  } else {
    const [settings, shares] = await Promise.all([listPgSettings(), listAffiliateShares()])
    body = <PaymentSettingsView settings={settings} shares={shares} />
  }

  return (
    <SettlementsView tab={tab} month={month} rows={rows} affiliateRows={affiliateRows} schedules={schedules} role={user.role}>
      {body}
    </SettlementsView>
  )
}
