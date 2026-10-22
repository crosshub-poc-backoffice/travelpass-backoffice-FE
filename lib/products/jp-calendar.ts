// 일본 공휴일·요일 계산. 판매 기간(2026-04 ~ 2027-03)만 상수로 둔다 — 기간이 늘면 여기에 추가.
// 날짜는 'YYYY-MM-DD' 문자열로 다루고, 시간대 문제를 피하려고 UTC로 계산한다.

const HOLIDAYS = new Set([
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
  '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
])

function toDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(s: string, n: number): string {
  const d = toDate(s)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0=일 … 6=토 */
export const weekday = (s: string) => toDate(s).getUTCDay()
export const isHoliday = (s: string) => HOLIDAYS.has(s)
/** 금·토·일·공휴일 (편도 할증 기준) */
export const isWeekendOrHoliday = (s: string) => [5, 6, 0].includes(weekday(s)) || isHoliday(s)
/** 휴일 전날 = 토요일 또는 다음 날이 공휴일 (숙박 할증 기준) */
export const isHolidayEve = (s: string) => weekday(s) === 6 || isHoliday(addDays(s, 1))
