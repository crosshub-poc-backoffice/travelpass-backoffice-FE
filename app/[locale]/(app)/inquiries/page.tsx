import { getLocale } from 'next-intl/server'
import { parsePage } from '@/lib/pagination'
import { isInquiryStatus, listInquiries } from '@/lib/server/inquiries/service'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { listProductOptions } from '@/lib/server/products/service'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { InquiriesView } from './inquiries-view'

type SearchParams = { id?: string; page?: string; keyword?: string; status?: string; partnerId?: string; productId?: string }

// partnerId/productId는 로그인 범위 안에서 한 번 더 좁히는 화면 전용 필터 — 상단 업체 전환(세션)은 안 건드린다 (예약 화면과 같은 방식)
export default async function InquiriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireMenu('inquiries')
  const { id, page, keyword, status, partnerId, productId } = await searchParams
  const pageNumber = parsePage(page)
  const scope = visiblePartnerIds(user)
  const scopedPartnerId = partnerId && scope.includes(partnerId) ? partnerId : undefined

  const [{ rows: sourceRows, total }, sourceProducts] = await Promise.all([
    listInquiries(user, {
      page: pageNumber,
      keyword,
      status: isInquiryStatus(status) ? status : undefined,
      partnerId: scopedPartnerId,
      productId,
    }),
    listProductOptions(scopedPartnerId ? [scopedPartnerId] : scope),
  ])

  // 상품명은 보는 사람 언어로 (AI 번역이면 표시)
  const trName = await productNameLocalizer([...sourceRows.map((r) => r.productId), ...sourceProducts.map((p) => p.id)], await getLocale())
  const rows = sourceRows.map((r) => {
    const n = trName(r.productId, r.productName)
    return { ...r, productName: n.name, productNameAi: n.ai }
  })
  const products = sourceProducts.map((p) => ({ ...p, name: trName(p.id, p.name).name }))

  return (
    <InquiriesView
      inquiries={rows}
      initialSelectedId={id ?? null}
      total={total}
      page={pageNumber}
      keyword={keyword ?? ''}
      status={isInquiryStatus(status) ? status : 'all'}
      partners={user.managedPartners}
      partnerId={scopedPartnerId ?? 'all'}
      products={products}
      productId={productId ?? 'all'}
    />
  )
}
