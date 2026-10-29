export const CURRENCY_PATTERN = /^[A-Z]{3}$/ // ISO 4217
// 업체 통화로 고를 수 있는 목록. 직접 입력하면 JPP 같은 오타가 들어가서 목록으로만 고른다 — 필요하면 여기에 추가
export const SUPPORTED_CURRENCIES = ['JPY', 'KRW', 'USD', 'CNY', 'TWD', 'HKD', 'VND', 'EUR'] as const

// 금액 표시. 통화는 업체 통화(Partner.currency)를 따라간다 — 화면에 ¥를 박지 않는다
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}
