import { notFound } from 'next/navigation'
import { canEdit } from '@/lib/permissions'
import { requireMenu, visiblePartnerIds } from '@/lib/server/auth/session'
import { getProductTranslations } from '@/lib/server/products/translations'
import { TranslationsView } from './translations-view'

// 상품 정보 번역 확인·수정. 업체 범위 밖이거나 없는 상품이면 404
export default async function ProductTranslationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireMenu('products', 'read', 'view')
  const data = await getProductTranslations(id, visiblePartnerIds(user))
  if (!data) notFound()
  return <TranslationsView data={data} readOnly={!canEdit(user.role, 'products')} />
}
