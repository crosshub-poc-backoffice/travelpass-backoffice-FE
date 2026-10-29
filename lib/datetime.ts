// 백오피스의 시각은 업무 기준 시간대 하나(일본, JST)로 보여준다. 보는 사람 나라·화면 언어와 상관없이 같은 시각을 보게 하려는 것.
// 언어는 날짜 모양(Oct 14 / 10월 14일)만 바꾼다. 날짜만 있는 값(이용일·판매일)은 이미 현지 날짜라 여기서 바꾸지 않는다.

export const BUSINESS_TIME_ZONE = 'Asia/Tokyo'
const BUSINESS_TIME_ZONE_LABEL = 'JST'

/** 일본 시간(JST, UTC+9) 기준 오늘 (YYYY-MM-DD) — 백오피스 업무 기준 시간대 */
export function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 시각 → "Oct 14, 2026, 16:40 JST" (seconds: 초까지) */
export function formatJstDateTime(iso: string, locale: string, { seconds = false }: { seconds?: boolean } = {}): string {
  const text = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: seconds ? 'medium' : 'short',
    hourCycle: 'h23',
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(iso))
  return `${text} ${BUSINESS_TIME_ZONE_LABEL}`
}

/** 시각의 날짜 부분만 → "Oct 14, 2026" (JST 기준 날짜) */
export function formatJstDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: BUSINESS_TIME_ZONE }).format(new Date(iso))
}

/** 월(YYYY-MM) → "October 2026" / "2026년 10월". 달력상의 월이라 시간대 변환 없음 */
export function formatMonth(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
}

/** 날짜만 있는 값(YYYY-MM-DD, 이용일 등) → "Dec 20, 2026". 현지 날짜 그대로라 시간대 변환 없음 */
export function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}
