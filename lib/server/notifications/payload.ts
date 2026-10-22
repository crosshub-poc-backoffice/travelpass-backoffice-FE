import { AUTO_REJECT_REASON } from '@/lib/products/types'
type ProductChangeType = 'edit' | 'delete' | 'hide'

export type NotificationPayload =
  | { type: 'booking_quote_responded'; bookingId: string; decision: 'accepted' | 'declined' }
  | { type: 'product_status_changed'; productId: string; productName: string; status: 'live' | 'hidden' }
  | {
      type: 'product_change_requested'
      requestId: string
      productId: string
      productName: string
      changeType: ProductChangeType
      targetStatus?: 'live' | 'hidden'
      requesterName: string
    }
  | {
      type: 'product_change_resolved'
      requestId: string
      productId: string
      productName: string
      changeType: ProductChangeType
      targetStatus?: 'live' | 'hidden'
      result: 'approved' | 'rejected'
      reason?: string // result가 rejected일 때만
    }
  | { type: 'product_direct_change'; productId: string; productName: string; changeType: ProductChangeType; targetStatus?: 'live' | 'hidden' }

export type NotificationType = NotificationPayload['type']

// next-intl의 서버용 getTranslations()와 클라이언트용 useTranslations()가 공통으로 만족하는 최소 형태.
// 텍스트는 항상 "보는 사람"의 번역기로 그 자리에서 렌더링한다 — 생성 시점에 미리 렌더링해서 보내면
// 다른 언어 쓰는 사람이 못 읽는 문제가 생긴다(문의 번역에서 겪은 것과 같은 함정).
type Translate = (key: string, values?: Record<string, string | number>) => string

function changeLabel(t: Translate, changeType: ProductChangeType, targetStatus?: 'live' | 'hidden'): string {
  if (changeType === 'edit') return t('changeLabelEdit')
  if (changeType === 'delete') return t('changeLabelDelete')
  return t(targetStatus === 'live' ? 'changeLabelShow' : 'changeLabelHide')
}

export function eventLogText(t: Translate, payload: NotificationPayload): string {
  switch (payload.type) {
    case 'booking_quote_responded':
      return t(payload.decision === 'accepted' ? 'bookingQuoteAccepted' : 'bookingQuoteDeclined')
    case 'product_status_changed':
      return t(payload.status === 'live' ? 'productApproved' : 'productRejected', { productName: payload.productName })
    case 'product_change_requested':
      return t('productChangeRequested', {
        requesterName: payload.requesterName,
        productName: payload.productName,
        change: changeLabel(t, payload.changeType, payload.targetStatus),
      })
    case 'product_change_resolved':
      return payload.result === 'approved'
        ? t('productChangeApproved', { productName: payload.productName, change: changeLabel(t, payload.changeType, payload.targetStatus) })
        : t('productChangeRejected', {
            productName: payload.productName,
            change: changeLabel(t, payload.changeType, payload.targetStatus),
            reason: payload.reason === AUTO_REJECT_REASON ? t('autoRejectReason') : (payload.reason ?? ''),
          })
    case 'product_direct_change':
      return t('productDirectChange', { productName: payload.productName, change: changeLabel(t, payload.changeType, payload.targetStatus) })
  }
}

export function eventLogHref(payload: NotificationPayload): string {
  switch (payload.type) {
    case 'booking_quote_responded':
      return '/bookings'
    case 'product_status_changed':
      return `/products?id=${payload.productId}`
    case 'product_change_requested':
    case 'product_change_resolved':
    case 'product_direct_change':
      return `/products?id=${payload.productId}`
  }
}
