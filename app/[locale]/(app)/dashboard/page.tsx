import { getLocale, getTranslations } from 'next-intl/server'
import { canCreateProduct } from '@/lib/permissions'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { listNeedsAttentionBookings, localizeBookingRows } from '@/lib/server/bookings/service'
import { listPendingInquiries } from '@/lib/server/inquiries/service'
import { listPgSettings } from '@/lib/server/payments/service'
import { listPendingChangeRequests } from '@/lib/server/products/change-requests'
import { listReviewProducts } from '@/lib/server/products/service'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { listPendingSettlements } from '@/lib/server/settlements/service'
import { jstToday } from '@/lib/settlements'
import { DashboardView } from './dashboard-view'

// 역할별로 보여줄 데이터가 다르다 — 업체·연맹은 지금 처리할 일(견적·환불·문의) + 다음 지급 안내,
// 크로스허브는 전체 업체를 아우르는 승인·점검(상품 현황) 중심. 범위는 visiblePartnerIds로 거른다.
export default async function DashboardPage() {
  const user = await requireMenu('dashboard')
  const t = await getTranslations('role')
  const scope = visiblePartnerIds(user)
  const isCrosshub = user.role === 'crosshub'

  const empty = { rows: [], total: 0 }
  const [bookings, inquiries, settlements, reviewProducts, changeRequests, pgSettings] = await Promise.all([
    isCrosshub ? Promise.resolve({ ...empty, refundRows: [], refundTotal: 0 }) : listNeedsAttentionBookings(user, 5),
    isCrosshub ? Promise.resolve(empty) : listPendingInquiries(user, 5),
    listPendingSettlements(user),
    isCrosshub ? listReviewProducts(scope, 5) : Promise.resolve(empty),
    isCrosshub ? listPendingChangeRequests(user, 5) : Promise.resolve(empty),
    listPgSettings(),
  ])

  // 상품명은 보는 사람 언어로 (AI 번역이면 표시)
  const locale = await getLocale()
  const trName = await productNameLocalizer([...reviewProducts.rows.map((p) => p.id), ...changeRequests.rows.map((r) => r.productId)], locale)
  const reviewRows = reviewProducts.rows.map((p) => {
    const n = trName(p.id, p.name)
    return { ...p, name: n.name, nameAi: n.ai }
  })
  const changeRequestRows = changeRequests.rows.map((r) => {
    const n = trName(r.productId, r.productName)
    return { ...r, productName: n.name, productNameAi: n.ai }
  })
  const [bookingRows, refundRows] = await Promise.all([localizeBookingRows(bookings.rows, locale), localizeBookingRows(bookings.refundRows, locale)])

  // 업체·연맹용 다음 지급 안내: 지난달 송금대기 정산을 통화별로 합쳐서, 이번 달 지급일(통화별 설정)과 같이 보여준다
  const thisMonth = jstToday().slice(0, 7)
  const payDayByCurrency = new Map(pgSettings.map((s) => [s.currency, s.payDay]))
  const netByCurrency = new Map<string, number>()
  for (const s of settlements) netByCurrency.set(s.currency, (netByCurrency.get(s.currency) ?? 0) + s.net)
  const payDateFor = (currency: string) => `${thisMonth}-${String(payDayByCurrency.get(currency) ?? 15).padStart(2, '0')}`
  const payouts = [...netByCurrency].map(([currency, net]) => ({ currency, net, payDate: payDateFor(currency) }))
  // 크로스허브용: 업체별 지급할 정산 (지급 처리는 크로스허브 일)
  const payoutRows = settlements.map((s) => ({ ...s, payDate: payDateFor(s.currency) }))

  return (
    <DashboardView
      roleName={user.orgName ?? t(user.role)}
      canCreate={canCreateProduct(user.role)}
      isCrosshub={isCrosshub}
      bookings={bookingRows}
      bookingsTotal={bookings.total}
      refundRows={refundRows}
      refundTotal={bookings.refundTotal}
      inquiries={inquiries.rows}
      inquiriesTotal={inquiries.total}
      payouts={payouts}
      showPartnerColumn={user.managedPartners.length > 1}
      reviewProducts={reviewRows}
      reviewTotal={reviewProducts.total}
      changeRequests={changeRequestRows}
      changeRequestTotal={changeRequests.total}
      payoutRows={payoutRows}
    />
  )
}
