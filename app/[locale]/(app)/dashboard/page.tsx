import { getLocale, getTranslations } from 'next-intl/server'
import { canCreateProduct } from '@/lib/permissions'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { listPendingInquiries } from '@/lib/server/inquiries/service'
import { listPendingChangeRequests } from '@/lib/server/products/change-requests'
import { listReviewProducts } from '@/lib/server/products/service'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { DashboardView } from './dashboard-view'

// 역할별로 보여줄 데이터가 다르다 — 업체·연맹은 지금 답할 문의,
// 크로스허브는 전체 업체를 아우르는 승인·점검(상품 현황) 중심. 범위는 visiblePartnerIds로 거른다.
export default async function DashboardPage() {
  const user = await requireMenu('dashboard')
  const t = await getTranslations('role')
  const scope = visiblePartnerIds(user)
  const isCrosshub = user.role === 'crosshub'

  const empty = { rows: [], total: 0 }
  const [inquiries, reviewProducts, changeRequests] = await Promise.all([
    isCrosshub ? Promise.resolve(empty) : listPendingInquiries(user, 5),
    isCrosshub ? listReviewProducts(scope, 5) : Promise.resolve(empty),
    isCrosshub ? listPendingChangeRequests(user, 5) : Promise.resolve(empty),
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

  return (
    <DashboardView
      roleName={user.orgName ?? t(user.role)}
      canCreate={canCreateProduct(user.role)}
      isCrosshub={isCrosshub}
      inquiries={inquiries.rows}
      inquiriesTotal={inquiries.total}
      showPartnerColumn={user.managedPartners.length > 1}
      reviewProducts={reviewRows}
      reviewTotal={reviewProducts.total}
      changeRequests={changeRequestRows}
      changeRequestTotal={changeRequests.total}
    />
  )
}
