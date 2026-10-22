// 정산 관리 화면·Server Action·서비스가 같이 쓰는 상수. DB 접근 없음 — 클라이언트에서도 import 가능

export const SETTLEMENT_TABS = ['monthly', 'payments', 'settings'] as const
export type SettlementTab = (typeof SETTLEMENT_TABS)[number]

export const PAYMENT_TYPES = ['payment', 'refund'] as const
export type PaymentTypeKey = (typeof PAYMENT_TYPES)[number]

export const CURRENCY_PATTERN = /^[A-Z]{3}$/ // ISO 4217
// 결제 설정에서 고를 수 있는 통화. 직접 입력하면 JPP 같은 오타가 들어가서 목록으로만 고른다 — 필요하면 여기에 추가
export const SUPPORTED_CURRENCIES = ['JPY', 'KRW', 'USD', 'CNY', 'TWD', 'HKD', 'VND', 'EUR'] as const
export const isSupportedCurrency = (value: string) => (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
export const PG_NAME_MAX = 50
export const PAY_DAY_MAX = 28 // 모든 달에 있는 날짜만

/** 일본 시간(JST, UTC+9) 기준 오늘 (YYYY-MM-DD) — 백오피스 업무 기준 시간대 */
export function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** YYYY-MM에 delta개월 더하기 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}

/** 그 달이 끝났는지 (일본 시간). 끝나기 전에 지급완료하면 뒤늦게 이용완료된 건이 굳힌 금액에서 빠진다 */
export function isMonthEnded(month: string): boolean {
  return month < jstToday().slice(0, 7)
}
