import { redirect } from 'next/navigation'
import { canCreateProduct } from '@/lib/permissions'
import { localePath, requireMenu } from '@/lib/server/auth/session'
import { ProductForm } from '../_form/product-form'

// 새 상품 등록. 업체 계정은 자기 업체로, 연맹은 다룰 수 있는 업체 중에서 고른다 (업체 전환으로 고른 업체가 있으면 그 업체만).
// 크로스허브는 상품을 새로 등록하지 않는다 — 등록된 상품의 수정·삭제·승인만 한다
export default async function NewProductPage() {
  const user = await requireMenu('products', 'edit', 'view')
  if (!canCreateProduct(user.role)) redirect(await localePath('/products'))
  const partners = user.activePartnerId ? user.managedPartners.filter((p) => p.id === user.activePartnerId) : user.managedPartners

  return <ProductForm partners={partners} />
}
