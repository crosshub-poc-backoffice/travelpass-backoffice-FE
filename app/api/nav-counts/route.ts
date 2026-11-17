import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import { canAccess } from '@/lib/permissions'
import { visiblePartnerIds } from '@/lib/server/auth/session'
import { listPendingInquiries } from '@/lib/server/inquiries/service'
import { listPendingChangeRequests } from '@/lib/server/products/change-requests'
import { listReviewProducts } from '@/lib/server/products/service'

// 왼쪽 메뉴 옆 숫자 (VELTRA 마이페이지 메뉴처럼 할 일이 바로 보이게).
//  고객 문의: 답하지 않은 문의 수 / 상품 관리: 심사중 상품 수 (+ 크로스허브는 대기중 변경요청 수)
// 숫자를 못 구하면 0 — 메뉴 숫자 때문에 화면이 깨지지 않게 한다
export async function GET() {
  const auth = await requireApiSession()
  if ('response' in auth) return auth.response
  const user = auth.session.user
  const safe = async (f: () => Promise<number>) => {
    try {
      return await f()
    } catch {
      return 0
    }
  }
  const [inquiries, review, changes] = await Promise.all([
    canAccess(user.role, 'inquiries') ? safe(async () => (await listPendingInquiries(user, 1)).total) : 0,
    canAccess(user.role, 'products') ? safe(async () => (await listReviewProducts(visiblePartnerIds(user), 0)).total) : 0,
    user.role === 'crosshub' ? safe(async () => (await listPendingChangeRequests(user, 1)).total) : 0,
  ])
  return NextResponse.json({ inquiries, products: review + changes })
}
