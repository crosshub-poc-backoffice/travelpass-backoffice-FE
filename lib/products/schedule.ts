// 판매 일정의 모양과 계산. 화면(sale-calendar.tsx)과 서버(저장할 때 판매 기간 계산)가 같이 쓴다. (DB 접근 없음)
// 판매 일정 = 기본 일정 1개 + 예외 여러 개. 예외는 기본 일정보다 우선하고, 예외끼리 겹치면 나중 것이 이긴다.
import { addDays, weekday } from './jp-calendar'

export type People = { minPeople: number | null; maxPeople: number | null }
/** times: 출발 시각(회차) "HH:MM" 목록. [] = 하루 단위
 *  slotPeople: 회차별 인원. {} = 모든 회차가 위의 minPeople~maxPeople로 같음 */
export type BaseSchedule = People & { start: string; end: string; weekdays: number[]; times: string[]; slotPeople: Record<string, People> }
/** 회차 하나의 판매 여부 + 인원 */
export type SlotRule = People & { open: boolean }
/** slots: 회차별로 따로 정한 값. {} = 모든 회차에 open·인원이 똑같이 걸림. open = 하나라도 파는지 */
export type ScheduleException = People & { id: string; start: string; end: string; open: boolean; slots: Record<string, SlotRule> }
export type SaleSchedule = { base: BaseSchedule; exceptions: ScheduleException[] }

const baseCovers = (b: BaseSchedule, d: string) =>
  !!b.end && b.start <= d && d <= b.end && b.weekdays.includes(weekday(d))

export type SlotState = { time: string; open: boolean; people: People }

/** 그 날의 판매 상태. ex = 그 날에 걸린 예외(있으면), slots = 회차별 상태 (하루 단위면 time "" 하나).
 *  예외에 회차별 값이 있으면 그걸, 없으면 예외 전체 값을, 예외가 없으면 기본 일정을 따른다. open = 하나라도 파는지 */
export function resolve(s: SaleSchedule, d: string): { open: boolean; people: People; ex: ScheduleException | null; slots: SlotState[] } {
  const ex = s.exceptions.findLast((e) => e.start <= d && d <= e.end) ?? null
  const uniform = ex && !Object.keys(ex.slots).length
  const slots = (s.base.times.length ? s.base.times : ['']).map((time): SlotState => {
    const own = ex?.slots[time]
    if (own) return { time, open: own.open, people: own }
    if (uniform) return { time, open: ex.open, people: ex }
    return { time, open: baseCovers(s.base, d), people: s.base.slotPeople[time] ?? s.base }
  })
  const firstOpen = slots.find((x) => x.open)
  return { open: !!firstOpen, people: (firstOpen ?? slots[0]).people, ex, slots }
}

/** 판매 기간 = 실제로 파는 첫날 ~ 마지막 날. 파는 날이 없으면 null */
export function saleRange(s: SaleSchedule): [string, string] | null {
  const starts = [s.base.end ? s.base.start : null, ...s.exceptions.filter((e) => e.open).map((e) => e.start)].filter(Boolean) as string[]
  const ends = [s.base.end || null, ...s.exceptions.filter((e) => e.open).map((e) => e.end)].filter(Boolean) as string[]
  if (!starts.length) return null
  let first: string | null = null
  let last: string | null = null
  const to = ends.reduce((a, b) => (b > a ? b : a))
  for (let d = starts.reduce((a, b) => (b < a ? b : a)); d <= to; d = addDays(d, 1)) {
    if (resolve(s, d).open) {
      first ??= d
      last = d
    }
  }
  return first && last ? [first, last] : null
}
