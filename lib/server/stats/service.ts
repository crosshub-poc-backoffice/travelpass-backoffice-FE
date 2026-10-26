import 'server-only'
import { backend, qs } from '@/lib/api/backend'
import type { SessionUser } from '@/lib/server/auth/session'

// 판매 통계. 기간(from~to, 일본 시간)은 예약 접수일 기준이고 판매 = 확정·이용완료 예약.
// 카드·추이·표·수익이 모두 같은 기준이라 카드 = 추이 합 = 표 합. 수익은 그 판매 건들의 계정별 몫 (예약 때 박힌 요율).
// 증감은 기간이 걸친 달 수만큼 앞의 같은 날짜와 비교 (이번 달 1~15일 ↔ 지난달 1~15일). 범위는 로그인 계정이 다룰 수 있는 업체 (visiblePartnerIds).
// 금액은 통화별로 따로 더한다 (환산 없음)

export type StatsFilter = { from: string; to: string }

export type StatsData = {
  /** 증감 비교 기간 (걸친 달 수만큼 앞의 같은 날짜) */
  prev: StatsFilter
  /** 추이 단위. 62일 이하면 일별, 넘으면 월별 */
  bucket: 'day' | 'month'
  /** 기간 안 추이: 칸(날짜 또는 YYYY-MM)별 통화별 판매금액·판매 건수·많이 팔린 상품 3개 */
  series: { key: string; amount: Record<string, number>; sold: Record<string, number>; top: Record<string, { name: string; nameAi: boolean; count: number }[]> }[]
  /** 판매(확정·이용완료) 건수와 취소·환불 건수 */
  soldTotal: number
  prevSoldTotal: number
  canceledTotal: number
  /** 통화별 판매금액 (prev = 직전 기간) */
  sales: { currency: string; amount: number; prevAmount: number }[]
  /** 수익: 판매 건들의 "이 계정의 몫" 합. 통화별.
   *  업체 = 정산액(판매가 − 수수료), 연맹 = 연맹 몫, 크로스허브 = 수수료 − PG − 연맹 몫 (정산 관리 배분과 같은 계산) */
  settlement: { rows: { currency: string; amount: number; prevAmount: number }[] }
  /** 상품별: 판매(확정·이용완료)·취소(환불 포함) 건수와 판매 금액 */
  products: { id: string; name: string; nameAi: boolean; partner: string; currency: string; sold: number; canceled: number; amount: number }[]
  /** 업체별: 판매·취소(환불 포함) 건수, 판매 금액, 판매 건들의 정산액 */
  partners: { id: string; name: string; currency: string; sold: number; canceled: number; amount: number; settlementNet: number }[]
}

/**
 * 판매 통계. 집계·몫 배분·비교 기간 계산·상품명 번역까지 BE(GET /api/v1/stats)가 한다.
 * 범위는 BE 가 토큰으로 건다 — 업체 전환으로 고른 업체가 있으면 그 업체만.
 */
export async function getStats(user: SessionUser, filter: StatsFilter, locale: string): Promise<StatsData> {
  return backend.get<StatsData>(`/api/v1/stats${qs({ from: filter.from, to: filter.to, partnerId: user.activePartnerId ?? undefined, locale })}`)
}
