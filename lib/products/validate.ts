// 화면(또는 API)에서 받은 상품 값을 검사하고 정리한다. 모르는 칸은 버리고, 숫자·문자 형태를 맞춘다.
// Server Action이 서비스에 넘기기 전에 꼭 거친다.
import {
  CONFIRM_TYPES,
  PRODUCT_CATEGORIES,
  defaultCategories,
  emptyRoomPricing,
  newId,
  type Block,
  type CancelRule,
  type Category,
  type ChoiceItem,
  type Amount,
  type Plan,
  type PriceColumn,
  type PriceGroup,
  type PriceOption,
  type PriceTable,
  type ProductInput,
  type RoomRate,
  type RoomRateException,
  type RoomType,
  type Yen,
} from './types'
import type { People, SaleSchedule, ScheduleException, SlotRule } from './schedule'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** 실제로 있는 날짜만 ('2026-02-31'·'2026-13-01'은 빈 값) */
function date(v: unknown): string {
  if (typeof v !== 'string' || !DATE.test(v)) return ''
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : ''
}
/** 전각 숫자·마이너스·쉼표(일본어 입력기)를 반각으로 */
const halfWidth = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[，、,\s]/g, '').replace(/[－ー−]/g, '-')
/** 정수이고 min~max 안일 때만, 아니면 null (잘라서 넣지 않는다) */
function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(halfWidth(v)) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** 엔 금액. 빈 값은 null. 항상 0 이상(마이너스는 amount.sign으로 표현) */
function yen(v: unknown): Yen {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(halfWidth(String(v)))
  if (!Number.isFinite(n)) return null
  const r = Math.round(Math.abs(n))
  return r > 100_000_000 ? null : r
}

/** 요금 기준(열). 비어 있으면 성인/아동 기본값 */
function categoriesFor(v: unknown): Category[] {
  const list = arr(v, 10).map((c) => ({ id: str(obj(c).id, 20) || newId(), name: str(obj(c).name, 40) }))
  return list.length ? list : defaultCategories()
}
/** 기준 id → 단가 */
function pricesFor(raw: unknown, cats: Category[]): Record<string, Yen> {
  const o = obj(raw)
  return Object.fromEntries(cats.map((c) => [c.id, yen(o[c.id])]))
}
const plansFor = (v: unknown, cats: Category[]): Plan[] =>
  arr(v, 50).map((p) => ({ id: str(obj(p).id, 20) || newId(), name: str(obj(p).name, 80), prices: pricesFor(obj(p).prices, cats) }))

/** 금액 조정표의 열. 선택 옵션(choiceColumns)은 열 없이 행만 쓸 수 있어 allowEmpty로 기본 열 보정을 건너뛴다 */
function priceColumnsFor(v: unknown, { allowEmpty = false }: { allowEmpty?: boolean } = {}): PriceColumn[] {
  const list = arr(v, 20).map((c) => ({ id: str(obj(c).id, 20) || newId(), name: str(obj(c).name, 40) }))
  return list.length || allowEmpty ? list : [{ id: newId(), name: '금액' }]
}

function amountFor(v: unknown): Amount {
  const o = obj(v)
  return { sign: o.sign === 'sub' ? 'sub' : 'add', price: yen(o.price) }
}

/** 전부 채우지 않은 칸은 null·빈 문자열이라, 이름도 없고 금액도 없는 줄은 비워 둔 것으로 보고 버린다 */
const amountIsEmpty = (a: Amount) => a.price === null
const optionIsEmpty = (name: string, amounts: Record<string, Amount>) => !name && Object.values(amounts).every(amountIsEmpty)
const choiceIsEmpty = (name: string, values: Record<string, string>) => !name && Object.values(values).every((v) => !v)

/** 금액 조정표 (여러 개 가능, 전부 선택 입력). 이름도 금액도 안 채운 줄, 그래서 줄이 하나도 안 남은 표는 버린다 */
function priceGroupsFor(v: unknown): PriceGroup[] {
  return arr(v, 30)
    .map((g) => {
      const o = obj(g)
      const columns = priceColumnsFor(o.columns)
      const options: PriceOption[] = arr(o.options, 200)
        .map((p) => {
          const x = obj(p)
          const raw = obj(x.amounts)
          const name = str(x.name, 80)
          const amounts = Object.fromEntries(columns.map((c) => [c.id, amountFor(raw[c.id])]))
          return { id: str(x.id, 20) || newId(), name, amounts }
        })
        .filter((p) => !optionIsEmpty(p.name, p.amounts))
      return { id: str(o.id, 20) || newId(), title: str(o.title, 60), required: o.required === true, columns, options }
    })
    .filter((g) => g.options.length > 0)
}

