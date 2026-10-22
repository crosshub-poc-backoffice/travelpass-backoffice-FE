import 'server-only'
import { getTranslations } from 'next-intl/server'
import { backend, devLoginHeader, qs } from '@/lib/api/backend'
import { prisma } from '@/lib/db'
import { eventLogHref, eventLogText, type NotificationPayload } from './payload'
import type { SessionUser } from '@/lib/server/auth/session'
import { visiblePartnerIds } from '@/lib/server/auth/session'

/**
 * live-state 3종(pendingBookings/pendingInquiries/reviewProducts)은 업체범위 스코프라
 * products/bookings/inquiries와 똑같이 BE에서 받아 FE가 partnerIds로 거른다 (BE 변경 불필요).
 * eventLog(저장형 Notification)는 사용자 단위라 BE CallerService의 dev 전용 X-Dev-Login-Id
 * 헤더로 "이 사용자로 로그인한 것처럼" 읽는다 — 쓰기(읽음처리·생성·dismiss)는 그대로 prisma.
 */
type BePendingBooking = { id: string; productName: string | null; partnerId: string; customerName: string; requestedAt: string }
type BePendingInquiry = { id: string; productName: string | null; partnerId: string | null; customerName: string; createdAt: string }
type BeReviewProduct = { id: string; name: string; partnerName: string | null; createdAt: string }
type BeNotification = { id: string; type: string; sourceId: string; payload: unknown; read: boolean; createdAt: string }

// BE는 bookings/inquiries를 고정 20개씩 페이지네이션해서 crosshub-전체 기준으로 끊는다 — partnerIds로
// 거르기 전에 전부 모아야 한다 (한 페이지만 보면 범위 밖 항목에 밀려 안에 있는 게 빠질 수 있다).
async function fetchAllPages<T>(path: string, params: Record<string, string | number | undefined>): Promise<T[]> {
  const first = await backend.get<{ rows: T[]; total: number; page: number; size: number }>(`${path}${qs({ ...params, page: 1 })}`)
  const rows = [...first.rows]
  const totalPages = first.size > 0 ? Math.ceil(first.total / first.size) : 1
  for (let page = 2; page <= totalPages; page++) {
    const next = await backend.get<{ rows: T[]; total: number; page: number; size: number }>(`${path}${qs({ ...params, page })}`)
    rows.push(...next.rows)
  }
  return rows
}

async function fetchPendingBookings(partnerIds: string[], limit: number): Promise<BePendingBooking[]> {
  const rows = await fetchAllPages<BePendingBooking>('/api/v1/bookings', { status: 'pending' })
  return rows.filter((r) => partnerIds.includes(r.partnerId)).slice(0, limit)
}

async function fetchPendingInquiries(partnerIds: string[], limit: number): Promise<BePendingInquiry[]> {
  const rows = await fetchAllPages<BePendingInquiry>('/api/v1/inquiries', { status: 'pending' })
  return rows.filter((r) => r.partnerId != null && partnerIds.includes(r.partnerId)).slice(0, limit)
}

async function fetchReviewProducts(limit: number): Promise<BeReviewProduct[]> {
  const res = await backend.get<BeReviewProduct[]>(`/api/v1/products${qs({ status: 'review' })}`)
  return res.slice(0, limit)
}

export const RETENTION_DAYS = 7
export const retentionCutoff = () => new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

export type NotificationItem = {
  id: string
  text: string
  href: string
  read: boolean
  createdAt: string
  kind: 'live' | 'event'
}

