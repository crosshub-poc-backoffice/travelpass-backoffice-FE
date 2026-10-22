// 금액 표시. 통화는 업체 통화(Partner.currency)를 따라간다 — 화면에 ¥를 박지 않는다
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}
