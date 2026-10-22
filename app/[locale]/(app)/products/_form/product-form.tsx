'use client'

// 상품 등록·수정 화면. 커밋된 설계 프로토타입(app/[locale]/products-proto, 삭제됨)의 레이아웃·문구를
// 한 글자도 바꾸지 않고 그대로 따르되, 로컬 상태만 두던 걸 실제 저장(saveProduct)·실제 사진 업로드로 바꿨다.
import { Fragment, useEffect, useState, useTransition } from 'react'
import { Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { ErrorKey } from '@/lib/errors'
import { uploadProductImage } from '@/lib/client/image-upload'
import {
  emptyRoomPricing,
  newId,
  newRoomType,
  PRODUCT_CATEGORIES,
  type Amount,
  type Block,
  type Category,
  type ChoiceItem,
  type ConfirmType,
  type Plan,
  type PriceColumn,
  type PriceGroup,
  type PriceOption,
  type ProductCategory,
  type ProductFull,
  type RoomPricing,
  type RoomType,
  AUTO_REJECT_REASON,
} from '@/lib/products/types'
import { DEFAULT_TITLES, defaultTitleKind, displayTitle } from '@/lib/products/default-titles'
import type { DraftSection, ProductDraft } from '@/lib/products/extract-map'
import type { ChangeRequestRow } from '@/lib/server/products/change-requests'
import { saleRange, type SaleSchedule } from '@/lib/products/schedule'
import { saveProduct } from '../actions'
import { CancelFees, type CancelRuleRow } from './cancel-fees'
import { RoomRateCalendar } from './room-rate-calendar'
import { SaleCalendar, emptySchedule } from './sale-calendar'
import './product-form.css'

type Partner = { id: string; name: string }
const fullDate = (s: string) => `${s.slice(0, 4)}.${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`
const pad2 = (n: number) => String(n).padStart(2, '0')

const emptyAmount = (): Amount => ({ sign: 'add', price: null })

// 새로 만드는 섹션·금액 조정표의 기본 이름. 상품 데이터로 저장되니 등록하는 사람의 화면 언어로 넣는다 (lib/products/default-titles.ts)
type DefaultNames = (typeof DEFAULT_TITLES)['ko']

function newPriceGroup(names: DefaultNames): PriceGroup {
  const col = { id: newId(), name: names.amountColumn }
  return { id: newId(), title: '', required: false, columns: [col], options: [{ id: newId(), name: '', amounts: { [col.id]: emptyAmount() } }] }
}

// 등록 화면에서 처음 만들어지는 고정 섹션(3·4번) 제목. 상품 종류(교통)에 따라 다르다 — 사용자가 직접 바꾼 제목은 덮어쓰지 않는다
function defaultBlockTitlesFor(category: ProductCategory, names: DefaultNames): [string, string] {
  if (category === 'transport') return [names.program, names.transport]
  // 기타는 제목을 직접 입력하므로 빈 값으로 시작해 placeholder가 보이게 한다
  if (category === 'other') return ['', '']
  // 숙박은 blocks[0]을 안 쓰고 blocks[1]만 "4. 숙박 정보"로 고정 표시한다
  if (category === 'lodging') return ['', names.lodging]
  return [names.itinerary, names.program]
}

// 블록(0·1)을 화면에서 완전히 숨기는 카테고리 — 2페이지 앞쪽에 전용 섹션(교통수단/프로그램/객실정보+요금)을
// 이미 따로 뒀으므로 blocks[0]은 쓰지 않고 blocks[1] 하나만 "고정 섹션"으로 보여준다
function hidesFirstFixedBlock(category: ProductCategory): boolean {
  return category === 'transport' || category === 'other' || category === 'lodging'
}

// 고정 섹션(blocks[1])의 번호. 숙박은 앞에 "2.객실 정보 3.객실 요금"을 추가로 쓰므로 이 섹션이 4번이 된다
function fixedBlockSectionNo(category: ProductCategory, i: number): number {
  if (category === 'lodging') return 4
  if ((category === 'transport' || category === 'other') && i > 0) return i + 2
  return i + 3
}

// 선택 옵션에 기본 열을 1개 둘지. 3·4번(고정 섹션)은 교통의 "성인" 안내 열 때문에 교통은 열을 유지하고 관광은 뺀다.
// 자유 추가 섹션(5번+)은 관광·교통 열 없이 행만 둔다. 숙박은 "4. 숙박 정보"가 기본(package 등)과 같은 구조라 늘 열을 둔다
function withColumnFor(blockIndex: number, category: ProductCategory): boolean {
  if (blockIndex <= 1) return category !== 'tour' && category !== 'other'
  return category !== 'tour' && category !== 'transport' && category !== 'other'
}

// 선택 옵션의 초기 상태. 관광·체험의 일정표·프로그램은 열 없이 행만 쓰므로 withColumn=false로 만든다
function pristineChoiceFields(withColumn: boolean): { choiceColumns: PriceColumn[]; choices: ChoiceItem[] } {
  if (!withColumn) return { choiceColumns: [], choices: [{ id: newId(), name: '', values: {} }] }
  const col = { id: newId(), name: '' }
  return { choiceColumns: [col], choices: [{ id: newId(), name: '', values: { [col.id]: '' } }] }
}

// 선택 옵션이 아직 사용자 손이 안 닿은 초기 상태인지 — 그럴 때만 카테고리 전환으로 열 유무를 자동으로 맞춘다
function isChoicesPristine(b: Block): boolean {
  return b.choiceColumns.every((c) => !c.name) && b.choices.every((c) => !c.name && Object.values(c.values).every((v) => !v))
}

// 섹션 하나가 아직 비어 있는지 — 상품 종류를 바꿀 때 "지워질 내용이 실제로 있는지" 묻는 데 쓴다 (제목은 기본 제목이면 빈 것으로 본다)
function isBlockPristine(b: Block): boolean {
  const titleUntouched = !b.title || defaultTitleKind(b.title) !== null
  const groupsPristine = b.priceGroups.every(
    (g) => !g.title && !g.required && g.columns.every((c) => !c.name) && g.options.every((o) => !o.name && Object.values(o.amounts).every((a) => a.price === null)),
  )
  return titleUntouched && b.images.length === 0 && !b.text.trim() && !b.choicesRequired && isChoicesPristine(b) && groupsPristine
}

// 새 상품의 취소 수수료 기본 두 줄
const defaultCancelRules = (): CancelRuleRow[] => [
  { id: newId(), daysBefore: 7, percent: 0 },
  { id: newId(), daysBefore: 3, percent: 30 },
]
const isCancelRulesDefault = (rows: CancelRuleRow[]) => {
  const base = defaultCancelRules()
  return rows.length === base.length && rows.every((r, i) => r.daysBefore === base[i].daysBefore && r.percent === base[i].percent)
}

// 판매 일정에 아직 손을 안 댄 상태인지 — emptySchedule() 그대로면 빈 것으로 본다
function isSchedulePristine(s: SaleSchedule): boolean {
  const b = s.base
  const blank = emptySchedule().base
  return (
    b.start === blank.start &&
    !b.end &&
    b.times.length === 0 &&
    b.weekdays.length === 7 &&
    b.minPeople === blank.minPeople &&
    b.maxPeople === null &&
    Object.keys(b.slotPeople).length === 0 &&
    s.exceptions.length === 0
  )
}

function newBlock(names: DefaultNames, title: string, withChoiceColumn = true): Block {
  return {
    id: newId(),
    title,
    images: [],
    text: '',
    priceGroups: [newPriceGroup(names)],
    choicesRequired: false,
    ...pristineChoiceFields(withChoiceColumn),
  }
}

// 아래 셋은 ProductForm 밖에 둔다 — 안에서 정의하면 입력할 때마다 컴포넌트가 새로 만들어져
// 표의 입력칸이 다시 그려지고 커서가 빠져서 한 글자씩밖에 안 써진다
/** 사진 고르기 버튼. 브라우저 기본 파일 칸은 "파일 선택"을 PC 언어로 보여줘서 화면 언어 버튼으로 바꿨다.
 *  <label className="proto-field"> 안에 두면 라벨 어디를 눌러도 파일 창이 열린다 */
function ImagePickButton({ onFiles }: { onFiles: (files: FileList | null) => void }) {
  const tp = useTranslations('products')
  return (
    <>
      <span className="outline-button" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
        + {tp('pickImages')}
      </span>
      <input type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </>
  )
}

/** 소개서를 올리면 Upstage 문서 AI가 읽어 요금표·취소규정을 채운다.
 *  카드 전체가 파일 고르기 버튼이다. 읽는 데 분 단위가 걸려서, 도는 동그라미와 경과 시간으로
 *  아직 살아있다는 걸 계속 보여준다 (멈춘 줄 알고 새로고침하면 결과가 날아간다) */
function AiFillCard({ onFile, busy, seconds }: { onFile: (file: File | null) => void; busy: boolean; seconds: number }) {
  const tp = useTranslations('products')
  return (
    <label className={busy ? 'ai-fill busy' : 'ai-fill'}>
      <span className="ai-fill-icon">{busy ? <span className="ai-fill-spin" aria-hidden /> : <Sparkles size={17} />}</span>
      <strong className="ai-fill-title">Upstage Document AI</strong>
      <span className="ai-fill-action" role="status" aria-live="polite">
        {busy ? `${tp('documentExtracting')} ${seconds}${tp('documentSeconds')}` : tp('pickDocument')}
      </span>
      {busy && <span className="ai-fill-bar" aria-hidden />}
      <input
        type="file"
        accept=".pdf,.hwp,.hwpx,.docx,.xlsx,.pptx,image/jpeg,image/png"
        hidden
        disabled={busy}
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null)
          e.target.value = '' // 같은 파일을 다시 고를 수 있게
        }}
      />
    </label>
  )
}