/** 고객이 고르는 선택지 목록 (가격 무관, 전부 선택 입력). 이름도 값도 안 채운 줄은 버린다 */
function choicesFor(v: unknown, choiceColumns: PriceColumn[]): ChoiceItem[] {
  return arr(v, 200)
    .map((c) => {
      const x = obj(c)
      const raw = obj(x.values)
      const name = str(x.name, 80)
      const values = Object.fromEntries(choiceColumns.map((col) => [col.id, str(raw[col.id], 200)]))
      return { id: str(x.id, 20) || newId(), name, values }
    })
    .filter((c) => !choiceIsEmpty(c.name, c.values))
}

/** 상품 상세 섹션(일정표·교통편·숙박시설·체험 프로그램 등, 전부 선택 입력). 개수 제한 없음.
 *  제목·이미지·텍스트·금액조정·선택지가 전부 비어 있는 섹션은 버린다 */
export function blocksFor(v: unknown): Block[] {
  return arr(v, 50)
    .map((b) => {
      const o = obj(b)
      const choiceColumns = priceColumnsFor(o.choiceColumns, { allowEmpty: true })
      const title = str(o.title, 80)
      const images = imagesFor(o.images)
      const text = str(o.text, 4000)
      const priceGroups = priceGroupsFor(o.priceGroups)
      const choices = choicesFor(o.choices, choiceColumns)
      return { id: str(o.id, 20) || newId(), title, images, text, priceGroups, choiceColumns, choices, choicesRequired: o.choicesRequired === true }
    })
    .filter((b) => b.title || b.images.length > 0 || b.text || b.priceGroups.length > 0 || b.choices.length > 0)
}

/** 숙박 "2. 객실 정보" — 행. 이름도 세 칸도 안 채운 줄은 버린다 */
function roomTypesFor(v: unknown): RoomType[] {
  return arr(v, 50)
    .map((r) => {
      const o = obj(r)
      return {
        id: str(o.id, 20) || newId(),
        name: str(o.name, 60),
        standardPeople: intIn(o.standardPeople, 0, 50),
        maxPeople: intIn(o.maxPeople, 0, 50),
        roomCount: intIn(o.roomCount, 0, 9_999),
      }
    })
    .filter((r) => r.name || r.standardPeople !== null || r.maxPeople !== null || r.roomCount !== null)
}

function roomRateFor(v: unknown): RoomRate {
  const o = obj(v)
  return { price: yen(o.price), count: intIn(o.count, 0, 9_999) }
}
const roomRateIsEmpty = (r: RoomRate) => r.price === null && r.count === null
/** roomTypeId → 요금. 등록된 객실 타입에 있는 것만 남긴다 (삭제된 객실타입의 요금은 버림) */
function roomRatesFor(v: unknown, roomTypes: RoomType[]): Record<string, RoomRate> {
  const o = obj(v)
  const entries = roomTypes.map((rt) => [rt.id, roomRateFor(o[rt.id])] as const).filter(([, r]) => !roomRateIsEmpty(r))
  return Object.fromEntries(entries)
}

/** 숙박 "3. 객실 요금" 기간 예외. 날짜가 틀리거나 요금이 전부 빈 줄은 버린다 */
function roomRateExceptionsFor(v: unknown, roomTypes: RoomType[]): RoomRateException[] {
  return arr(v, 500)
    .map((e) => {
      const o = obj(e)
      return { id: str(o.id, 20) || newId(), start: date(o.start), end: date(o.end), rates: roomRatesFor(o.rates, roomTypes) }
    })
    .filter((e) => e.start && e.end && e.start <= e.end && Object.keys(e.rates).length > 0)
}

/** 여행 요금표 (DB의 Product.priceTable 컬럼) */
export function priceTableFor(raw: unknown): PriceTable {
  const d = obj(raw)
  const categories = categoriesFor(d.categories)
  const roomTypes = roomTypesFor(d.roomTypes)
  return {
    categories,
    plans: plansFor(d.plans, categories),
    priceImages: imagesFor(d.priceImages),
    priceText: str(d.priceText, 2000),
    title: str(d.title, 60),
    roomTypes,
    roomPricing: {
      base: roomRatesFor(obj(d.roomPricing).base, roomTypes),
      exceptions: roomRateExceptionsFor(obj(d.roomPricing).exceptions, roomTypes),
    },
  }
}

