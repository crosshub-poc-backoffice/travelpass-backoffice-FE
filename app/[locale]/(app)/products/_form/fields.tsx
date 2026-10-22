// 상품 목록(products-view.tsx)에서 가격을 "¥1,234" 식으로 보여줄 때 쓴다.
export const formatYen = (n: number) => `${n < 0 ? '−' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`