const ImageGrid = ({ images, onRemove }: { images: string[]; onRemove: (url: string) => void }) =>
  images.length > 0 ? (
    <div className="proto-thumb-row">
      {images.map((url) => (
        <div className="proto-thumb-wrap" key={url}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="proto-thumb" />
          <button type="button" className="proto-thumb-remove" onClick={() => onRemove(url)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  ) : null

const OptionEditor = ({
  columns,
  options,
  onAddOption,
  onRemoveOption,
  onRenameOption,
  onAmountChange,
  onAddColumn,
  onRemoveColumn,
  onRenameColumn,
  category,
}: {
  columns: PriceColumn[]
  options: PriceOption[]
  onAddOption: () => void
  onRemoveOption: (id: string) => void
  onRenameOption: (id: string, name: string) => void
  onAmountChange: (id: string, colId: string, patch: Partial<Amount>) => void
  onAddColumn: () => void
  onRemoveColumn: (colId: string) => void
  onRenameColumn: (colId: string, name: string) => void
  category: ProductCategory
}) => {
  const tp = useTranslations('products')
  return (
    <div className="proto-section-options">
      <p className="proto-sub-label">{tp('pkg.priceGroupsTitle')}</p>
      <div className="table-wrap">
        <table className="proto-price-table proto-ratio-table">
          <thead>
            <tr>
              <th />
              {columns.map((c) => (
                <th key={c.id}>
                  <div className="proto-cat-head">
                    <input value={c.name} onChange={(e) => onRenameColumn(c.id, e.target.value)} placeholder={category === 'transport' ? '' : tp('pkg.columnName')} />
                    {columns.length > 1 && (
                      <button type="button" className="proto-cat-remove" onClick={() => onRemoveColumn(c.id)}>
                        ✕
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="proto-add-col">
                <button type="button" className="proto-add-icon" onClick={onAddColumn} aria-label={tp('pkg.addPriceColumn')}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.id}>
                <th scope="row">
                  <input value={o.name} onChange={(e) => onRenameOption(o.id, e.target.value)} placeholder={category === 'transport' ? '' : tp('pkg.optionNamePlaceholder')} />
                </th>
                {columns.map((c) => {
                  const a = o.amounts[c.id] ?? emptyAmount()
                  return (
                    <td key={c.id} className="r">
                      <span className="proto-yen proto-yen-adjust">
                        <input
                          type="number"
                          inputMode="numeric"
                          value={a.price ?? ''}
                          onChange={(e) => onAmountChange(o.id, c.id, { price: e.target.value === '' ? null : Number(e.target.value) })}
                          placeholder={category === 'transport' ? '' : '0'}
                        />
                        <span>{tp('yenUnit')}</span>
                      </span>
                    </td>
                  )
                })}
                <td>
                  <button type="button" className="proto-remove" onClick={() => onRemoveOption(o.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">
                <button type="button" className="proto-add-icon" onClick={onAddOption} aria-label={tp('pkg.addOption')}>
                  +
                </button>
              </th>
              {columns.map((c) => (
                <td key={c.id} />
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RequiredToggle({ value, onChange }: { value: boolean; onChange: (required: boolean) => void }) {
  const tp = useTranslations('products')
  return (
    <div className="proto-sign" role="group">
      <button type="button" aria-pressed={value} onClick={() => onChange(true)}>
        {tp('optionRequired')}
      </button>
      <button type="button" aria-pressed={!value} onClick={() => onChange(false)}>
        {tp('optionOptional')}
      </button>
    </div>
  )
}

const ChoiceEditor = ({
  required,
  onRequiredChange,
  columns,
  choices,
  onAddChoice,
  onRemoveChoice,
  onRenameChoice,
  onValueChange,
  onAddColumn,
  onRemoveColumn,
  onRenameColumn,
  category,
  showTransportHints = true,
}: {
  required: boolean
  onRequiredChange: (required: boolean) => void
  columns: PriceColumn[]
  choices: ChoiceItem[]
  onAddChoice: () => void
  onRemoveChoice: (id: string) => void
  onRenameChoice: (id: string, name: string) => void
  onValueChange: (id: string, colId: string, value: string) => void
  onAddColumn: () => void
  onRemoveColumn: (colId: string) => void
  onRenameColumn: (colId: string, name: string) => void
  category: ProductCategory
  // 교통 카테고리의 "성인/페리 태고 고토/1000" 예시 안내 글씨. 3번(교통수단 수량표)에만 쓰고, 자유 추가 섹션엔 안 쓴다
  showTransportHints?: boolean
}) => {
  const tp = useTranslations('products')
  return (
    <div className="proto-section-options">
      <div className="proto-inline-row">
        <p className="proto-sub-label">{tp(category === 'transport' ? 'pkg.choicesTitleTransport' : 'pkg.choicesTitle')}</p>
        <RequiredToggle value={required} onChange={onRequiredChange} />
      </div>
      <div className="table-wrap">
        <table className="proto-price-table proto-ratio-table">
          <thead>
            <tr>
              <th>{tp('pkg.choiceName')}</th>
              {columns.map((c) => (
                <th key={c.id}>
                  <div className="proto-cat-head">
                    <input
                      value={c.name}
                      onChange={(e) => onRenameColumn(c.id, e.target.value)}
                      placeholder={category === 'transport' && showTransportHints ? tp('pkg.columnNameTransport') : category === 'transport' || category === 'tour' || category === 'other' ? '' : tp('pkg.columnName')}
                    />
                    <button type="button" className="proto-cat-remove" onClick={() => onRemoveColumn(c.id)}>
                      ✕
                    </button>
                  </div>
                </th>
              ))}
              <th className="proto-add-col">
                <button type="button" className="proto-add-icon" onClick={onAddColumn} aria-label={tp('pkg.addColumn')}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {choices.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  <input
                    value={c.name}
                    onChange={(e) => onRenameChoice(c.id, e.target.value)}
                    placeholder={category === 'transport' && showTransportHints ? tp('pkg.choiceNamePlaceholderTransport') : category === 'transport' || category === 'tour' || category === 'other' ? '' : tp('pkg.choiceNamePlaceholder')}
                  />
                </th>
                {columns.map((col) => (
                  <td key={col.id}>
                    <input
                      value={c.values[col.id] ?? ''}
                      onChange={(e) => onValueChange(c.id, col.id, e.target.value)}
                      placeholder={category === 'transport' && showTransportHints ? tp('pkg.valuePlaceholderTransport') : category === 'transport' || category === 'tour' || category === 'other' ? '' : tp('valuePlaceholder')}
                    />
                  </td>
                ))}
                <td>
                  <button type="button" className="proto-remove" onClick={() => onRemoveChoice(c.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">
                <button type="button" className="proto-add-icon" onClick={onAddChoice} aria-label={tp('pkg.addChoice')}>
                  +
                </button>
              </th>
              {columns.map((col) => (
                <td key={col.id} />
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ProductForm({
  initial,
  partners,
  readOnly = false,
  changeRequest = null,
}: {
  initial?: ProductFull
  partners: Partner[]
  readOnly?: boolean
  changeRequest?: ChangeRequestRow | null
}) {
  const t = useTranslations()
  const tp = useTranslations('products')
  const locale = useLocale()
  const defaultNames: DefaultNames = DEFAULT_TITLES[locale as keyof typeof DEFAULT_TITLES] ?? DEFAULT_TITLES.ko
  const changeRequestLabel = (req: ChangeRequestRow) => {
    if (req.type === 'edit') return tp('changeRequest.labelEdit')
    if (req.type === 'delete') return tp('changeRequest.labelDelete')
    return tp(req.targetStatus === 'live' ? 'changeRequest.labelShow' : 'changeRequest.labelHide')
  }
  const router = useRouter()
  const [saving, startSaving] = useTransition()
  const [error, setError] = useState<ErrorKey | null>(null)
  const [page, setPage] = useState(0) // 0=기본정보, 1=요금표·기본 섹션(일정표·체험프로그램), 2=추가 옵션 섹션+등록

  const [partnerId, setPartnerId] = useState(initial?.partnerId ?? partners[0]?.id ?? '')
  const [category, setCategory] = useState<ProductCategory>(initial?.category ?? 'tour')
  const [name, setName] = useState(initial?.name ?? '')
  const [mainImages, setMainImages] = useState<string[]>(initial?.images ?? [])
  const [description, setDescription] = useState(initial?.description ?? '')

  const [categories, setCategories] = useState<Category[]>(initial?.priceTable.categories ?? [{ id: newId(), name: '' }])
  const [plans, setPlans] = useState<Plan[]>(initial?.priceTable.plans ?? [{ id: newId(), name: '', prices: {} }])
  const [priceImages, setPriceImages] = useState<string[]>(initial?.priceTable.priceImages ?? [])
  const [priceText, setPriceText] = useState(initial?.priceTable.priceText ?? '')
  // 기타는 더 이상 제목을 직접 입력받지 않는다 — 기존에 저장된 값이 있으면 그대로 돌려보낸다
  const priceTableLabel = initial?.priceTable.title ?? ''
  const [roomTypes, setRoomTypes] = useState<RoomType[]>(initial?.priceTable.roomTypes ?? [newRoomType()])
  const [roomPricing, setRoomPricing] = useState<RoomPricing>(initial?.priceTable.roomPricing ?? emptyRoomPricing())
  // 등록된(기존) 상품은 객실 정보가 이미 저장돼 있으니 바로 3번 달력을 보여주고, 새로 등록할 때만 "저장" 버튼을 눌러야 열린다
  const [roomInfoSaved, setRoomInfoSaved] = useState(!!initial)

  // 앞 2개(일정표·프로그램)는 2페이지에 고정으로 뜨고, 3번째부터는 3페이지(옵션 추가)에 뜬다 —
  // 3페이지도 처음부터 빈 화면이 아니라 기본 섹션 하나는 채워서 보여준다.
  // 예전 상품은 구조 변경 마이그레이션 백필로 blocks가 비어있거나 2개 미만일 수 있다 — 있는 건 보존하고 부족한 자리(일정표·프로그램)만 채운다
  const [blocks, setBlocks] = useState<Block[]>(() => {
    const existing = initial?.blocks ?? []
    const [title3, title4] = defaultBlockTitlesFor(category, defaultNames)
    if (existing.length === 0) {
      return [
        newBlock(defaultNames, title3, withColumnFor(0, category)),
        newBlock(defaultNames, title4, withColumnFor(1, category)),
        newBlock(defaultNames, '', withColumnFor(2, category)),
      ]
    }
    if (existing.length === 1) return [...existing, newBlock(defaultNames, title4, withColumnFor(1, category))]
    return existing
  })

  // 2페이지(요금표 옆)에 뜨는 앞쪽 섹션 수. 처음엔 일정표·프로그램 2개 — 프로그램을 지우면 1개가 되고,
  // 3페이지 섹션이 그 자리로 당겨 올라오지 않는다 (안 그러면 삭제를 한 번 더 눌러야 사라진 것처럼 보인다)
  const [fixedCount, setFixedCount] = useState(2)

  // 판매 일정: 저장된 게 없으면(기본 일정 시작일이 비어 있으면) 오늘부터 시작하는 빈 일정
  const [schedule, setSchedule] = useState<SaleSchedule>(() => (initial?.schedule.base.start ? initial.schedule : emptySchedule()))
  const range = saleRange(schedule)
  // 예약 마감: 출발 deadlineDays일 전 deadlineHour:deadlineMinute까지 (출발일마다 따로 계산)
  const [deadlineDays, setDeadlineDays] = useState(initial?.deadlineDays ?? 1)
  const [deadlineHour, setDeadlineHour] = useState(Number(initial?.deadlineTime.slice(0, 2) ?? 17))
  const [deadlineMinute, setDeadlineMinute] = useState(Number(initial?.deadlineTime.slice(3, 5) ?? 0))
  const [confirmType, setConfirmType] = useState<ConfirmType>(initial?.confirmType ?? 'instant')
  const [cancelRules, setCancelRules] = useState<CancelRuleRow[]>(initial?.cancelRules.map((r) => ({ ...r, id: newId() })) ?? defaultCancelRules())

  const [uploading, setUploading] = useState(0) // 올리는 중인 파일 수 (여러 칸에서 동시에 올릴 수 있어 합산만 한다)
  const [extracting, setExtracting] = useState(false) // 소개서를 읽는 중 (분 단위가 걸린다)
  const [extractSeconds, setExtractSeconds] = useState(0) // 읽기 시작한 뒤 흐른 초 — 멈춘 게 아니라는 표시
  const [filled, setFilled] = useState<{ plans: number; rules: number; sections: number; sample: boolean } | null>(null) // 소개서로 채운 결과
  // 소개서 읽기 실패. error와 따로 두는 이유는 그쪽이 1페이지에서 그려지지 않아 조용히 묻히기 때문이다
  const [docError, setDocError] = useState<string | null>(null)

  useEffect(() => {
    if (!extracting) return
    setExtractSeconds(0)
    const timer = setInterval(() => setExtractSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [extracting])

  // 상품 종류를 바꾸면 등록하던 내용을 통째로 버리고 빈 화면에서 다시 시작한다 —
  // 종류마다 입력 칸의 뜻이 달라서(요금표 ↔ 객실, 섹션 번호·제목) 남은 값이 엉뚱한 자리에 들어가기 때문
  function resetForm() {
    setPartnerId(partners[0]?.id ?? '')
    setName('')
    setMainImages([])
    setDescription('')
    setSchedule(emptySchedule())
    setDeadlineDays(1)
    setDeadlineHour(17)
    setDeadlineMinute(0)
    setConfirmType('instant')
    setCancelRules(defaultCancelRules())
    setCategories([{ id: newId(), name: '' }])
    setPlans([{ id: newId(), name: '', prices: {} }])
    setPriceImages([])
    setPriceText('')
    setRoomTypes([newRoomType()])
    setRoomPricing(emptyRoomPricing())
    setRoomInfoSaved(false)
    setFixedCount(2)
    setDraftSavedAt(null)
    setError(null)
  }

  // 새 종류에 맞는 빈 섹션으로 다시 만든다 (제목·선택 옵션 열이 종류마다 다르다)
  function resetBlocksFor(next: ProductCategory) {
    const [title3, title4] = defaultBlockTitlesFor(next, defaultNames)
    setBlocks([
      newBlock(defaultNames, title3, withColumnFor(0, next)),
      newBlock(defaultNames, title4, withColumnFor(1, next)),
      newBlock(defaultNames, '', withColumnFor(2, next)),
    ])
  }

  // 지워질 게 실제로 있는지 — 아무것도 안 썼으면 묻지 않고 바로 바뀐다
  const formFilled =
    partnerId !== (partners[0]?.id ?? '') ||
    name.trim() !== '' ||
    mainImages.length > 0 ||
    description.trim() !== '' ||
    !isSchedulePristine(schedule) ||
    deadlineDays !== 1 ||
    deadlineHour !== 17 ||
    deadlineMinute !== 0 ||
    confirmType !== 'instant' ||
    !isCancelRulesDefault(cancelRules) ||
    categories.length > 1 ||
    categories.some((c) => c.name.trim() !== '') ||
    plans.length > 1 ||
    plans.some((p) => p.name.trim() !== '' || Object.values(p.prices).some((v) => v !== null)) ||
    priceImages.length > 0 ||
    priceText.trim() !== '' ||
    roomTypes.length > 1 ||
    roomTypes.some((r) => r.name.trim() !== '' || r.standardPeople !== null || r.maxPeople !== null || r.roomCount !== null) ||
    Object.values(roomPricing.base).some((r) => r.price !== null || r.count !== null) ||
    roomPricing.exceptions.length > 0 ||
    blocks.some((b) => !isBlockPristine(b))

  // 요금표에 쓴 게 있는지 — 소개서로 덮어쓰기 전에 물어볼지 판단한다
  const priceFilled =
    categories.some((c) => c.name.trim() !== '') ||
    plans.some((p) => p.name.trim() !== '' || Object.values(p.prices).some((v) => v !== null))

  /** 뽑아낸 상세 섹션을 화면에 이미 있는 같은 종류의 빈 칸에만 넣는다.
   *  섹션을 새로 만들지 않는다 — 문서 소제목마다 칸이 늘어나면 상품 설명과 겹치는 글이 쌓인다.
   *  사람이 이미 쓴 글도 덮어쓰지 않는다 */
  function fillSections(sections: DraftSection[]) {
    setBlocks((current) => {
      const next = [...current]
      for (const s of sections) {
        const i = next.findIndex((b) => !b.text.trim() && defaultTitleKind(b.title) === s.kind)
        if (i >= 0) next[i] = { ...next[i], text: s.text }
      }
      return next
    })
  }

  // 소개서를 읽어 요금표·취소규정을 채운다. 사람이 고치는 걸 전제로 한 초안이라 그대로 저장하지 않는다
  async function applyDocument(file: File | null) {
    if (!file) return
    if (priceFilled && !window.confirm(tp('documentOverwriteConfirm'))) return
    setExtracting(true)
    setError(null)
    setFilled(null)
    setDocError(null)
    // 읽기가 아주 빨리 끝나도(로컬 샘플) 표시가 번쩍이고 사라지지 않게 최소 시간을 둔다
    const shown = new Promise((r) => setTimeout(r, 600))
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/products/extract', { method: 'POST', body })
      await shown
      if (!res.ok) {
        // 서버가 무엇이 문제인지 적어 보낸다(파일 형식·페이지 수·일시적 실패). 그대로 보여준다
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setDocError(typeof body?.error === 'string' && body.error ? body.error : t('errors.productDocument'))
        return
      }
      const { draft, sample } = (await res.json()) as { draft: ProductDraft; sample?: boolean }
      // 못 찾은 칸은 비우지 않고 그대로 둔다 — 쓰던 내용을 빈 값으로 지우지 않으려고
      if (draft.name) setName(draft.name)
      if (draft.description) setDescription(draft.description)
      if (draft.priceTable.plans.length) {
        setCategories(draft.priceTable.categories)
        setPlans(draft.priceTable.plans)
      }
      if (draft.priceTable.priceText) setPriceText(draft.priceTable.priceText)
      if (draft.cancelRules.length) setCancelRules(draft.cancelRules.map((r) => ({ ...r, id: newId() })))
      if (draft.sections.length) fillSections(draft.sections)
      // 채운 자리가 요금표(2페이지)에 몰려 있어, 뭐가 들어갔는지 알려주지 않으면 아무 일도 안 한 것처럼 보인다
      setFilled({ plans: draft.priceTable.plans.length, rules: draft.cancelRules.length, sections: draft.sections.length, sample: !!sample })
    } catch {
      setDocError(t('errors.productDocument'))
    } finally {
      setExtracting(false)
    }
  }

  async function uploadMany(files: FileList | null, onDone: (urls: string[]) => void) {
    if (!files?.length) return
    setUploading((n) => n + files.length)
    const urls: string[] = []
    for (const file of Array.from(files)) {
      try {
        urls.push(await uploadProductImage(file))
      } catch {
        setError('productImage')
      }
    }
    setUploading((n) => n - files.length)
    if (urls.length) onDone(urls)
  }

  const addMainImages = (files: FileList | null) => uploadMany(files, (urls) => setMainImages((m) => [...m, ...urls]))
  const removeMainImage = (url: string) => setMainImages((m) => m.filter((u) => u !== url))

  const addPriceImages = (files: FileList | null) => uploadMany(files, (urls) => setPriceImages((m) => [...m, ...urls]))
  const removePriceImage = (url: string) => setPriceImages((m) => m.filter((u) => u !== url))

  const addCategory = () => {
    const cat = { id: newId(), name: '' }
    setCategories((c) => [...c, cat])
    setPlans((ps) => ps.map((p) => ({ ...p, prices: { ...p.prices, [cat.id]: null } })))
  }
  const removeCategory = (id: string) => {
    if (categories.length <= 1) return
    setCategories((c) => c.filter((x) => x.id !== id))
    setPlans((ps) =>
      ps.map((p) => {
        const { [id]: _drop, ...rest } = p.prices
        return { ...p, prices: rest }
      }),
    )
  }
  const renameCategory = (id: string, value: string) => setCategories((c) => c.map((x) => (x.id === id ? { ...x, name: value } : x)))

  const addPlan = () => setPlans((p) => [...p, { id: newId(), name: '', prices: {} }])
  const removePlan = (id: string) => {
    if (plans.length <= 1) return
    setPlans((p) => p.filter((x) => x.id !== id))
  }
  const renamePlan = (id: string, value: string) => setPlans((p) => p.map((x) => (x.id === id ? { ...x, name: value } : x)))
  const setPlanPrice = (planId: string, catId: string, value: string) => {
    const num = value === '' ? null : Number(value)
    setPlans((p) => p.map((x) => (x.id === planId ? { ...x, prices: { ...x.prices, [catId]: num } } : x)))
  }

  // 숙박 "2. 객실 정보" — 행(객실 타입) 추가·삭제·수정. 열(기준·최대 인원, 판매 객실 수)은 고정이라 추가/삭제가 없다
  const addRoomType = () => setRoomTypes((r) => [...r, newRoomType()])
  const removeRoomType = (id: string) => {
    if (roomTypes.length <= 1) return
    setRoomTypes((r) => r.filter((x) => x.id !== id))
    setRoomPricing((p) => {
      const dropBase = { ...p.base }
      delete dropBase[id]
      return { base: dropBase, exceptions: p.exceptions.map((e) => { const rates = { ...e.rates }; delete rates[id]; return { ...e, rates } }) }
    })
  }
  const setRoomTypeField = (id: string, patch: Partial<RoomType>) => setRoomTypes((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const addBlock = () => setBlocks((b) => [...b, newBlock(defaultNames, '', withColumnFor(2, category))])
  const removeBlock = (id: string) => {
    if (blocks.slice(0, fixedCount).some((x) => x.id === id)) setFixedCount((n) => n - 1)
    setBlocks((b) => b.filter((x) => x.id !== id))
  }
  const setBlockField = (id: string, patch: Partial<Block>) => setBlocks((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const addBlockImages = (id: string, files: FileList | null) =>
    uploadMany(files, (urls) => setBlocks((b) => b.map((x) => (x.id === id ? { ...x, images: [...x.images, ...urls] } : x))))
  const removeBlockImage = (blockId: string, url: string) =>
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, images: x.images.filter((u) => u !== url) } : x)))

  // 블록 안의 특정 금액 조정표(priceGroup) 하나만 바꾸는 헬퍼
  const updateGroup = (blockId: string, groupId: string, fn: (g: PriceGroup) => PriceGroup) =>
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, priceGroups: x.priceGroups.map((g) => (g.id === groupId ? fn(g) : g)) } : x)))

  const addPriceGroup = (blockId: string) => setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, priceGroups: [...x.priceGroups, newPriceGroup(defaultNames)] } : x)))
  const removePriceGroup = (blockId: string, groupId: string) =>
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, priceGroups: x.priceGroups.filter((g) => g.id !== groupId) } : x)))
  const renamePriceGroup = (blockId: string, groupId: string, title: string) => updateGroup(blockId, groupId, (g) => ({ ...g, title }))
  const setPriceGroupRequired = (blockId: string, groupId: string, required: boolean) => updateGroup(blockId, groupId, (g) => ({ ...g, required }))

  const addGroupOption = (blockId: string, groupId: string) =>
    updateGroup(blockId, groupId, (g) => ({ ...g, options: [...g.options, { id: newId(), name: '', amounts: Object.fromEntries(g.columns.map((c) => [c.id, emptyAmount()])) }] }))
  const removeGroupOption = (blockId: string, groupId: string, optId: string) =>
    updateGroup(blockId, groupId, (g) => ({ ...g, options: g.options.filter((o) => o.id !== optId) }))
  const renameGroupOption = (blockId: string, groupId: string, optId: string, name: string) =>
    updateGroup(blockId, groupId, (g) => ({ ...g, options: g.options.map((o) => (o.id === optId ? { ...o, name } : o)) }))
  const setGroupOptionAmount = (blockId: string, groupId: string, optId: string, colId: string, patch: Partial<Amount>) =>
    updateGroup(blockId, groupId, (g) => ({
      ...g,
      options: g.options.map((o) => (o.id === optId ? { ...o, amounts: { ...o.amounts, [colId]: { ...(o.amounts[colId] ?? emptyAmount()), ...patch } } } : o)),
    }))

  const addGroupColumn = (blockId: string, groupId: string) => {
    const colId = newId()
    updateGroup(blockId, groupId, (g) => ({
      ...g,
      columns: [...g.columns, { id: colId, name: '' }],
      options: g.options.map((o) => ({ ...o, amounts: { ...o.amounts, [colId]: emptyAmount() } })),
    }))
  }
  const removeGroupColumn = (blockId: string, groupId: string, colId: string) =>
    updateGroup(blockId, groupId, (g) => {
      if (g.columns.length <= 1) return g
      return {
        ...g,
        columns: g.columns.filter((c) => c.id !== colId),
        options: g.options.map((o) => {
          const { [colId]: _drop, ...rest } = o.amounts
          return { ...o, amounts: rest }
        }),
      }
    })
  const renameGroupColumn = (blockId: string, groupId: string, colId: string, name: string) =>
    updateGroup(blockId, groupId, (g) => ({ ...g, columns: g.columns.map((c) => (c.id === colId ? { ...c, name } : c)) }))

  const addBlockChoice = (blockId: string) =>
    setBlocks((b) =>
      b.map((x) =>
        x.id === blockId ? { ...x, choices: [...x.choices, { id: newId(), name: '', values: Object.fromEntries(x.choiceColumns.map((c) => [c.id, ''])) }] } : x,
      ),
    )
  const removeBlockChoice = (blockId: string, choiceId: string) =>
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, choices: x.choices.filter((c) => c.id !== choiceId) } : x)))
  const renameBlockChoice = (blockId: string, choiceId: string, name: string) =>
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, choices: x.choices.map((c) => (c.id === choiceId ? { ...c, name } : c)) } : x)))
  const setChoiceValue = (blockId: string, choiceId: string, colId: string, value: string) =>
    setBlocks((b) =>
      b.map((x) =>
        x.id === blockId ? { ...x, choices: x.choices.map((c) => (c.id === choiceId ? { ...c, values: { ...c.values, [colId]: value } } : c)) } : x,
      ),
    )

  const addChoiceColumn = (blockId: string) => {
    const colId = newId()
    setBlocks((b) =>
      b.map((x) =>
        x.id === blockId
          ? { ...x, choiceColumns: [...x.choiceColumns, { id: colId, name: '' }], choices: x.choices.map((c) => ({ ...c, values: { ...c.values, [colId]: '' } })) }
          : x,
      ),
    )
  }
  const removeChoiceColumn = (blockId: string, colId: string) =>
    setBlocks((b) =>
      b.map((x) => {
        if (x.id !== blockId) return x
        return {
          ...x,
          choiceColumns: x.choiceColumns.filter((c) => c.id !== colId),
          choices: x.choices.map((c) => {
            const { [colId]: _drop, ...rest } = c.values
            return { ...c, values: rest }
          }),
        }
      }),
    )
  const renameChoiceColumn = (blockId: string, colId: string, name: string) =>
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, choiceColumns: x.choiceColumns.map((c) => (c.id === colId ? { ...c, name } : c)) } : x)))

  const nameFilled = name.trim() !== ''
  const hasPrice =
    category === 'lodging'
      ? Object.values(roomPricing.base).some((r) => typeof r.price === 'number')
      : plans.some((p) => Object.values(p.prices).some((v) => typeof v === 'number'))
  // 첫 번째로 화면에 보이는 고정 섹션 — 사진 또는 텍스트 중 하나는 있어야 한다.
  // 교통·기타·숙박은 blocks[0]을 화면에서 숨기고 blocks[1]만 고정 섹션으로 보여주므로 그걸 본다
  const itineraryBlock = category === 'transport' || category === 'other' || category === 'lodging' ? blocks[1] : blocks[0]
  const itineraryFilled = (itineraryBlock?.images.length ?? 0) > 0 || (itineraryBlock?.text.trim() ?? '') !== ''
  const canSubmit = nameFilled && hasPrice && itineraryFilled

  // 임시저장: 새 상품이거나 아직 임시저장인 상품만. 처음 임시저장하면 id를 받아 두고 이후 저장은 그 상품을 고친다
  const canDraft = !initial || initial.status === 'draft'
  const [draftId, setDraftId] = useState(initial?.status === 'draft' ? initial.id : undefined)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)

  function handleSave(asDraft = false) {
    setError(null)
    startSaving(async () => {
      const input = {
        partnerId,
        category,
        name,
        images: mainImages,
        description,
        deadlineDays,
        deadlineTime: `${pad2(deadlineHour)}:${pad2(deadlineMinute)}`,
        confirmType,
        schedule,
        cancelRules: cancelRules.map(({ id: _id, ...r }) => r),
        priceTable: { categories, plans, priceImages, priceText, title: priceTableLabel, roomTypes, roomPricing },
        blocks,
      }
      const result = await saveProduct(input, initial?.id ?? draftId, asDraft)
      if (result.error) setError(result.error)
      else if (asDraft) {
        if (result.id) setDraftId(result.id)
        const now = new Date()
        setDraftSavedAt(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`)
      } else router.push('/products')
    })
  }

  const priceTableTitle =
    category === 'tour'
      ? tp('priceTableTitleTour')
      : category === 'transport'
        ? tp('priceTableTitleTransport')
        : category === 'other'
          ? tp('priceTableTitleOther')
          : tp('priceTableTitle')

  return (
    <div className="proto-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">{initial ? 'EDIT PRODUCT' : 'NEW PRODUCT'}</p>
          <h1>{initial ? t('page.products.editTitle') : t('page.products.newTitle')}</h1>
          {initial && (
            <p className="heading-sub">
              {initial.partnerName} · {tp(`status.${initial.status}`)}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="outline-button" onClick={() => router.push('/products')}>
            {tp('backToList')}
          </button>
        </div>
      </section>

      {!initial ? (
        <div className="proto-field proto-category-field">
          <span>{tp('categoryLabel')}</span>
          <div className="proto-sign proto-sign-lg" role="group" aria-label={tp('categoryLabel')}>
            {PRODUCT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => {
                  if (c === category) return
                  if (formFilled && !window.confirm(tp('categoryChangeConfirm'))) return
                  resetForm()
                  resetBlocksFor(c)
                  setCategory(c)
                  setPage(0)
                }}
              >
                {tp(`category.${c}`)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // 종류는 등록 후 못 바꾼다 — 등록 화면과 같은 모양으로 고른 종류 하나만 보여준다
        <div className="proto-field proto-category-field">
          <span>{tp('categoryLabel')}</span>
          <div className="proto-sign proto-sign-lg">
            <button type="button" aria-pressed="true" style={{ cursor: 'default' }}>
              {tp(`category.${initial.category}`)}
            </button>
          </div>
        </div>
      )}

      {/* 소개서로 요금표·취소규정을 채운다. 종류를 바꾸면 입력이 초기화되므로 종류 바로 아래에 둔다 */}
      {!initial && !readOnly && <AiFillCard onFile={applyDocument} busy={extracting} seconds={extractSeconds} />}
      {docError && <p className="ai-fill-sample">{docError}</p>}
      {filled && (
        <p className={filled.sample ? 'ai-fill-sample' : 'ai-fill-done'}>
          {filled.sample ? tp('documentSample') : tp('documentFilled', { plans: filled.plans, rules: filled.rules, sections: filled.sections })}
        </p>
      )}

      {changeRequest?.status === 'pending' && (
        <div className="change-request-banner pending">{tp('changeRequest.pendingBanner', { label: changeRequestLabel(changeRequest) })}</div>
      )}
      {changeRequest?.status === 'rejected' && (
        <div className="change-request-banner rejected">
          {tp('changeRequest.rejectedBanner', { label: changeRequestLabel(changeRequest), reason: changeRequest.rejectReason === AUTO_REJECT_REASON ? tp('changeRequest.autoRejectReason') : (changeRequest.rejectReason ?? '') })}
        </div>
      )}
      {initial?.status === 'hidden' && initial?.reviewRejectReason && (
        <div className="change-request-banner rejected">{tp('reviewRejectedBanner', { reason: initial.reviewRejectReason })}</div>
      )}

      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
      {page === 0 && (
      <div className="proto-two-col">
        <div className="proto-card">
          <div className="proto-section-head">
            <span className="proto-no">1</span>
            <h3>{tp('basicInfoTitle')}</h3>
          </div>
          {/* 수정 때는 업체를 못 바꾼다 (서버도 무시) — 지난 예약·정산이 새 업체로 넘어가지 않게 */}
          {!initial && !draftId && partners.length > 1 ? (
            <label className="proto-field">
              <span>{tp('partner')}</span>
              <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="proto-hint">
              {tp('partner')}: <b>{initial?.partnerName ?? partners[0]?.name}</b>
            </p>
          )}
          <label className="proto-field">
            <span>{tp('name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="proto-field">
            <span>{tp('mainImagesLabel')} {tp('multiHint')}</span>
            <ImagePickButton onFiles={(files) => addMainImages(files)} />
          </label>
          <ImageGrid images={mainImages} onRemove={removeMainImage} />
          <label className="proto-field">
            <span>{tp('descriptionLabel')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              placeholder={category === 'tour' ? tp('tourDescriptionGuide') : undefined}
            />
          </label>
        </div>

        <div className="proto-card">
          <div className="proto-section-head">
            <h3>{tp('saleConditionsTitle')}</h3>
          </div>
          <div className="proto-field">
            <span>{tp('deadlineLabel')}</span>
            <span className="proto-range proto-deadline">
              {tp('deadlineSentence.prefix')}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(Math.max(0, Number(e.target.value) || 0))}
                aria-label={tp('daysBeforeAriaLabel')}
              />
              {tp('deadlineSentence.mid')}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={23}
                value={deadlineHour}
                onChange={(e) => setDeadlineHour(Math.min(23, Math.max(0, Number(e.target.value) || 0)))}
                aria-label={tp('deadlineHourAriaLabel')}
              />
              :
              <select value={deadlineMinute} onChange={(e) => setDeadlineMinute(Number(e.target.value))} aria-label={tp('deadlineMinuteAriaLabel')}>
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{pad2(m)}</option>
                ))}
              </select>
              {tp('deadlineSentence.suffix')}
            </span>
          </div>
          <label className="proto-field">
            <span>{tp('confirmType')}</span>
            <div className="proto-sign" role="group" aria-label={tp('confirmType')}>
              <button type="button" aria-pressed={confirmType === 'instant'} onClick={() => setConfirmType('instant')}>
                {tp('confirm.instant')}
              </button>
              <button type="button" aria-pressed={confirmType === 'quote'} onClick={() => setConfirmType('quote')}>
                {tp('confirm.quote')}
              </button>
            </div>
          </label>
          <div className="proto-field">
            <span className="proto-label-row">
              {confirmType === 'instant' ? tp('scheduleWithPeopleTitle') : tp('scheduleTitle')}
              <em>{tp('salePeriod')} {range ? `${fullDate(range[0])} ~ ${fullDate(range[1])}` : tp('none')}</em>
            </span>
            <SaleCalendar value={schedule} onChange={setSchedule} mode={confirmType} hideCapacitySteps={category === 'lodging'} />
          </div>
          <div className="proto-field">
            <span>{tp('cancelPolicy')}</span>
            <CancelFees value={cancelRules} onChange={setCancelRules} />
          </div>
        </div>
      </div>
      )}

      {page === 1 && (
      <div className="proto-two-col">
        {category === 'lodging' ? (
          <>
            <div className="proto-card">
              <div className="proto-section-head">
                <span className="proto-no">2</span>
                <h3>{tp('pkg.roomInfoTitle')}</h3>
              </div>
              <div className="table-wrap">
                <table className="proto-price-table proto-ratio-table proto-room-table">
                  <thead>
                    <tr>
                      <th />
                      <th>{tp('pkg.roomStandardPeople')}</th>
                      <th>{tp('pkg.roomMaxPeople')}</th>
                      <th>{tp('pkg.roomCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roomTypes.map((rt) => (
                      <tr key={rt.id}>
                        <th scope="row">
                          <div className="proto-cat-head">
                            <input value={rt.name} onChange={(e) => setRoomTypeField(rt.id, { name: e.target.value })} placeholder={tp('pkg.roomTypeNamePlaceholder')} />
                            {roomTypes.length > 1 && (
                              <button type="button" className="proto-cat-remove" onClick={() => removeRoomType(rt.id)}>
                                ✕
                              </button>
                            )}
                          </div>
                        </th>
                        <td>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={rt.standardPeople ?? ''}
                            onChange={(e) => setRoomTypeField(rt.id, { standardPeople: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={rt.maxPeople ?? ''}
                            onChange={(e) => setRoomTypeField(rt.id, { maxPeople: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={rt.roomCount ?? ''}
                            onChange={(e) => setRoomTypeField(rt.id, { roomCount: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <th scope="row">
                        <button type="button" className="proto-add-icon" onClick={addRoomType} aria-label={tp('pkg.addRoomType')}>
                          +
                        </button>
                      </th>
                      <td /><td /><td />
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="proto-inline-row">
                {roomInfoSaved ? (
                  <span className="proto-hint">{tp('pkg.roomInfoSavedHint')}</span>
                ) : (
                  <button type="button" className="primary-button" onClick={() => setRoomInfoSaved(true)}>
                    {tp('pkg.saveRoomInfo')}
                  </button>
                )}
              </div>
            </div>

            <div className="proto-card">
              <div className="proto-section-head">
                <span className="proto-no">3</span>
                <h3>{tp('pkg.roomRateTitle')}</h3>
              </div>
              {roomInfoSaved ? (
                <RoomRateCalendar roomTypes={roomTypes.filter((rt) => rt.name.trim() !== '')} value={roomPricing} onChange={setRoomPricing} />
              ) : (
                <p className="proto-hint">{tp('pkg.roomInfoSaveFirstHint')}</p>
              )}
            </div>
          </>
        ) : (
        <>
        <div className="proto-card">
          <div className="proto-section-head">
            <span className="proto-no">2</span>
            <h3>{priceTableTitle}</h3>
          </div>
          <label className="proto-field">
            <span>{tp('pkg.priceNoteImages')} {tp('multiHint')}</span>
            <ImagePickButton onFiles={(files) => addPriceImages(files)} />
          </label>
          <ImageGrid images={priceImages} onRemove={removePriceImage} />
          <label className="proto-field">
            <span>{tp('pkg.priceNoteText')}</span>
            <textarea value={priceText} onChange={(e) => setPriceText(e.target.value)} rows={4} />
          </label>
        </div>

        <div className="proto-card">
          <div className="proto-section-head">
            <span className="proto-no">2</span>
            <h3>{priceTableTitle}</h3>
          </div>
          <div className="table-wrap">
            <table className="proto-price-table proto-ratio-table">
              <thead>
                <tr>
                  <th />
                  {categories.map((c) => (
                    <th key={c.id}>
                      <div className="proto-cat-head">
                        <input value={c.name} onChange={(e) => renameCategory(c.id, e.target.value)} placeholder={tp('categoryNameFieldPlaceholder')} />
                        {categories.length > 1 && (
                          <button type="button" className="proto-cat-remove" onClick={() => removeCategory(c.id)}>
                            ✕
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="proto-add-col">
                    <button type="button" className="proto-add-icon" onClick={addCategory} aria-label={tp('addCategory')}>
                      +
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <input value={p.name} onChange={(e) => renamePlan(p.id, e.target.value)} placeholder={tp('planNameFieldPlaceholder')} />
                    </th>
                    {categories.map((c) => (
                      <td key={c.id} className="r">
                        <span className="proto-yen">
                          <input type="number" inputMode="numeric" value={p.prices[c.id] ?? ''} onChange={(e) => setPlanPrice(p.id, c.id, e.target.value)} placeholder="0" />
                          <span>{tp('yenUnit')}</span>
                        </span>
                      </td>
                    ))}
                    <td>{plans.length > 1 && (
                      <button type="button" className="proto-remove" onClick={() => removePlan(p.id)}>
                        ✕
                      </button>
                    )}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">
                    <button type="button" className="proto-add-icon" onClick={addPlan} aria-label={tp('plan.add')}>
                      +
                    </button>
                  </th>
                  {categories.map((c) => (
                    <td key={c.id} />
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {(category === 'transport' || category === 'tour' || category === 'other') && blocks[0] && (
            <>
              {blocks[0].priceGroups.map((g, gi) => (
                <div className="proto-price-group" key={g.id}>
                  <div className="proto-inline-row">
                    <input
                      className="proto-section-title"
                      value={g.title}
                      onChange={(e) => renamePriceGroup(blocks[0].id, g.id, e.target.value)}
                      placeholder={blocks[0].priceGroups.length > 1 ? tp('pkg.groupTitlePlaceholderN', { n: gi + 1 }) : tp('pkg.groupTitlePlaceholder')}
                    />
                    <RequiredToggle value={g.required} onChange={(required) => setPriceGroupRequired(blocks[0].id, g.id, required)} />
                    {blocks[0].priceGroups.length > 1 && (
                      <button type="button" className="proto-remove" onClick={() => removePriceGroup(blocks[0].id, g.id)}>
                        ✕ {tp('pkg.removeGroup')}
                      </button>
                    )}
                  </div>
                  <OptionEditor
                    columns={g.columns}
                    options={g.options}
                    onAddOption={() => addGroupOption(blocks[0].id, g.id)}
                    onRemoveOption={(optId) => removeGroupOption(blocks[0].id, g.id, optId)}
                    onRenameOption={(optId, name) => renameGroupOption(blocks[0].id, g.id, optId, name)}
                    onAmountChange={(optId, colId, patch) => setGroupOptionAmount(blocks[0].id, g.id, optId, colId, patch)}
                    onAddColumn={() => addGroupColumn(blocks[0].id, g.id)}
                    onRemoveColumn={(colId) => removeGroupColumn(blocks[0].id, g.id, colId)}
                    onRenameColumn={(colId, name) => renameGroupColumn(blocks[0].id, g.id, colId, name)}
                    category={category}
                  />
                </div>
              ))}
              <button type="button" className="proto-add proto-add-small" onClick={() => addPriceGroup(blocks[0].id)}>
                + {tp('pkg.addGroup')}
              </button>
            </>
          )}
        </div>
        </>
        )}

        {blocks.slice(0, fixedCount).map((b, i) => {
          const sectionNo = fixedBlockSectionNo(category, i)
          return !(hidesFirstFixedBlock(category) && i === 0) && (
          <Fragment key={b.id}>
            <div className="proto-card">
              <div className="proto-section-head">
                <span className="proto-no">{sectionNo}</span>
                <h3>{category === 'other' ? tp('pkg.sectionTitlePlaceholder') : displayTitle(b.title, locale)}</h3>
              </div>
              <label className="proto-field">
                <span>{tp('pkg.blockImages')} {tp('multiHint')}</span>
                <ImagePickButton onFiles={(files) => addBlockImages(b.id, files)} />
              </label>
              <ImageGrid images={b.images} onRemove={(url) => removeBlockImage(b.id, url)} />
              <label className="proto-field">
                <span>{tp('pkg.blockText')}</span>
                <textarea value={b.text} onChange={(e) => setBlockField(b.id, { text: e.target.value })} rows={4} />
              </label>
            </div>
            <div className="proto-card">
              <div className="proto-section-head">
                <span className="proto-no">{sectionNo}</span>
                <h3>{category === 'transport' ? tp('pkg.transportQuantityTitle') : category === 'other' ? tp('pkg.sectionTitlePlaceholder') : displayTitle(b.title, locale) || tp('sectionFallback')}</h3>
              </div>
              {category !== 'transport' && category !== 'tour' && category !== 'other' && (
                  <>
                    {b.priceGroups.map((g, gi) => (
                      <div className="proto-price-group" key={g.id}>
                        <div className="proto-inline-row">
                          <input
                            className="proto-section-title"
                            value={g.title}
                            onChange={(e) => renamePriceGroup(b.id, g.id, e.target.value)}
                            placeholder={b.priceGroups.length > 1 ? tp('pkg.groupTitlePlaceholderN', { n: gi + 1 }) : tp('pkg.groupTitlePlaceholder')}
                          />
                          <RequiredToggle value={g.required} onChange={(required) => setPriceGroupRequired(b.id, g.id, required)} />
                          {b.priceGroups.length > 1 && (
                            <button type="button" className="proto-remove" onClick={() => removePriceGroup(b.id, g.id)}>
                              ✕ {tp('pkg.removeGroup')}
                            </button>
                          )}
                        </div>
                        <OptionEditor
                          columns={g.columns}
                          options={g.options}
                          onAddOption={() => addGroupOption(b.id, g.id)}
                          onRemoveOption={(optId) => removeGroupOption(b.id, g.id, optId)}
                          onRenameOption={(optId, name) => renameGroupOption(b.id, g.id, optId, name)}
                          onAmountChange={(optId, colId, patch) => setGroupOptionAmount(b.id, g.id, optId, colId, patch)}
                          onAddColumn={() => addGroupColumn(b.id, g.id)}
                          onRemoveColumn={(colId) => removeGroupColumn(b.id, g.id, colId)}
                          onRenameColumn={(colId, name) => renameGroupColumn(b.id, g.id, colId, name)}
                          category={category}
                        />
                      </div>
                    ))}
                    <button type="button" className="proto-add proto-add-small" onClick={() => addPriceGroup(b.id)}>
                      + {tp('pkg.addGroup')}
                    </button>
                  </>
                )}
                <ChoiceEditor
                  required={b.choicesRequired}
                  onRequiredChange={(choicesRequired) => setBlockField(b.id, { choicesRequired })}
                  columns={b.choiceColumns}
                  choices={b.choices}
                  onAddChoice={() => addBlockChoice(b.id)}
                  onRemoveChoice={(choiceId) => removeBlockChoice(b.id, choiceId)}
                  onRenameChoice={(choiceId, name) => renameBlockChoice(b.id, choiceId, name)}
                  onValueChange={(choiceId, colId, value) => setChoiceValue(b.id, choiceId, colId, value)}
                  onAddColumn={() => addChoiceColumn(b.id)}
                  onRemoveColumn={(colId) => removeChoiceColumn(b.id, colId)}
                  onRenameColumn={(colId, name) => renameChoiceColumn(b.id, colId, name)}
                  category={category}
                />
              </div>
          </Fragment>
          )
        })}
      </div>
      )}

      {page === 2 && (
      <div className="proto-two-col">
        {blocks.slice(fixedCount).map((b, j) => {
          const i = j + fixedCount
          const sectionNo = category === 'transport' || category === 'other' ? i + 2 : i + 3
          return (
          <Fragment key={b.id}>
            <div className="proto-card">
              <div className="proto-section-head">
                <span className="proto-no">{sectionNo}</span>
                <input className="proto-section-title" value={b.title} onChange={(e) => setBlockField(b.id, { title: e.target.value })} />
                <button type="button" className="proto-remove" onClick={() => removeBlock(b.id)}>
                  ✕ {tp('delete')}
                </button>
              </div>
              <label className="proto-field">
                <span>{tp('pkg.blockImages')} {tp('multiHint')}</span>
                <ImagePickButton onFiles={(files) => addBlockImages(b.id, files)} />
              </label>
              <ImageGrid images={b.images} onRemove={(url) => removeBlockImage(b.id, url)} />
              <label className="proto-field">
                <span>{tp('pkg.blockText')}</span>
                <textarea value={b.text} onChange={(e) => setBlockField(b.id, { text: e.target.value })} rows={4} />
              </label>
            </div>
            <div className="proto-card">
              <div className="proto-section-head">
                <span className="proto-no">{sectionNo}</span>
                <h3>{b.title || tp('sectionFallback')}</h3>
              </div>
              {category !== 'transport' && category !== 'tour' && category !== 'other' && (
                <>
                  {b.priceGroups.map((g, gi) => (
                    <div className="proto-price-group" key={g.id}>
                      <div className="proto-inline-row">
                        <input
                          className="proto-section-title"
                          value={g.title}
                          onChange={(e) => renamePriceGroup(b.id, g.id, e.target.value)}
                          placeholder={b.priceGroups.length > 1 ? tp('pkg.groupTitlePlaceholderN', { n: gi + 1 }) : tp('pkg.groupTitlePlaceholder')}
                        />
                        <RequiredToggle value={g.required} onChange={(required) => setPriceGroupRequired(b.id, g.id, required)} />
                        {b.priceGroups.length > 1 && (
                          <button type="button" className="proto-remove" onClick={() => removePriceGroup(b.id, g.id)}>
                            ✕ {tp('pkg.removeGroup')}
                          </button>
                        )}
                      </div>
                      <OptionEditor
                        columns={g.columns}
                        options={g.options}
                        onAddOption={() => addGroupOption(b.id, g.id)}
                        onRemoveOption={(optId) => removeGroupOption(b.id, g.id, optId)}
                        onRenameOption={(optId, name) => renameGroupOption(b.id, g.id, optId, name)}
                        onAmountChange={(optId, colId, patch) => setGroupOptionAmount(b.id, g.id, optId, colId, patch)}
                        onAddColumn={() => addGroupColumn(b.id, g.id)}
                        onRemoveColumn={(colId) => removeGroupColumn(b.id, g.id, colId)}
                        onRenameColumn={(colId, name) => renameGroupColumn(b.id, g.id, colId, name)}
                        category={category}
                      />
                    </div>
                  ))}
                  <button type="button" className="proto-add proto-add-small" onClick={() => addPriceGroup(b.id)}>
                    + {tp('pkg.addGroup')}
                  </button>
                </>
              )}
              <ChoiceEditor
                required={b.choicesRequired}
                onRequiredChange={(choicesRequired) => setBlockField(b.id, { choicesRequired })}
                columns={b.choiceColumns}
                choices={b.choices}
                onAddChoice={() => addBlockChoice(b.id)}
                onRemoveChoice={(choiceId) => removeBlockChoice(b.id, choiceId)}
                onRenameChoice={(choiceId, name) => renameBlockChoice(b.id, choiceId, name)}
                onValueChange={(choiceId, colId, value) => setChoiceValue(b.id, choiceId, colId, value)}
                onAddColumn={() => addChoiceColumn(b.id)}
                onRemoveColumn={(colId) => removeChoiceColumn(b.id, colId)}
                onRenameColumn={(colId, name) => renameChoiceColumn(b.id, colId, name)}
                category={category}
                showTransportHints={false}
              />
            </div>
          </Fragment>
          )
        })}

        {!readOnly && (
          <button type="button" className="proto-add proto-span-both" onClick={addBlock}>
            + {tp('pkg.addBlock')}
          </button>
        )}
      </div>
      )}
      </fieldset>

      <div className="proto-page-nav">
        <button
          type="button"
          className="proto-page-arrow"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          aria-label={t('common.prevPage')}
        >
          ◂
        </button>
        <button
          type="button"
          className="proto-page-arrow"
          onClick={() => setPage((p) => Math.min(2, p + 1))}
          disabled={page === 2 || (page === 0 && !nameFilled) || (page === 1 && !(hasPrice && itineraryFilled))}
          aria-label={t('common.nextPage')}
        >
          ▸
        </button>
      </div>

      {(page === 2 || canDraft) && !readOnly && (
        <div className="proto-submit-row">
          <div className="proto-submit-left">
            {canDraft && (
              <button type="button" className="outline-button" onClick={() => handleSave(true)} disabled={saving || uploading > 0 || !nameFilled}>
                {tp('saveDraft')}
              </button>
            )}
            {canDraft && draftSavedAt && !error && <p className="proto-hint">{tp('draftSaved')} · {draftSavedAt}</p>}
          </div>
          <div className="proto-submit-right">
            {error && <p className="pf-error">{t(`errors.${error}`)}</p>}
            {page === 2 && !error && !canSubmit && (
              <p className="pf-error">{!nameFilled ? tp('hintNameRequired') : !hasPrice ? tp('hintPriceRequired') : tp('hintItineraryRequired')}</p>
            )}
            {page === 2 && (
              <button type="button" className="primary-button proto-submit-button" onClick={() => handleSave()} disabled={saving || uploading > 0 || !canSubmit}>
                {saving ? tp('saving') : initial && !canDraft ? tp('saveEdit') : tp('saveNew')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
