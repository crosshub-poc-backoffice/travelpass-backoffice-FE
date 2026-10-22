// 수수료 계산. 서버(스냅샷 저장)와 화면(미리보기)이 같이 쓴다 — DB 접근 없음
import type { CancelRule } from '@/lib/products/types'

/** 판매가를 업체 수수료율로 나눈다. 수수료는 반올림, 정산액은 나머지 (둘을 더하면 항상 판매가) */
export function splitAmount(amount: number, commissionRate: number) {
  const commission = Math.round((amount * commissionRate) / 100)
  return { commission, net: amount - commission }
}

/** 한 달에 섞인 요율을 한 칸에 보여주는 라벨: 전부 같으면 "15", 섞이면 "12~15", 없으면 null */
export function rateLabel(rates: number[]): string | null {
  const uniq = [...new Set(rates.map((r) => Math.round(r * 100) / 100))].sort((a, b) => a - b)
  if (uniq.length === 0) return null
  return uniq.length === 1 ? String(uniq[0]) : `${uniq[0]}~${uniq[uniq.length - 1]}`
}

/** 취소 수수료율(%). 규칙은 "출발 daysBefore일 전까지 취소하면 percent%", 마지막 줄 뒤(그 이후 취소·노쇼)는 100% */
export function cancelFeePercent(rules: CancelRule[], daysLeft: number): number {
  const sorted = [...rules].sort((a, b) => b.daysBefore - a.daysBefore)
  const hit = sorted.find((r) => daysLeft >= r.daysBefore)
  return hit ? hit.percent : 100
}

export function cancelFeeFor(amount: number, rules: CancelRule[], daysLeft: number): number {
  return Math.round((amount * cancelFeePercent(rules, daysLeft)) / 100)
}

/** YYYY-MM-DD 두 날짜의 차이(일). toDay − fromDay */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86400000)
}