/** 취소 규칙 목록 정리 (DB에서 읽을 때와 화면 입력 둘 다). 같은 일수는 한 줄만, 이용일 기준 먼 날부터(내림차순) */
export function cancelRulesFor(raw: unknown): CancelRule[] {
  const rules = arr(raw, 10)
    .map((r) => ({ daysBefore: intIn(obj(r).daysBefore, 0, 365), percent: intIn(obj(r).percent, 0, 100) }))
    .filter((r): r is CancelRule => r.daysBefore !== null && r.percent !== null)
  const seen = new Set<number>()
  const unique = rules.filter((r) => (seen.has(r.daysBefore) ? false : (seen.add(r.daysBefore), true)))
  return unique.sort((a, b) => b.daysBefore - a.daysBefore)
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const time = (v: unknown): string => (typeof v === 'string' && TIME.test(v) ? v : '')
const peopleFor = (v: unknown): People => ({ minPeople: intIn(obj(v).minPeople, 0, 10_000), maxPeople: intIn(obj(v).maxPeople, 0, 10_000) })

/** 판매 일정 (DB에서 읽을 때와 화면 입력 둘 다). 회차는 "HH:MM"만 남겨 정렬하고,
 *  회차별 값(slotPeople·예외의 slots)은 있는 회차만 남긴다. 날짜가 틀린 예외는 버린다 */
export function scheduleFor(raw: unknown): SaleSchedule {
  const o = obj(raw)
  const b = obj(o.base)
  const times = [...new Set(arr(b.times, 48).map(time).filter(Boolean))].sort()
  const slotsOf = <T>(v: unknown, f: (x: unknown) => T): Record<string, T> => {
    const m = obj(v)
    return Object.fromEntries(times.filter((t) => t in m).map((t) => [t, f(m[t])]))
  }
  const basePeople = peopleFor(b)
  // 회차별 인원은 회차가 2개 이상일 때만 의미가 있고, 쓰는 중이면 모든 회차에 값이 있어야 한다
  const own = slotsOf(b.slotPeople, peopleFor)
  const slotPeople = times.length > 1 && Object.keys(own).length ? Object.fromEntries(times.map((t) => [t, own[t] ?? basePeople])) : {}
  const exceptions: ScheduleException[] = arr(o.exceptions, 500)
    .map((e) => {
      const x = obj(e)
      const slots = slotsOf(x.slots, (v): SlotRule => ({ open: obj(v).open === true, ...peopleFor(v) }))
      return { id: str(x.id, 20) || newId(), start: date(x.start), end: date(x.end), open: x.open === true, ...peopleFor(x), slots }
    })
    .filter((e) => e.start && e.end && e.start <= e.end)
  return {
    base: {
      start: date(b.start),
      end: date(b.end),
      weekdays: [...new Set(arr(b.weekdays, 7).map((w) => intIn(w, 0, 6)).filter((w): w is number => w !== null))],
      times,
      slotPeople,
      ...basePeople,
    },
    exceptions,
  }
}

/** 사진 URL 목록 (최대 10장, 중복 제거). 우리 저장소 사진인지는 BE 가 본다 — 아니면 저장 때 빠진다 (BE ProductImages) */
export const imagesFor = (raw: unknown): string[] => [...new Set(arr(raw, 10).map((v) => str(v, 500)).filter(Boolean))]

export type ParseResult = { ok: true; value: ProductInput } | { ok: false; error: 'required' | 'productPrice' }

/** draft: 임시저장이면 상품명만 있으면 된다 (요금표 가격은 등록할 때 확인) */
export function parseProductInput(raw: unknown, { draft = false }: { draft?: boolean } = {}): ParseResult {
  const o = obj(raw)
  const value: ProductInput = {
    partnerId: str(o.partnerId, 40),
    category: oneOf(o.category, PRODUCT_CATEGORIES, 'other'),
    name: str(o.name, 120),
    images: imagesFor(o.images),
    description: str(o.description, 4000),
    deadlineDays: intIn(o.deadlineDays, 0, 365) ?? 1,
    deadlineTime: time(o.deadlineTime) || '17:00',
    confirmType: oneOf(o.confirmType, CONFIRM_TYPES, 'instant'),
    schedule: scheduleFor(o.schedule),
    cancelRules: cancelRulesFor(o.cancelRules),
    priceTable: priceTableFor(o.priceTable),
    blocks: blocksFor(o.blocks),
  }
  // partnerId는 여기서 보지 않는다 — 업체 계정은 서버가 채우고, 범위 확인은 partnerForWrite가 한다
  // 필수는 상품명·요금표 가격뿐 — 사진·취소 수수료·그 외는 전부 선택 입력
  if (!value.name) return { ok: false, error: 'required' }
  // 등록 화면에서 상품 종류를 바꿔도 화면에 안 보이는 입력은 남아 같이 올라온다 — 종류에 안 맞는 요금 데이터는 저장하지 않는다
  value.priceTable =
    value.category === 'lodging'
      ? { ...value.priceTable, categories: [], plans: [], priceImages: [], priceText: '' }
      : { ...value.priceTable, roomTypes: [], roomPricing: emptyRoomPricing() }
  // 판매 기간(saleStart~saleEnd)은 ProductInput에 직접 없다 — scheduleFor가 계산해서 service.ts가 saleRange()로 뽑아낸다
  // 숙박은 일반 요금표(plans) 대신 객실 기본 요금(roomPricing.base)에 가격이 있어야 한다
  const hasPrice =
    value.category === 'lodging'
      ? Object.values(value.priceTable.roomPricing.base).some((r) => r.price !== null)
      : value.priceTable.plans.some((p) => Object.values(p.prices).some((v) => v !== null))
  if (!hasPrice && !draft) return { ok: false, error: 'productPrice' }
  return { ok: true, value }
}
