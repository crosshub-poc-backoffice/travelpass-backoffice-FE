// 예약 관련 타입. (DB 접근 없음 — 클라이언트에서도 import 가능)

/** 예약 시점에 고객이 실제로 고른 요금 구성 스냅샷 — 나중에 상품 요금표가 바뀌어도 이 값은 안 바뀐다.
 *  TP 앱이 계산해서 보내는 값이라 서버는 Product.priceTable과 대조 검증하지 않는다 (amount를 그대로 믿는 것과 같은 수준). */
export type PriceBreakdown = {
  planId: string
  planName: string
  peopleByCategory: { categoryId: string; categoryName: string; count: number }[]
  selectedOptions: { label: string; amount: number }[]
}
