import { getLocale } from 'next-intl/server'
import { canApproveChangeRequest, canCreateProduct, canEdit } from '@/lib/permissions'
import { parsePage } from '@/lib/pagination'
import { PRODUCT_STATUSES, type ProductStatus } from '@/lib/products/types'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { latestChangeRequestsByProduct } from '@/lib/server/products/change-requests'
import { listProducts } from '@/lib/server/products/service'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { ProductsView } from './products-view'

type SearchParams = { id?: string; page?: string; keyword?: string; status?: string; partnerId?: string }

function isProductStatus(value: string | undefined): value is ProductStatus {
  return !!value && (PRODUCT_STATUSES as readonly string[]).includes(value)
}

// 상품 목록. 로그인 계정이 다룰 수 있는 업체(업체 전환으로 고른 업체가 있으면 그 업체)의 상품만
// partnerId는 그 안에서 한 번 더 좁히는 화면 전용 필터 (업체 계정은 어차피 업체가 하나라 드롭다운이 안 보인다)
// ?id=<productId>로 들어오면 그 상품 행으로 스크롤+강조 (알림 벨 클릭 시 딥링크용)
export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireMenu('products')
  const { id, page, keyword, status, partnerId } = await searchParams
  const pageNumber = parsePage(page)
  const scope = visiblePartnerIds(user)
  const scopedPartnerIds = partnerId && scope.includes(partnerId) ? [partnerId] : scope
  // status=changeRequest는 상품 상태가 아니라 "대기중인 변경요청이 있는 상품" 칩
  const { rows: sourceRows, total, pendingChangeCount } = await listProducts(scopedPartnerIds, {
    page: pageNumber,
    keyword,
    status: isProductStatus(status) ? status : undefined,
    pendingChange: status === 'changeRequest',
  })
  // 상품명은 보는 사람 언어로 (AI 번역이면 표시). 검색은 원문·번역 둘 다
  const trName = await productNameLocalizer(sourceRows.map((r) => r.id), await getLocale())
  const rows = sourceRows.map((r) => {
    const n = trName(r.id, r.name)
    return { ...r, name: n.name, nameAi: n.ai }
  })
  const changeRequests = await latestChangeRequestsByProduct(rows.map((r) => r.id))

  return (
    <ProductsView
      rows={rows}
      total={total}
      page={pageNumber}
      keyword={keyword ?? ''}
      status={isProductStatus(status) || status === 'changeRequest' ? status : 'all'}
      pendingChangeCount={pendingChangeCount}
      canCreate={canCreateProduct(user.role)}
      canEdit={canEdit(user.role, 'products')}
      canApprove={user.role === 'crosshub'}
      canApproveChangeRequest={canApproveChangeRequest(user.role)}
      changeRequests={changeRequests}
      initialHighlightId={id ?? null}
      partners={user.managedPartners}
      partnerId={scopedPartnerIds === scope ? 'all' : partnerId!}
    />
  )
}
