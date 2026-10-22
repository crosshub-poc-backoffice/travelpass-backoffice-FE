// 목록 화면(예약·문의·상품)이 같이 쓰는 페이지네이션 상수·헬퍼. DB 접근 없음 — 클라이언트에서도 import 가능

export const PAGE_SIZE = 20

/** searchParams의 page 값(문자열 또는 없음)을 1 이상의 정수로. 잘못된 값은 1페이지로 */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : 1
}
