import { notFound } from 'next/navigation'
import { canEdit } from '@/lib/permissions'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { latestChangeRequestFor } from '@/lib/server/products/change-requests'
import { getProduct } from '@/lib/server/products/service'
import { ProductForm } from '../_form/product-form'

// 상품 수정. 업체 범위 밖이거나 없는 상품이면 404
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireMenu('products', 'read', 'view')
  const product = await getProduct(id, visiblePartnerIds(user))
  if (!product) notFound()

  // 임시저장·심사중은 변경요청 구조를 안 거치므로 조회할 필요 없음
  const changeRequest = product.status === 'review' || product.status === 'draft' ? null : await latestChangeRequestFor(id)
  const partners = user.managedPartners.filter((p) => p.id === product.partnerId)
  // 대기중인 요청이 있어도 크로스허브는 직접 수정 가능 (대신 그 요청은 자동 반려됨) — 요청을 보낸
  // 연맹·업체 쪽에서만 중복 제출을 막기 위해 잠근다
  const locked = changeRequest?.status === 'pending' && user.role !== 'crosshub'
  return (
    <ProductForm
      initial={product}
      partners={partners}
      readOnly={!canEdit(user.role, 'products') || locked}
      changeRequest={changeRequest}
    />
  )
}