// live-state: Notification 행을 안 만들고, 조회 시점에 도메인 테이블(Booking/Inquiry/Product)을 직접
// 쿼리해 "지금 대기중인 것"을 보여준다. 상태가 바뀌면(답변 등록·승인 등) 쿼리 결과에서 자연히 빠지므로
// 변경 지점마다 알림을 지우는 코드가 필요 없다 — 유저가 "확인함" 표시만 LiveNotificationDismissal에 남긴다.
export async function listNotifications(user: SessionUser, limit = 30): Promise<NotificationItem[]> {
  const scope = visiblePartnerIds(user)
  const t = await getTranslations('notifications')
  const headers = devLoginHeader(user.loginId)

  const [pendingBookings, pendingInquiries, reviewProducts, eventLog, dismissed] = await Promise.all([
    fetchPendingBookings(scope, limit),
    // 문의 신규접수는 업체·연맹만 대상 — 크로스허브는 제외 (알림_기능_최종_구현.md)
    user.role === 'crosshub' ? Promise.resolve([]) : fetchPendingInquiries(scope, limit),
    user.role === 'crosshub' ? fetchReviewProducts(limit) : Promise.resolve([]),
    // eventLog(저장형 Notification)는 사용자 단위라 dev 전용 헤더로 "이 사용자"를 BE에 알린다
    backend.get<BeNotification[]>('/api/v1/notifications', headers),
    prisma.liveNotificationDismissal.findMany({ where: { userId: user.id }, select: { key: true } }),
  ])
  const dismissedKeys = new Set(dismissed.map((d) => d.key))

  const items: NotificationItem[] = [
    ...pendingBookings.map((b) => ({
      id: `booking-${b.id}`,
      text: t('bookingCreated', { customerName: b.customerName, productName: b.productName ?? '' }),
      href: '/bookings',
      read: false,
      createdAt: b.requestedAt,
      kind: 'live' as const,
    })),
    ...pendingInquiries.map((q) => ({
      id: `inquiry-${q.id}`,
      text: t('inquiryCreated', { customerName: q.customerName, productName: q.productName ?? '' }),
      href: `/inquiries?id=${q.id}`,
      read: false,
      createdAt: q.createdAt,
      kind: 'live' as const,
    })),
    ...reviewProducts.map((p) => ({
      id: `product-review-${p.id}`,
      text: t('productReview', { partnerName: p.partnerName ?? '', productName: p.name }),
      href: `/products?id=${p.id}`,
      read: false,
      createdAt: p.createdAt,
      kind: 'live' as const,
    })),
    ...eventLog
      .filter((n) => new Date(n.createdAt) >= retentionCutoff())
      .map((n) => ({
        id: n.id,
        text: eventLogText(t, n.payload as NotificationPayload),
        href: eventLogHref(n.payload as NotificationPayload),
        read: n.read,
        createdAt: n.createdAt,
        kind: 'event' as const,
      })),
  ]

  return items
    .filter((item) => !(item.kind === 'live' && dismissedKeys.has(item.id)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
}

// live-state 3종은 BE에서 받아 partnerIds로 거른 뒤 dismiss된 것만 빼고 센다. eventLog는 BE의
// /count(dev 헤더로 사용자 지정)가 이미 read=false·보존기간 내 기준으로 세어 준다.
// Notification 테이블에 live-state를 옮겨 담는 방식은 일부러 안 썼다 — 그러면 "지금 pending인 것"을
// 매번 다시 계산하는 대신, 상태가 바뀔 때마다(답변 등록·승인 등) 해당 행을 지우거나 읽음 처리하는 코드를
// 모든 변경 지점에 심어야 하고, 하나라도 빠뜨리면 이미 처리된 항목이 계속 "안읽음"으로 남는다.
export async function getUnreadNotificationCount(user: SessionUser): Promise<number> {
  const scope = visiblePartnerIds(user)
  const isCrosshub = user.role === 'crosshub'
  const headers = devLoginHeader(user.loginId)
  const noLimit = Number.MAX_SAFE_INTEGER

  const [pendingBookings, pendingInquiries, reviewProducts, eventLogCount, dismissed] = await Promise.all([
    fetchPendingBookings(scope, noLimit),
    isCrosshub ? Promise.resolve([]) : fetchPendingInquiries(scope, noLimit),
    isCrosshub ? fetchReviewProducts(noLimit) : Promise.resolve([]),
    backend.get<{ unread: number }>('/api/v1/notifications/count', headers),
    prisma.liveNotificationDismissal.findMany({ where: { userId: user.id }, select: { key: true } }),
  ])
  const dismissedKeys = new Set(dismissed.map((d) => d.key))

  const bookingsCount = pendingBookings.filter((b) => !dismissedKeys.has(`booking-${b.id}`)).length
  const inquiriesCount = pendingInquiries.filter((q) => !dismissedKeys.has(`inquiry-${q.id}`)).length
  const productsCount = reviewProducts.filter((p) => !dismissedKeys.has(`product-review-${p.id}`)).length
  return bookingsCount + inquiriesCount + productsCount + eventLogCount.unread
}

/** payload엔 렌더링된 텍스트를 넣지 않는다 — 텍스트는 받는 사람이 자기 화면 언어로 그 자리에서 만든다. */
export async function createNotifications(userIds: string[], payload: NotificationPayload, sourceId: string): Promise<void> {
  if (userIds.length === 0) return

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({ userId, type: payload.type, sourceId, payload })),
    skipDuplicates: true,
  })
}

/** live-state 알림 1건을 이 유저에게서만 숨긴다. 실제 Booking/Inquiry/Product/Partner 상태는
 *  그대로다 — 벨 목록·배지에서만 빠진다(다른 화면·다른 사용자에겐 계속 정확하게 보인다). */
export async function dismissLiveNotification(user: SessionUser, key: string): Promise<void> {
  await prisma.liveNotificationDismissal.upsert({
    where: { userId_key: { userId: user.id, key } },
    create: { userId: user.id, key },
    update: {},
  })
}

export function markAllReadOnReactivate(userId: string) {
  return prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } })
}

export async function markNotificationRead(user: SessionUser, notificationId: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id },
    data: { read: true },
  })
  return result.count > 0
}

export async function markAllNotificationsRead(user: SessionUser): Promise<void> {
  await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } })
}
