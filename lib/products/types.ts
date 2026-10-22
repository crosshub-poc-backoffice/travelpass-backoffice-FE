// 상품 등록 화면·서버가 같이 쓰는 타입과 기본값. (DB 접근 없음 — 클라이언트에서도 import 가능)
// 종류 구분 없는 단일 상품 모양 — 상품 등록 화면 설계 프로토타입을 그대로 따른다.

import type { SaleSchedule } from './schedule'

export const PRODUCT_STATUSES = ['draft', 'review', 'live', 'hidden'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

export const CONFIRM_TYPES = ['instant', 'quote'] as const
export type ConfirmType = (typeof CONFIRM_TYPES)[number]

export const PRODUCT_CATEGORIES = ['tour', 'lodging', 'transport', 'package', 'other'] as const
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

/** 크로스허브가 직접 처리해서 대기중 변경요청이 자동 반려될 때 DB에 남기는 사유.
 *  화면·알림은 이 값이면 언어별 문구(changeRequest.autoRejectReason)로 바꿔 보여준다 */
export const AUTO_REJECT_REASON = '크로스허브가 상품을 직접 처리하여 자동으로 반려되었습니다.'

/** 엔 금액. 비어 있으면 null */
export type Yen = number | null

/** 어디서든 쓰는 짧은 무작위 id (기준·플랜·열·행·블록 등) */
export const newId = () => Math.random().toString(36).slice(2, 8)

/** 요금 기준(요금표의 열). 손님이 예약할 때 기준마다 인원을 고른다. 예: 성인 / 아동 */
export type Category = { id: string; name: string }
export const defaultCategories = (): Category[] => [
  { id: newId(), name: '성인' },
  { id: newId(), name: '아동' },
]

/** 요금 플랜(요금표의 행). 이름은 자유 텍스트(예: "3일간", "2박 3일"). prices = 기준 id → 단가 */
export type Plan = { id: string; name: string; prices: Record<string, Yen> }
export const newPlan = (): Plan => ({ id: newId(), name: '', prices: {} })

/** 금액 조정표의 열. 기본은 이름 없는 열 하나뿐이지만, 하행편/상행편처럼 방향별로 금액이 다르면 열을 추가한다 */
export type PriceColumn = { id: string; name: string }
export const newPriceColumn = (name = ''): PriceColumn => ({ id: newId(), name })

/** 금액 한 칸: 추가/차감 + 금액 */
export type Amount = { sign: 'add' | 'sub'; price: Yen }
export const emptyAmount = (): Amount => ({ sign: 'add', price: null })

/** 금액 조정 한 줄. 이름 + 열마다 금액 — 예: "스위트 업그레이드"의 하행편 +17,600엔 / 상행편 +8,800엔 */
export type PriceOption = { id: string; name: string; amounts: Record<string, Amount> }

/** 금액 조정표 1개. 블록(섹션)마다 서로 다른 기준의 금액 조정표를 여러 개 가질 수 있다.
 *  required: 필수면 고객이 이 표에서 하나를 꼭 골라야 하고, 선택이면 안 골라도 된다 */
export type PriceGroup = { id: string; title: string; required: boolean; columns: PriceColumn[]; options: PriceOption[] }
export function newPriceGroup(): PriceGroup {
  const col = newPriceColumn()
  return { id: newId(), title: '', required: false, columns: [col], options: [{ id: newId(), name: '', amounts: { [col.id]: emptyAmount() } }] }
}

/** 고객이 고르는 선택지 한 줄. 가격에는 영향 없는 단순 정보(어떤 선택지가 있는지)만 담는다 */
export type ChoiceItem = { id: string; name: string; values: Record<string, string> }
export function newChoice(columns: PriceColumn[]): ChoiceItem {
  return { id: newId(), name: '', values: Object.fromEntries(columns.map((c) => [c.id, ''])) }
}

/** 상품 상세 섹션 하나 (일정표·교통편·숙박시설·체험 프로그램 등). 개수 제한 없음.
 *  images·text는 그대로 노출, priceGroups는 이 섹션만의 금액 조정표, choices는 가격 무관 선택지.
 *  choicesRequired: 필수면 고객이 선택지 중 하나를 꼭 골라야 한다 */
export type Block = {
  id: string
  title: string
  images: string[]
  text: string
  priceGroups: PriceGroup[]
  choiceColumns: PriceColumn[]
  choices: ChoiceItem[]
  choicesRequired: boolean
}
export function newBlock(title = ''): Block {
  const col = newPriceColumn()
  return { id: newId(), title, images: [], text: '', priceGroups: [newPriceGroup()], choiceColumns: [col], choices: [newChoice([col])], choicesRequired: false }
}

/** 취소 수수료 규칙 한 줄: "출발 daysBefore일 전까지 취소하면 percent%". 마지막 줄 뒤(그 이후 취소·노쇼)는 항상 100% */
export type CancelRule = { daysBefore: number; percent: number }

/** 숙박 상품의 객실 타입 한 줄 (2번 "객실 정보" 표의 행). 이름은 자유 입력(예: "스위트룸") */
export type RoomType = { id: string; name: string; standardPeople: number | null; maxPeople: number | null; roomCount: number | null }
export const newRoomType = (): RoomType => ({ id: newId(), name: '', standardPeople: null, maxPeople: null, roomCount: null })

/** 객실 타입 1개의 가격·판매 가능 수. 둘 다 비어 있으면 그 기간엔 이 객실을 안 판다는 뜻 */
export type RoomRate = { price: Yen; count: number | null }
export const emptyRoomRate = (): RoomRate => ({ price: null, count: null })

/** 기간 단위로 객실 요금을 다르게 매기는 예외. SaleCalendar의 예외(기간 겹치면 나중 것이 이긴다)와 같은 규칙 */
export type RoomRateException = { id: string; start: string; end: string; rates: Record<string, RoomRate> }

/** 3번 "객실 요금" — 날짜별로 객실 타입마다 가격·판매 수를 매긴다. base는 전체 기간 기본값, exceptions가 특정 기간을 덮어쓴다 */
export type RoomPricing = { base: Record<string, RoomRate>; exceptions: RoomRateException[] }
export const emptyRoomPricing = (): RoomPricing => ({ base: {}, exceptions: [] })

/** 기본 요금표 (DB의 별도 컬럼 Product.priceTable) */
export type PriceTable = {
  categories: Category[]
  plans: Plan[]
  priceImages: string[] // 요금표 참고 이미지
  priceText: string // 요금표 참고 사항
  title: string // "기타" 상품 종류에서 직접 입력하는 섹션 제목. 비어 있으면 화면이 기본 문구를 보여준다
  roomTypes: RoomType[] // 숙박 전용. 그 외 카테고리는 항상 빈 배열
  roomPricing: RoomPricing // 숙박 전용. 그 외 카테고리는 항상 emptyRoomPricing()
}

/** 등록·수정 화면이 서버로 보내는 값. priceTable·blocks는 DB에서도 별도 컬럼(Product.priceTable, Product.blocks) —
 *  일정표만 고쳐도 요금표를 다시 안 써도 되게 나눠둔다. blocks[0]은 "일정표"(고정 제목), 그 뒤는 자유 추가 섹션 */
export type ProductInput = {
  partnerId: string
  category: ProductCategory
  name: string
  images: string[] // 첫 장이 대표. 1장 이상 필수는 아님(선택)
  description: string
  /** 예약 마감: 출발 deadlineDays일 전 deadlineTime("HH:MM")까지. 출발일(회차)마다 따로 계산 */
  deadlineDays: number
  deadlineTime: string
  confirmType: ConfirmType
  /** 판매 일정(기본 일정 + 회차 + 예외). 판매 기간(saleStart~saleEnd)은 저장할 때 여기서 계산한다 */
  schedule: SaleSchedule
  cancelRules: CancelRule[]
  priceTable: PriceTable
  blocks: Block[]
}

/** 목록 한 줄 */
export type ProductRow = {
  id: string
  status: ProductStatus
  name: string
  partnerId: string
  partnerName: string
  priceFrom: number | null
  image: string | null
  createdAt: string
  /** 심사(review) 반려 사유. review→hidden일 때만 값이 있고, live가 되면 지워진다 */
  reviewRejectReason: string | null
  /** 번역 상태 (lib/server/products/translations.ts의 translationSummary). 임시저장은 번역하지 않아서 null */
  translation: TranslationSummary | null
  /** name이 보는 사람 언어의 AI 번역이면 true (원문이면 없음) */
  nameAi?: boolean
}

/** 목록의 번역 상태. none = 번역 전(빈 칸이 있는 언어가 있음 — 노출 불가), auto = 자동 번역(검수 안 한 언어가 있음), reviewed = 모든 언어 검수 완료 */
export type TranslationSummary = { state: 'none' | 'auto' | 'reviewed' }

/** 상세(수정 화면) */
export type ProductFull = ProductInput & {
  id: string
  status: ProductStatus
  partnerName: string
  createdAt: string
  reviewRejectReason: string | null
}

/** 목록에 보여줄 대표가: 첫 번째 기준 기준 가장 싼 단가. 숙박은 요금표가 아니라 객실 기본 요금(roomPricing.base)에서 찾는다 */
export function priceFrom(priceTable: PriceTable): number | null {
  if (priceTable.roomTypes.length > 0) {
    const roomPrices = Object.values(priceTable.roomPricing.base)
      .map((r) => r.price)
      .filter((p): p is number => typeof p === 'number')
    return roomPrices.length ? Math.min(...roomPrices) : null
  }
  const base = priceTable.categories[0]
  if (!base) return null
  const prices = priceTable.plans.map((p) => p.prices[base.id]).filter((p): p is number => typeof p === 'number')
  return prices.length ? Math.min(...prices) : null
}
