import { getLocale } from 'next-intl/server'
import { countryName } from '@/lib/country'
import { parsePage } from '@/lib/pagination'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { isBookingStatus, listBookings, localizeBookingRows } from '@/lib/server/bookings/service'
import { listProductOptions } from '@/lib/server/products/service'
import { productNameLocalizer } from '@/lib/server/products/translations'
import { BookingsView } from './bookings-view'

type SearchParams = { id?: string; page?: string; keyword?: string; status?: string; partnerId?: string; productId?: string }

// 예약 목록. 로그인 계정이 다룰 수 있는 업체(업체 전환으로 고른 업체가 있으면 그 업체)의 예약만.
// partnerId/productId는 그 안에서 한 번 더 좁히는 화면 전용 필터 — 상단 업체 전환(세션)은 안 건드린다.
// ?id=<bookingId>로 들어오면 그 예약 상세를 바로 연다 (대시보드 딥링크용)
export default async function BookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireMenu('bookings')
  const { id, page, keyword, status, partnerId, productId } = await searchParams
  const pageNumber = parsePage(page)
  const scope = visiblePartnerIds(user)
  const scopedPartnerIds = partnerId && scope.includes(partnerId) ? [partnerId] : scope

  const [{ rows: sourceRows, total, statusCounts }, sourceProducts] = await Promise.all([
    listBookings(scopedPartnerIds, {
      page: pageNumber,
      keyword,
      // 상태를 안 고르면 진행 중(업체확인중·고객확인중·확정)이 기본
      status: isBookingStatus(status) ? status : 'active',
      productId,
    }),
    listProductOptions(scopedPartnerIds),
  ])

  // 국가명은 서버에서 한 번만 만든다. 서버(Node)와 브라우저의 Intl 국가명이 달라서(홍콩 등) 화면에서 만들면 하이드레이션이 어긋난다
  const locale = await getLocale()
  // 상품명·플랜·옵션명은 보는 사람 언어로 (상품 번역). 검색은 원문·번역 둘 다
  const rows = await localizeBookingRows(sourceRows, locale)
  const trName = await productNameLocalizer(sourceProducts.map((p) => p.id), locale)
  const products = sourceProducts.map((p) => ({ ...p, name: trName(p.id, p.name).name }))
  const nationalityNames = Object.fromEntries([...new Set(rows.map((r) => r.nationality))].map((code) => [code, countryName(code, locale)]))

  return (
    <BookingsView
      initialBookings={rows}
      nationalityNames={nationalityNames}
      statusCounts={statusCounts}
      initialSelectedId={id ?? null}
      total={total}
      page={pageNumber}
      keyword={keyword ?? ''}
      status={isBookingStatus(status) ? status : 'active'}
      partners={user.managedPartners}
      partnerId={scopedPartnerIds === scope ? 'all' : partnerId!}
      products={products}
      productId={productId ?? 'all'}
    />
  )
}
