// 예약 상태·확정방식·고객응답 DB enum → 화면 라벨. 예약·정산·결제내역 화면이 같이 쓴다 (프로토타입의 한글 라벨 그대로)
import type { ConfirmType } from '@/lib/products/types'

/** 예약 상태 (BE Booking.status, DB enum BookingStatus) */
export const BOOKING_STATUSES = ['pending', 'quoted', 'confirmed', 'rejected', 'completed', 'canceled', 'refunded', 'withdrawn'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/** 고객의 견적 응답 (BE Booking.customerDecision) */
export type CustomerDecision = 'waiting' | 'accepted' | 'declined'

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: '업체확인중',
  quoted: '고객확인중',
  confirmed: '확정',
  rejected: '거절',
  completed: '이용완료',
  canceled: '취소',
  refunded: '환불완료',
  withdrawn: '신청취소',
}

export const CONFIRM_LABEL: Record<ConfirmType, string> = { instant: '즉시확정', quote: '견적확인후확정' }

export const DECISION_LABEL: Record<CustomerDecision, string> = { waiting: '대기', accepted: '수락', declined: '거절' }

// 화면은 BookingRow.status/.confirmType/.customerDecision에 위 한글 라벨을 그대로 받는다. 다국어 표시가
// 필요한 곳(대시보드·예약 관리 등)은 이 역방향 맵으로 enum을 되찾아 messages의 bookings.{status,confirmType,decision}.{enum}을 조회한다.
function invert<T extends string>(label: Record<T, string>): Record<string, T> {
  return Object.fromEntries(Object.entries(label).map(([key, value]) => [value, key as T]))
}

export const BOOKING_LABEL_TO_STATUS = invert(BOOKING_STATUS_LABEL)
export const CONFIRM_LABEL_TO_TYPE = invert(CONFIRM_LABEL)
export const DECISION_LABEL_TO_CODE = invert(DECISION_LABEL)

// 진행 중 예약 = 업체가 아직 챙겨야 하는 상태. 예약 목록의 기본 화면이고, 이 상태만 칩에 건수를 붙인다.
// 취소도 업체가 환불완료 처리를 해야 끝나서 여기 넣는다 (이용완료·거절·환불완료는 쌓이기만 하는 기록이라 건수가 의미 없다)
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['pending', 'quoted', 'confirmed', 'canceled']
