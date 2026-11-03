// 소개서 추출 결과(BE 평면 JSON) → 등록 화면 초안. 새로 받는 판매기간·원문 언어가 맞게 걸러지는지
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftGaps, toProductDraft, type ExtractedProduct } from '../lib/products/extract-map'

const base: ExtractedProduct = {
  productName: '上五島の島旅',
  description: '島旅です。\n\n• フェリーで上五島へ',
  priceRows: [{ plan: '4月', category: '大人', yen: 48000 }],
  priceNote: '',
  cancelRules: [],
  sections: [],
}

test('판매기간·원문 언어를 받는다', () => {
  const d = toProductDraft({ ...base, sourceLocale: 'ja', saleStart: '2026-04-01', saleEnd: '2027-02-28' })
  assert.equal(d.sourceLocale, 'ja')
  assert.equal(d.saleStart, '2026-04-01')
  assert.equal(d.saleEnd, '2027-02-28')
  assert.equal(d.description, '島旅です。\n\n• フェリーで上五島へ')
})

test('형식이 틀리거나 순서가 뒤집힌 기간, 모르는 언어는 버린다', () => {
  const d = toProductDraft({ ...base, sourceLocale: 'other', saleStart: '2027-02-28', saleEnd: '2026-04-01' })
  assert.equal(d.sourceLocale, null)
  assert.equal(d.saleStart, null)
  assert.equal(toProductDraft({ ...base, saleStart: '2026/4/1', saleEnd: '2027-02-28' }).saleStart, null)
  assert.equal(toProductDraft(base).saleEnd, null)
})

test('섹션: 고정 종류는 하나씩, other 는 제목이 있는 것만 제목별로', () => {
  const d = toProductDraft({
    ...base,
    sections: [
      { kind: 'transport', title: '', text: '野母商船のフェリー太古を利用します。' },
      { kind: 'transport', title: '', text: '二つ目は버린다' },
      { kind: 'other', title: 'ご旅行代金に含まれるもの', text: '往復航空券、朝食が含まれます。' },
      { kind: 'other', title: '', text: '제목 없는 건 버린다' },
      { kind: 'other', title: 'ご旅行代金に含まれるもの', text: '같은 제목은 버린다' },
      { kind: 'intro', title: '紹介', text: '모르는 종류는 버린다' },
    ],
  })
  assert.deepEqual(
    d.sections.map((s) => [s.kind, s.title]),
    [
      ['transport', ''],
      ['other', 'ご旅行代金に含まれるもの'],
    ],
  )
})

test('확인 필요: 빈 요금 칸, 소인 열 없음, 취소 규정·판매기간 없음', () => {
  const d = toProductDraft({
    ...base,
    priceRows: [
      { plan: '3日間', category: '旅行代金', yen: 22800 },
      { plan: '3日間', category: '助成額', yen: 1000 },
      { plan: '4日間', category: '助成額', yen: 1000 },
    ],
    missingChildPrice: true,
  })
  assert.deepEqual(draftGaps(d), [
    { kind: 'price', plan: '4日間', category: '旅行代金' },
    { kind: 'childPrice' },
    { kind: 'cancelRules' },
    { kind: 'salePeriod' },
  ])
})

test('확인 필요: 어느 칸에도 안 들어온 블록', () => {
  const d = toProductDraft({
    ...base,
    uncoveredBlocks: [{ label: 'lodging', snippet: '●宿泊：勝丸荘' }, { label: 'irrelevant', snippet: 'menu' }, { label: 'transport', snippet: ' 九州郵船 ' }],
    saleStart: '2026-04-01',
    saleEnd: '2027-02-28',
    cancelRules: [{ daysBefore: 7, percent: 0 }],
  })
  assert.deepEqual(draftGaps(d), [
    { kind: 'block', label: 'lodging', snippet: '●宿泊：勝丸荘' },
    { kind: 'block', label: 'transport', snippet: '九州郵船' },
  ])
})
