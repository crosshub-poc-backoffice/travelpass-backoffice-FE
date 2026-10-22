// 임시 확인용 — 규칙 검사기가 실제로 걸리는지 본다. DB·Solar 안 씀.
import { runInspection } from '@/lib/server/inspect/pipeline'
import { cancelRules } from '@/lib/server/inspect/rules/cancel'
import { diffRules } from '@/lib/server/inspect/rules/diff'
import { priceRules } from '@/lib/server/inspect/rules/price'
import { scheduleRules } from '@/lib/server/inspect/rules/schedule'

const RULES = [...priceRules, ...cancelRules, ...scheduleRules, ...diffRules]
import { emptyRoomPricing, newId, type ProductInput } from '@/lib/products/types'
import { scheduleFor } from '@/lib/products/validate'

const base = (): ProductInput => ({
  partnerId: 'p1',
  category: 'tour',
  name: '후지산 1일 투어',
  images: ['https://x/a.jpg'],
  description: '설명',
  deadlineDays: 1,
  deadlineTime: '17:00',
  confirmType: 'instant',
  schedule: scheduleFor({}),
  cancelRules: [
    { daysBefore: 7, percent: 20 },
    { daysBefore: 3, percent: 50 },
  ],
  priceTable: { categories: [], plans: [], priceImages: [], priceText: '', title: '', roomTypes: [], roomPricing: emptyRoomPricing() },
  blocks: [],
})

const adult = { id: newId(), name: '성인' }
const child = { id: newId(), name: '아동' }

const broken = base()
broken.priceTable.categories = [adult, child]
broken.priceTable.plans = [
  { id: newId(), name: '1일권', prices: { [adult.id]: 12000, [child.id]: 18000 } }, // 아동가 역전
  { id: newId(), name: '2일권', prices: { [adult.id]: 1200000, [child.id]: 0 } }, // 자릿수 이상 + 0엔
]
broken.cancelRules = [
  { daysBefore: 7, percent: 80 },
  { daysBefore: 3, percent: 30 }, // 가까워지는데 싸짐
  { daysBefore: 3, percent: 50 }, // 중복
]
broken.deadlineTime = '25:00' // 형식 오류

const clean = base()
clean.priceTable.categories = [adult, child]
clean.priceTable.plans = [{ id: newId(), name: '1일권', prices: { [adult.id]: 12000, [child.id]: 8000 } }]

const prev = base()
prev.priceTable.categories = [adult]
prev.priceTable.plans = [{ id: newId(), name: '1일권', prices: { [adult.id]: 10000 } }]
const after = base()
after.priceTable.categories = [adult]
after.priceTable.plans = [{ id: newId(), name: '1일권', prices: { [adult.id]: 20000 } }] // +100%
after.cancelRules = [{ daysBefore: 7, percent: 10 }] // 느슨해짐 + 3일 줄 사라짐
after.images = []

const show = (label: string, r: Awaited<ReturnType<typeof runInspection>>) => {
  console.log(`\n── ${label} → ${r.verdict} (${r.findings.length}건)`)
  for (const f of r.findings) console.log(`   [${f.severity}] ${f.code}  ${JSON.stringify(f.evidence ?? {})}`)
}

const main = async () => {
  show('문제 있는 상품', await runInspection({ kind: 'product', current: null, proposed: broken }, RULES, { ai: false }))
  show('정상 상품', await runInspection({ kind: 'product', current: null, proposed: clean }, RULES, { ai: false }))
  show('변경요청(전/후)', await runInspection({ kind: 'product', current: prev, proposed: after }, RULES, { ai: false }))
}
main()
