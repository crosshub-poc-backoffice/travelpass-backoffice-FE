// 데모 데이터 채우기. 빈 DB(또는 scripts/seed-demo.ts가 비운 DB)에 한 번에 넣는다.
// 날짜는 전부 "오늘(JST) 기준 며칠 전/후"라서 언제 돌려도 오늘 이용·이번 달 정산·대기 중인 일이 살아 있다.
// 무작위 값은 고정 시드라 같은 날 돌리면 같은 결과가 나온다.
// 금액·수수료·취소 수수료·정산은 앱이 쓰는 계산(lib/fees.ts, lib/server/settlements/service.ts의 toLine)과 같게 만든다.

import type { Locale } from '../../i18n/routing'
import type { Prisma } from '../../lib/generated/prisma/client'
import { cancelFeeFor, daysBetween, splitAmount } from '../../lib/fees'
import { addDays } from '../../lib/products/jp-calendar'
import { resolve, saleRange, type SaleSchedule } from '../../lib/products/schedule'
import { sourceMap } from '../../lib/products/translation'
import { priceFrom, type ProductInput } from '../../lib/products/types'
import { DEMO_PRODUCTS, IKI_PRICES, ikiBuild, RYOKAN_ROOMS, type DemoProduct, type Localized, type PartnerKey } from './products'

type Db = Prisma.TransactionClient
const json = (v: unknown) => v as Prisma.InputJsonValue

// ── 고정 시드 난수 ──
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COMMISSION_RATE = 15
const AFFILIATE_SHARE = 5
const PG = { currency: 'JPY', pgName: 'GMO 페이먼트 게이트웨이', feeRate: 3, basis: 'completed' as const, payDay: 15 }
const ALL_LOCALES: Locale[] = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'vi']

export type FillResult = Record<string, number>

export async function fillDemo(db: Db, { passwordHash, now = new Date() }: { passwordHash: string; now?: Date }): Promise<FillResult> {
  const random = rng(20261020)
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  let idSeq = 0
  // cuid 비슷한 id (예약번호 표시가 id 뒷자리를 쓰므로 섞인 글자로)
  const id = () => `cd${(++idSeq).toString(36).padStart(4, '0')}${Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0')}`

  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10) // JST 오늘
  const d = (n: number) => addDays(today, n)
  /** JST 날짜 + 시각 → Date. 지금보다 늦으면 지금 조금 전으로 당긴다 */
  const at = (day: string, hh = 10, mm = 0) => {
    const t = new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`)
    return t > now ? new Date(now.getTime() - int(5, 90) * 60_000) : t
  }
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000)
  const asDate = (day: string) => new Date(`${day}T00:00:00Z`)
  const month = (day: string) => day.slice(0, 7)
  const shiftMonth = (m: string, n: number) => {
    const [y, mm] = m.split('-').map(Number)
    const t = new Date(Date.UTC(y, mm - 1 + n, 1))
    return t.toISOString().slice(0, 7)
  }

  // ── 연맹·PG ──
  const affiliateId = id()
  await db.affiliate.create({
    data: { id: affiliateId, name: '일본관광연맹', shareRate: AFFILIATE_SHARE, bankName: '미쓰비시UFJ은행 후쿠오카지점', bankAccountNumber: '0123456', bankAccountHolder: '一般社団法人 日本観光連盟', createdAt: at(d(-180), 9) },
  })
  await db.pgSetting.create({ data: PG })

  // ── 업체 6곳: 직접 운영 1(계정 있음), 연맹 대행 3, 비활성 1, 계약 전(수수료율 없음) 1 ──
  const partnerIds: Record<PartnerKey | 'sasebo' | 'shimabara', string> = {
    beppu: id(),
    tabinowa: id(),
    yufuin: id(),
    gotoCar: id(),
    sasebo: id(),
    shimabara: id(),
  }
  const proxy = new Set<string>([partnerIds.tabinowa, partnerIds.yufuin, partnerIds.gotoCar])
  await db.partner.createMany({
    data: [
      {
        id: partnerIds.beppu,
        name: '벳푸온천관광(주)',
        corporateName: '別府温泉観光株式会社',
        representativeName: '야마다 다카시',
        manager: '야마다 켄지',
        phone: '+81-977-21-0000',
        email: 'beppu@example.com',
        subManager: '이노우에 유카',
        subManagerPhone: '+81-90-1111-2222',
        businessRegistrationNumber: 'T4320001000001',
        address: '오이타현 벳푸시 기타하마 1-1-1',
        bankName: '미즈호은행 벳푸지점',
        bankCode: '0001-512',
        bankAccountNumber: '1234567',
        bankAccountHolder: '別府温泉観光株式会社',
        commissionRate: COMMISSION_RATE,
        memo: '공방 정기 점검일은 매달 둘째 주 — 판매 일정 예외로 막아 둠',
        createdAt: at(d(-176), 10),
      },
      {
        id: partnerIds.tabinowa,
        name: '규슈 아일랜드 트래블(주)',
        corporateName: '九州アイランドトラベル株式会社',
        representativeName: '마쓰모토 히로시',
        manager: '마쓰모토 아야',
        phone: '+81-92-700-0000',
        email: 'island-travel@example.com',
        businessRegistrationNumber: 'T4290001000002',
        address: '후쿠오카현 후쿠오카시 하카타구 지코마치 1-2',
        bankName: '후쿠오카은행 하카타지점',
        bankCode: '0177-102',
        bankAccountNumber: '2345678',
        bankAccountHolder: '九州アイランドトラベル株式会社',
        proxyAffiliateId: affiliateId,
        commissionRate: COMMISSION_RATE,
        memo: '낙도 보조금은 선착순 — 남은 보조금은 매주 월요일 연맹에 공유',
        createdAt: at(d(-175), 10),
      },
      {
        id: partnerIds.yufuin,
        name: '유후인 료칸 하나무라',
        corporateName: '有限会社 花村',
        representativeName: '하나무라 미치코',
        manager: '하나무라 쇼타',
        phone: '+81-977-84-0000',
        email: 'hanamura@example.com',
        businessRegistrationNumber: 'T4320002000003',
        address: '오이타현 유후시 유후인초 가와카미 2-2',
        proxyAffiliateId: affiliateId,
        commissionRate: COMMISSION_RATE,
        memo: '정산 계좌 미등록 — 연맹이 통장 사본 받는 중',
        createdAt: at(d(-175), 11),
      },
      {
        id: partnerIds.gotoCar,
        name: '고토 아일랜드 렌터카',
        corporateName: '五島アイランドレンタカー株式会社',
        representativeName: '고토 다이치',
        manager: '고토 하루미',
        phone: '+81-959-72-0000',
        email: 'goto-car@example.com',
        businessRegistrationNumber: 'T3310001000004',
        address: '나가사키현 고토시 후쿠에초 4-4',
        bankName: '주하치신와은행 후쿠에지점',
        bankCode: '0182-301',
        bankAccountNumber: '3456789',
        bankAccountHolder: '五島アイランドレンタカー株式会社',
        proxyAffiliateId: affiliateId,
        commissionRate: COMMISSION_RATE,
        memo: '차량 정비로 판매 중단 (업체 요청으로 숨김) — 연말 재개 예정',
        createdAt: at(d(-174), 10),
      },
      {
        id: partnerIds.sasebo,
        name: '사세보 하버 크루즈',
        corporateName: '佐世保ハーバークルーズ株式会社',
        manager: '나카무라 다이스케',
        phone: '+81-956-22-0000',
        email: 'sasebo@example.com',
        address: '나가사키현 사세보시 미나토마치 3-3',
        bankName: '주하치신와은행 사세보지점',
        bankAccountNumber: '4567890',
        bankAccountHolder: '佐世保ハーバークルーズ株式会社',
        commissionRate: COMMISSION_RATE,
        active: false,
        memo: '이번 시즌 휴업으로 비활성 처리',
        createdAt: at(d(-170), 10),
      },
      {
        id: partnerIds.shimabara,
        name: '시마바라 체험 공방',
        manager: '모리 아키코',
        phone: '+81-957-62-0000',
        email: 'shimabara@example.com',
        address: '나가사키현 시마바라시 조나이 1-1',
        commissionRate: null,
        memo: '계약 협의 중 — 수수료율 정해지면 상품 등록 시작',
        createdAt: at(d(-10), 15),
      },
    ],
  })

  // ── 계정 3개 (test-crosshub / test-federation / test-partner) ──
  const users = { crosshub: id(), federation: id(), partner: id() }
  await db.user.createMany({
    data: [
      { id: users.crosshub, loginId: 'test-crosshub', name: '크로스허브 운영팀', role: 'crosshub', passwordHash, mustChangePassword: false, lastLoginAt: hoursAgo(2), createdAt: at(d(-180), 9) },
      { id: users.federation, loginId: 'test-federation', name: '일본관광연맹', role: 'affiliate', affiliateId, passwordHash, mustChangePassword: false, lastLoginAt: hoursAgo(5), createdAt: at(d(-176), 9) },
      { id: users.partner, loginId: 'test-partner', name: '벳푸온천관광(주)', role: 'partner', partnerId: partnerIds.beppu, passwordHash, mustChangePassword: false, lastLoginAt: hoursAgo(20), createdAt: at(d(-176), 11) },
    ],
  })
  const ownerUser = (partnerId: string) => (proxy.has(partnerId) ? users.federation : users.partner)

  // ── 상품 6개 + 번역 ──
  type Built = { p: DemoProduct; id: string; partnerId: string; src: Localized; schedule: SaleSchedule; status: 'live' | 'review' | 'hidden'; createdAt: Date }
  const STATUS: Record<DemoProduct['key'], Built['status']> = { tour: 'live', yukata: 'review', goto: 'live', iki: 'live', ryokan: 'live', rentacar: 'hidden' }
  const CREATED: Record<DemoProduct['key'], Date> = {
    tour: at(d(-168), 14),
    goto: at(d(-166), 11),
    iki: at(d(-166), 15),
    ryokan: at(d(-165), 10),
    rentacar: at(d(-164), 16),
    yukata: hoursAgo(26),
  }
  // 번역 상태: 검수 완료(관광·상오도) / 검수 완료 뒤 원문 변경(료칸 소개글) / 자동 번역(이키·유카타·렌터카)
  const REVIEWED = new Set<DemoProduct['key']>(['tour', 'goto', 'ryokan'])
  const products: Record<DemoProduct['key'], Built> = {} as Record<DemoProduct['key'], Built>
  for (const p of DEMO_PRODUCTS) {
    const src = p.build(p.strings[p.sourceLocale], p.sourceLocale)
    const schedule = p.schedule(d)
    const range = saleRange(schedule)
    const built: Built = { p, id: id(), partnerId: partnerIds[p.partner], src, schedule, status: STATUS[p.key], createdAt: CREATED[p.key] }
    products[p.key] = built
    await db.product.create({
      data: {
        id: built.id,
        partnerId: built.partnerId,
        status: built.status,
        confirmType: p.confirmType,
        category: p.category,
        name: src.name,
        images: p.images,
        description: src.description,
        sourceLocale: p.sourceLocale,
        schedule: json(schedule),
        saleStart: range ? asDate(range[0]) : null,
        saleEnd: range ? asDate(range[1]) : null,
        deadlineDays: p.deadlineDays,
        deadlineTime: p.deadlineTime,
        cancelRules: json(p.cancelRules),
        priceFrom: priceFrom(src.priceTable),
        priceTable: json(src.priceTable),
        blocks: json(src.blocks),
        createdAt: built.createdAt,
      },
    })
    const sources = sourceMap(src)
    await db.productTranslation.createMany({
      data: ALL_LOCALES.filter((l) => l !== p.sourceLocale).map((locale) => {
        const texts = sourceMap(p.build(p.strings[locale], locale))
        const from = { ...sources }
        // 료칸: 검수한 뒤 소개글을 고쳐서, 번역은 예전 소개글 기준으로 남아 있다 → "원문 변경"
        if (p.key === 'ryokan') {
          from.description = p.strings[p.sourceLocale].oldDesc
          texts.description = p.strings[locale].oldDesc
        }
        return { productId: built.id, locale, texts: json(texts), sources: json(from), reviewed: REVIEWED.has(p.key) }
      }),
    })
  }

  // ── 상품 변경요청: 대기(이키 수정) / 반려(관광 수정) / 승인(렌터카 숨김) ──
  const productInput = (b: Built, src: Localized): ProductInput => ({
    partnerId: b.partnerId,
    category: b.p.category,
    name: src.name,
    images: b.p.images,
    description: src.description,
    deadlineDays: b.p.deadlineDays,
    deadlineTime: b.p.deadlineTime,
    confirmType: b.p.confirmType,
    schedule: b.schedule,
    cancelRules: b.p.cancelRules,
    priceTable: src.priceTable,
    blocks: src.blocks,
  })
  const ikiJa = products.iki.p.strings.ja
  const ikiProposal = ikiBuild(
    { ...ikiJa, priceText: ikiJa.priceText.replace('3,000円', '3,500円') },
    'ja',
    IKI_PRICES.map(([a, c]) => [a + 1000, c + 500]),
  )
  const tourProposal: Localized = JSON.parse(JSON.stringify(products.tour.src))
  tourProposal.priceTable.plans[1].prices['tour-adult'] = 9800
  tourProposal.priceTable.plans[1].prices['tour-child'] = 6200
  const requests = { iki: id(), tour: id(), rentacar: id() }
  await db.productChangeRequest.createMany({
    data: [
      { id: requests.iki, productId: products.iki.id, type: 'edit', proposedData: json(productInput(products.iki, ikiProposal)), status: 'pending', requestedById: users.federation, createdAt: hoursAgo(19) },
      {
        id: requests.tour,
        productId: products.tour.id,
        type: 'edit',
        proposedData: json(productInput(products.tour, tourProposal)),
        status: 'rejected',
        requestedById: users.partner,
        resolvedById: users.crosshub,
        resolvedAt: at(d(-11), 11),
        rejectReason: '공예 포함 요금 인상 폭이 커요(7,800엔 → 9,800엔). 이미 예약한 고객 안내 방법을 같이 적어서 다시 요청해 주세요.',
        createdAt: at(d(-12), 16),
      },
      { id: requests.rentacar, productId: products.rentacar.id, type: 'hide', targetStatus: 'hidden', status: 'approved', requestedById: users.federation, resolvedById: users.crosshub, resolvedAt: at(d(-20), 10), createdAt: at(d(-21), 17) },
    ],
  })

  // ── 예약 ──
  const CUSTOMERS: [string, string][] = [
    ['김도윤', 'KR'], ['박서연', 'KR'], ['이민준', 'KR'], ['최유나', 'KR'], ['정하은', 'KR'], ['한지민', 'KR'], ['윤서아', 'KR'], ['강예린', 'KR'],
    ['송민호', 'KR'], ['임도현', 'KR'], ['오지훈', 'KR'], ['신하린', 'KR'], ['장우진', 'KR'], ['배수아', 'KR'],
    ['田中太郎', 'JP'], ['佐藤健', 'JP'], ['山本さくら', 'JP'], ['高橋美咲', 'JP'],
    ['王芳', 'CN'], ['陈静', 'CN'], ['张伟', 'CN'], ['李娜', 'CN'],
    ['林美玲', 'TW'], ['陳怡君', 'TW'], ['張家豪', 'TW'], ['黃詩涵', 'TW'],
    ['陳嘉欣', 'HK'], ['Chan Ka Yan', 'HK'],
    ['Nguyen Van An', 'VN'], ['Tran Thi Mai', 'VN'], ['Le Van Hung', 'VN'], ['Pham Minh Chau', 'VN'],
    ['Emily Davis', 'US'], ['David Kim', 'US'], ['Michael Johnson', 'US'], ['Olivia Brown', 'AU'], ['Liam Wilson', 'AU'],
    ['Emma Wilson', 'GB'], ['Lucas Martin', 'FR'], ['Sophie Müller', 'DE'], ['Isabella Rossi', 'IT'], ['Ryan Park', 'CA'],
    ['Somchai Srisuk', 'TH'], ['Tan Wei Ming', 'SG'], ['Nur Aisyah', 'MY'],
  ]
  const DIAL: Record<string, string> = { KR: '+82-10', JP: '+81-90', CN: '+86-138', TW: '+886-912', HK: '+852-9', VN: '+84-90', US: '+1-415', AU: '+61-4', GB: '+44-7700', FR: '+33-6', DE: '+49-151', IT: '+39-320', CA: '+1-604', TH: '+66-81', SG: '+65-9', MY: '+60-12' }
  const contact = (name: string, nat: string, n: number) => ({
    phone: `${DIAL[nat]}-${String(1000 + ((n * 37) % 9000)).padStart(4, '0')}-${String(1000 + ((n * 91) % 9000)).padStart(4, '0')}`,
    email: /^[\x20-\x7e]+$/.test(name) ? `${name.toLowerCase().replace(/[^a-z]+/g, '.')}${n % 100}@example.com` : `guest${1000 + n}@example.com`,
  })
  const QUOTE_REJECT_REASONS = ['해당 날짜 페리 2등석이 이미 마감됐어요.', '신청 인원이 숙소 정원을 넘어요. 날짜를 바꿔 다시 신청해 주세요.', '보조금 예산이 이 날짜분까지 모두 소진됐어요.']
  const CANCEL_REASONS = ['고객 요청 (일정 변경)', '고객 요청 (항공편 변경)', '고객 요청 (건강 문제)', null, null]

  type BookingRow = Prisma.BookingCreateManyInput & { id: string }
  const bookings: BookingRow[] = []
  const payments: Prisma.PaymentCreateManyInput[] = []
  const refundAudits: { bookingId: string; customerName: string; partnerId: string; at: Date; detail?: Record<string, [unknown, unknown]> }[] = []
  const booked = new Map<string, number>() // `${상품}:${날짜}` → 정원 차지 인원
  let customerSeq = 0

  function nextCustomer() {
    // 한국 고객 비중을 높게 (TP 앱 주 사용자)
    const [name, nat] = random() < 0.35 ? pick(CUSTOMERS.filter(([, n]) => n === 'KR')) : pick(CUSTOMERS)
    customerSeq++
    return { name, nat, ...contact(name, nat, customerSeq) }
  }

  /** 상품·인원으로 금액과 선택 내역을 만든다 */
  function priceOf(b: Built, people: number) {
    const pt = b.src.priceTable
    if (b.p.key === 'ryokan') {
      const ri = random() < 0.5 ? 0 : random() < 0.75 ? 1 : 2
      const room = RYOKAN_ROOMS[ri]
      const nights = random() < 0.7 ? 1 : 2
      const extra = Math.max(0, people - 2) * 12000 * nights
      const dinner = random() < 0.25 ? 6000 * people : 0
      // 선택 내역 글은 상품에 있는 글(객실 이름·석식 옵션)만 쓴다 — 그래야 상품 번역으로 화면 언어에 맞춰 바뀐다.
      // 숙박은 인원 구분이 없어 peopleByCategory는 비우고(화면은 예약 인원으로 보여 준다), 박수·추가 인원 요금은 금액에만 넣는다
      const roomName = pt.roomTypes[ri].name
      const dinnerName = b.src.blocks.flatMap((bl) => bl.priceGroups).flatMap((g) => g.options)[0]?.name
      const options = dinner && dinnerName ? [{ label: dinnerName, amount: dinner }] : []
      return {
        amount: room.price * nights + extra + dinner,
        breakdown: { planId: room.id, planName: roomName, peopleByCategory: [], selectedOptions: options },
      }
    }
    const plan = b.p.key === 'tour' ? pt.plans[random() < 0.6 ? 1 : 0] : pick(pt.plans)
    const [catA, catB] = pt.categories
    const children = b.p.key === 'rentacar' ? (people > 1 && random() < 0.4 ? 1 : 0) : people >= 3 && random() < 0.5 ? int(1, people - 2) : 0
    const adults = people - children
    let amount = (plan.prices[catA.id] ?? 0) * adults + (plan.prices[catB.id] ?? 0) * children
    const selectedOptions: { label: string; amount: number }[] = []
    const groups = b.src.blocks.flatMap((bl) => bl.priceGroups)
    if (groups.length && random() < 0.3) {
      const g = pick(groups)
      const o = pick(g.options)
      const a = Object.values(o.amounts)[0]
      const each = (a.price ?? 0) * (a.sign === 'sub' ? -1 : 1)
      const total = b.p.key === 'rentacar' ? each * people : each * people
      selectedOptions.push({ label: o.name, amount: total })
      amount += total
    }
    const peopleByCategory = [
      { categoryId: catA.id, categoryName: catA.name, count: adults },
      ...(children ? [{ categoryId: catB.id, categoryName: catB.name, count: children }] : []),
    ]
    return { amount, breakdown: { planId: plan.id, planName: plan.name, peopleByCategory, selectedOptions } }
  }

  const FUEL: Partial<Record<DemoProduct['key'], number>> = { goto: 4000, iki: 3000 } // 1인 왕복 유류할증료 (10~2월 출발)
  function quoteFor(b: Built, useDate: string, people: number, amount: number) {
    const m = Number(useDate.slice(5, 7))
    const fuel = m >= 10 || m <= 2 ? (FUEL[b.p.key] ?? 0) * people : 0
    const discount = people >= 4 ? 2000 : 0
    const message = [
      fuel ? `유류할증료 1인 ${(fuel / people).toLocaleString('ja-JP')}엔을 포함한 견적입니다.` : '요청하신 일정 기준 견적입니다.',
      discount ? '4인 이상이라 2,000엔 할인했어요.' : '',
      b.p.key === 'goto' ? '페리 2등석과 호텔 마린피아 객실을 잡아 두었습니다.' : '가쓰마루소 객실을 잡아 두었습니다.',
    ]
      .filter(Boolean)
      .join(' ')
    return { quoteAmount: amount + fuel - discount, quoteMessage: message }
  }

  function addBooking(b: Built, useDate: string, people: number, forced?: BookingRow['status']) {
    const isQuote = b.p.confirmType === 'quote'
    const past = useDate < today
    const { amount: listAmount, breakdown } = priceOf(b, people)
    const c = nextCustomer()
    const leadMax = { tour: 30, yukata: 7, goto: 60, iki: 50, ryokan: 60, rentacar: 20 }[b.p.key]
    let requestedAt = at(addDays(useDate, -int(2, leadMax)), int(8, 22), int(0, 59))

    let status = forced
    if (!status) {
      const r = random()
      if (!isQuote) status = past ? (r < 0.86 ? 'completed' : useDate >= d(-25) && r < 0.92 ? 'canceled' : 'refunded') : r < 0.86 ? 'confirmed' : r < 0.94 ? 'canceled' : 'refunded'
      else if (past) status = r < 0.72 ? 'completed' : r < 0.8 ? 'withdrawn' : r < 0.88 ? 'rejected' : 'refunded'
      else status = r < 0.16 ? 'pending' : r < 0.3 ? 'quoted' : r < 0.74 ? 'confirmed' : r < 0.82 ? 'canceled' : r < 0.9 ? 'withdrawn' : r < 0.95 ? 'rejected' : 'refunded'
    }
    // 접수대기·고객확인중은 최근 신청이어야 자연스럽다
    if (status === 'pending') requestedAt = hoursAgo(int(1, 120))
    if (status === 'quoted') requestedAt = hoursAgo(int(30, 240))
    if (requestedAt > now) requestedAt = hoursAgo(1)

    const bookingId = id()
    const row: BookingRow = {
      id: bookingId,
      productId: b.id,
      partnerId: b.partnerId,
      customerName: c.name,
      phone: c.phone,
      email: c.email,
      nationality: c.nat,
      useDate: asDate(useDate),
      people,
      amount: listAmount,
      commissionRate: COMMISSION_RATE,
      ...splitAmount(listAmount, COMMISSION_RATE),
      affiliateShareRate: proxy.has(b.partnerId) ? AFFILIATE_SHARE : 0,
      pgFeeRate: PG.feeRate,
      priceBreakdown: json(breakdown),
      status,
      confirmType: b.p.confirmType,
      requestedAt,
      createdAt: requestedAt,
    }

    // 결제: 즉시확정은 신청과 동시에, 견적형은 고객이 견적을 수락할 때
    let paidAt: Date | null = null
    const paidStatuses = ['confirmed', 'completed', 'canceled', 'refunded']
    if (isQuote) {
      const q = quoteFor(b, useDate, people, listAmount)
      if (status === 'quoted') Object.assign(row, { ...q, customerDecision: 'waiting' })
      if (paidStatuses.includes(status)) {
        Object.assign(row, { ...q, customerDecision: 'accepted', amount: q.quoteAmount, ...splitAmount(q.quoteAmount, COMMISSION_RATE) })
        paidAt = new Date(Math.min(requestedAt.getTime() + int(20, 72) * 3600_000, now.getTime() - 3600_000))
      }
      if (status === 'withdrawn' && random() < 0.6) Object.assign(row, { ...q, customerDecision: 'declined' })
      if (status === 'rejected') row.cancelReason = pick(QUOTE_REJECT_REASONS)
    } else if (paidStatuses.includes(status)) {
      paidAt = requestedAt
    }
    const amount = row.amount
    if (paidAt) payments.push({ id: id(), bookingId, type: 'payment', amount, pg: PG.pgName, pgTransactionId: `GMO-${bookingId.slice(-10).toUpperCase()}`, createdAt: paidAt })

    // 취소: 결제 뒤 이용일 전에. 취소 수수료는 그날 기준 취소표로
    if (status === 'canceled' || status === 'refunded') {
      const fromDay = new Date(paidAt!.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
      const lastDay = useDate < today ? useDate : today
      const span = Math.max(0, daysBetween(fromDay, lastDay))
      let cancelDay = addDays(fromDay, int(0, span))
      if (status === 'canceled') cancelDay = addDays(today, -int(0, Math.min(6, Math.max(0, daysBetween(fromDay, today)))))
      if (cancelDay > useDate) cancelDay = useDate
      const ruleFee = cancelFeeFor(amount, b.p.cancelRules, daysBetween(cancelDay, useDate))
      let fee = ruleFee
      let reason = pick(CANCEL_REASONS)
      // 패키지는 태풍·결항 취소가 섞인다 — 업체가 환불할 때 수수료를 0으로 낮춰 준다
      if (status === 'refunded' && isQuote && random() < 0.35) {
        fee = 0
        reason = '태풍 접근으로 페리 결항 — 취소 수수료 면제'
      }
      Object.assign(row, { cancelFee: status === 'canceled' ? ruleFee : fee, cancelReason: reason })
      if (status === 'refunded') {
        const refundAt = new Date(Math.min(at(cancelDay, 15).getTime() + int(1, 3) * 86400_000, now.getTime() - 2 * 3600_000))
        if (amount - fee > 0) payments.push({ id: id(), bookingId, type: 'refund', amount: amount - fee, pg: PG.pgName, pgTransactionId: `GMO-R${bookingId.slice(-9).toUpperCase()}`, createdAt: refundAt })
        refundAudits.push({ bookingId, customerName: c.name, partnerId: b.partnerId, at: refundAt, detail: fee !== ruleFee ? { cancelFee: [ruleFee, fee] } : undefined })
      }
    }
    bookings.push(row)
    return row
  }

  const ACTIVE = ['pending', 'quoted', 'confirmed', 'completed']
  function tryBook(b: Built, day: string, people: number, forced?: BookingRow['status']) {
    const res = resolve(b.schedule, day)
    if (!res.open) return null
    const key = `${b.p.key}:${day}`
    const max = res.people.maxPeople
    const used = booked.get(key) ?? 0
    if (max != null && used + people > max) return null
    const row = addBooking(b, day, people, forced)
    if (ACTIVE.includes(row.status as string)) booked.set(key, used + people)
    return row
  }

  // 날짜마다 상품별로 예약을 흩뿌린다. 주말·성수기(7·8·10·11월)에 더 많이, 앞날로 갈수록 적게
  for (let n = -150; n <= 70; n++) {
    const day = d(n)
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
    const m = Number(day.slice(5, 7))
    const season = [7, 8, 10, 11].includes(m) ? 1.3 : 1
    const weekend = dow === 0 || dow === 6 ? 1.5 : 1
    const fade = n <= 0 ? 1 : Math.max(0.15, 1 - n / 80)
    const chance = (p: number) => random() < Math.min(0.95, p * season * weekend * fade)
    if (chance(0.55)) tryBook(products.tour, day, int(1, 4))
    if (chance(0.3)) tryBook(products.tour, day, int(2, 4))
    if (chance(0.22)) tryBook(products.goto, day, int(1, 4))
    if (chance(0.2)) tryBook(products.iki, day, int(1, 4))
    if (chance(0.4)) tryBook(products.ryokan, day, int(2, 3))
    if (n <= -21 && chance(0.35)) tryBook(products.rentacar, day, int(1, 2))
  }
  // 꼭 보여야 하는 장면: 오늘 이용, 정원이 꽉 찬 날, 막 들어온 견적 요청, 견적 회신 대기
  tryBook(products.tour, d(0), 2, 'confirmed')
  tryBook(products.ryokan, d(0), 2, 'confirmed')
  for (let i = 0; i < 6; i++) tryBook(products.tour, d(5), 3, 'confirmed')
  tryBook(products.goto, d(30), 2, 'pending')
  tryBook(products.iki, d(26), 3, 'pending')
  tryBook(products.goto, d(18), 4, 'quoted')
  tryBook(products.iki, d(12), 2, 'quoted')
  tryBook(products.tour, d(3), 2, 'canceled')

  await db.booking.createMany({ data: bookings })
  await db.payment.createMany({ data: payments })

  // ── 문의 (고객 언어 en·zh·ja·vi, 답변대기·답변완료·답변 여러 개·다른 언어로 쓴 답변) ──
  type Q = { product: DemoProduct['key']; name: string; lang: 'en' | 'zh' | 'ja' | 'vi'; q: string; qKo: string; daysAgo: number; answers?: { text: string; translated: string; locale?: string }[] }
  const INQUIRIES: Q[] = [
    { product: 'tour', name: 'Emily Davis', lang: 'en', q: 'Is the bamboo craft suitable for a 7-year-old?', qKo: '7살 아이도 대나무 공예를 할 수 있나요?', daysAgo: 40, answers: [{ text: '네, 젓가락 만들기는 7세부터 충분히 할 수 있어요. 바구니 엮기는 10세 이상을 권해요.', translated: 'Yes, chopstick making is fine from age 7. We recommend the basket weaving for ages 10 and up.' }] },
    { product: 'tour', name: '王芳', lang: 'zh', q: '下雨天也会照常进行吗？', qKo: '비가 와도 진행하나요?', daysAgo: 25, answers: [{ text: '네, 비가 와도 진행하고 우산을 빌려 드려요. 태풍 경보가 나오면 전액 환불해 드립니다.', translated: '是的，雨天照常进行，我们会提供雨伞。如发布台风警报，将全额退款。' }] },
    { product: 'tour', name: 'Tran Thi Mai', lang: 'vi', q: 'Tôi có thể đổi từ gói chỉ tham quan sang gói có làm đồ tre vào ngày hôm đó không?', qKo: '당일에 순례만 하는 플랜에서 대나무 공예 포함 플랜으로 바꿀 수 있나요?', daysAgo: 0.2 },
    { product: 'tour', name: '山本さくら', lang: 'ja', q: 'ベビーカーで参加できますか？', qKo: '유모차로 참여할 수 있나요?', daysAgo: 3 },
    { product: 'goto', name: 'David Kim', lang: 'en', q: 'Can we board the ferry with a large suitcase?', qKo: '큰 캐리어를 가지고 페리를 탈 수 있나요?', daysAgo: 60, answers: [{ text: '네, 2등 자유석에도 짐 두는 곳이 있어요. 30kg이 넘는 짐은 별도 요금이 붙습니다.', translated: 'Yes, there is luggage space even in 2nd class open seating. Items over 30 kg incur an extra fee.' }] },
    {
      product: 'goto',
      name: '陈静',
      lang: 'zh',
      q: '补助金需要提交什么资料吗？',
      qKo: '보조금을 받으려면 제출할 서류가 있나요?',
      daysAgo: 18,
      answers: [
        { text: '예약 후 이름과 주소를 적는 신청서를 메일로 보내 드려요. 여권 사본은 필요 없어요.', translated: '预订后我们会通过邮件发送填写姓名和地址的申请表，无需护照复印件。' },
        { text: '추가 안내: 신청서는 출발 7일 전까지 회신해 주셔야 보조금이 적용됩니다.', translated: '补充说明：申请表须于出发前7天回复，方可享受补助金。' },
      ],
    },
    { product: 'goto', name: 'Le Van Hung', lang: 'vi', q: 'Có thể chọn hai chương trình trải nghiệm không?', qKo: '체험 프로그램을 두 개 고를 수 있나요?', daysAgo: 2 },
    { product: 'goto', name: 'Isabella Rossi', lang: 'en', q: 'Is there a Sunday mass we can attend at the churches?', qKo: '성당에서 일요일 미사에 참석할 수 있나요?', daysAgo: 4 },
    { product: 'iki', name: 'Lucas Martin', lang: 'en', q: 'Is the jetfoil often cancelled in winter?', qKo: '겨울에 제트포일이 자주 결항하나요?', daysAgo: 33, answers: [{ text: '겨울에는 파도 때문에 한 달에 1~2번 결항해요. 결항하면 페리로 바꿔 드리고 차액은 받지 않습니다.', translated: 'In winter it is cancelled once or twice a month due to rough seas. If that happens, we switch you to the ferry at no extra charge.' }] },
    { product: 'iki', name: '高橋美咲', lang: 'ja', q: '焼酎の蔵見学は運転する人も参加できますか？', qKo: '소주 양조장 견학은 운전하는 사람도 참여할 수 있나요?', daysAgo: 5 },
    { product: 'iki', name: 'Pham Minh Chau', lang: 'vi', q: 'Giá đã gồm phụ phí nhiên liệu chưa?', qKo: '요금에 유류할증료가 포함돼 있나요?', daysAgo: 9, answers: [{ text: '유류할증료 3,000엔은 별도이고, 견적을 보낼 때 함께 넣어 드려요.', translated: 'Phụ phí nhiên liệu 3.000 yên được tính riêng và sẽ được cộng vào khi chúng tôi gửi báo giá.' }] },
    { product: 'ryokan', name: 'Olivia Brown', lang: 'en', q: 'Do you have rooms with beds instead of futons?', qKo: '이불 대신 침대가 있는 방이 있나요?', daysAgo: 50, answers: [{ text: '노천탕 딸린 화양실과 별채 스위트에 트윈 침대가 있어요.', translated: 'The Japanese-Western room with open-air bath and the detached suite both have twin beds.' }] },
    { product: 'ryokan', name: '林美玲', lang: 'zh', q: '可以准备素食晚餐吗？', qKo: '채식 저녁 식사를 준비해 줄 수 있나요?', daysAgo: 0.1 },
    // 연맹 담당자가 일본어로 바로 쓴 답변 — 문의 화면에서 "내 언어로 번역" 버튼이 보이는 경우
    { product: 'ryokan', name: '佐藤健', lang: 'ja', q: '駐車場はありますか？', qKo: '주차장이 있나요?', daysAgo: 70, answers: [{ text: 'はい、無料駐車場が8台分あります。予約は不要です。', translated: 'はい、無料駐車場が8台分あります。予約は不要です。', locale: 'ja' }] },
    { product: 'ryokan', name: 'Nguyen Van An', lang: 'vi', q: 'Trẻ em 4 tuổi có tính phí không?', qKo: '4살 아이도 요금이 있나요?', daysAgo: 14, answers: [{ text: '식사와 이불이 필요 없는 미취학 아동은 무료예요. 식사가 필요하면 1인 6,000엔입니다.', translated: 'Trẻ chưa đi học không cần suất ăn và chăn đệm thì miễn phí. Nếu cần suất ăn, phí là 6.000 yên/người.' }] },
    { product: 'rentacar', name: 'Emma Wilson', lang: 'en', q: 'Can I return the car at Goto Airport?', qKo: '고토공항에서 차를 반납할 수 있나요?', daysAgo: 80, answers: [{ text: '공항 반납은 2,200엔을 더 내시면 가능해요. 예약할 때 메모로 알려 주세요.', translated: 'Yes, airport return is available for an extra ¥2,200. Please let us know in the booking notes.' }] },
    { product: 'rentacar', name: '张伟', lang: 'zh', q: '中国驾照可以租车吗？', qKo: '중국 운전면허증으로 빌릴 수 있나요?', daysAgo: 45, answers: [{ text: '중국은 제네바 협약 가입국이 아니라서 중국 면허로는 일본에서 운전할 수 없어요. 죄송합니다.', translated: '中国不是日内瓦公约缔约国，持中国驾照无法在日本驾驶，非常抱歉。' }] },
  ]
  const answerAudits: { inquiryId: string; name: string; partnerId: string; at: Date }[] = []
  for (const q of INQUIRIES) {
    const b = products[q.product]
    const inquiryId = id()
    const createdAt = hoursAgo(q.daysAgo * 24 + int(1, 8))
    const answers = (q.answers ?? []).map((a, i) => ({ ...a, at: new Date(Math.min(createdAt.getTime() + (i + 1) * int(3, 20) * 3600_000, now.getTime() - 600_000)) }))
    const last = answers[answers.length - 1]
    await db.inquiry.create({
      data: {
        id: inquiryId,
        productId: b.id,
        customerName: q.name,
        language: q.lang,
        question: q.q,
        questionTranslated: q.qKo,
        questionTranslatedLocale: 'ko',
        answer: last?.text ?? null,
        answerTranslated: last?.translated ?? null,
        status: last ? 'answered' : 'pending',
        createdAt,
        messages: {
          create: [
            { sender: 'customer', text: q.q, textTranslated: q.qKo, translatedLocale: 'ko', createdAt },
            ...answers.map((a) => ({ sender: 'admin' as const, text: a.text, textTranslated: a.translated, textLocale: a.locale ?? 'ko', createdAt: a.at })),
          ],
        },
      },
    })
    for (const a of answers) answerAudits.push({ inquiryId, name: q.name, partnerId: b.partnerId, at: a.at })
  }

  // ── 정산 (이용완료일 기준). 지난달 이전은 업체·연맹 모두 지급완료, 지난달은 직접 운영 업체만 먼저 지급 ──
  const thisMonth = month(today)
  const lastMonth = shiftMonth(thisMonth, -1)
  const productPartner = new Map(Object.values(products).map((b) => [b.id, b.partnerId]))
  type Line = { partnerId: string; month: string; base: number; commission: number; net: number; affiliate: number }
  const lines: Line[] = []
  for (const b of bookings) {
    const day = (b.useDate as Date).toISOString().slice(0, 10)
    const partnerId = productPartner.get(b.productId)!
    const shares = (base: number) => Math.round((base * (b.affiliateShareRate ?? 0)) / 100)
    if (b.status === 'completed') lines.push({ partnerId, month: month(day), base: b.amount, commission: b.commission!, net: b.net!, affiliate: shares(b.amount) })
    if ((b.status === 'canceled' || b.status === 'refunded') && (b.cancelFee ?? 0) > 0) {
      const fee = b.cancelFee!
      lines.push({ partnerId, month: month(day), base: fee, ...splitAmount(fee, COMMISSION_RATE), affiliate: shares(fee) })
    }
  }
  const payDateFor = (m: string) => {
    const pay = `${shiftMonth(m, 1)}-${String(PG.payDay).padStart(2, '0')}`
    return pay <= today ? pay : today
  }
  const settlementRows: Prisma.SettlementCreateManyInput[] = []
  const settlementAudits: { partnerId: string; period: string; payDate: string; net: number }[] = []
  for (const m of [...new Set(lines.map((l) => l.month))].sort()) {
    if (m > lastMonth) continue
    for (const partnerId of new Set(lines.filter((l) => l.month === m).map((l) => l.partnerId))) {
      if (m === lastMonth && partnerId !== partnerIds.beppu) continue
      const ls = lines.filter((l) => l.month === m && l.partnerId === partnerId)
      const net = ls.reduce((s, l) => s + l.net, 0)
      const payDate = payDateFor(m)
      settlementRows.push({
        partnerId,
        period: m,
        gross: ls.reduce((s, l) => s + l.base, 0),
        commissionRate: COMMISSION_RATE,
        commission: ls.reduce((s, l) => s + l.commission, 0),
        net,
        bookingCount: ls.length,
        status: 'paid',
        payDate: asDate(payDate),
        createdAt: at(payDate, 11),
      })
      settlementAudits.push({ partnerId, period: m, payDate, net })
    }
  }
  await db.settlement.createMany({ data: settlementRows })
  const affiliateRows: Prisma.AffiliateSettlementCreateManyInput[] = []
  for (const m of [...new Set(lines.map((l) => l.month))].sort()) {
    if (m >= lastMonth) continue
    const ls = lines.filter((l) => l.month === m && proxy.has(l.partnerId))
    if (!ls.length) continue
    const payDate = payDateFor(m)
    affiliateRows.push({ affiliateId, period: m, currency: 'JPY', amount: ls.reduce((s, l) => s + l.affiliate, 0), partnerCount: new Set(ls.map((l) => l.partnerId)).size, status: 'paid', payDate: asDate(payDate), createdAt: at(payDate, 11, 30) })
  }
  await db.affiliateSettlement.createMany({ data: affiliateRows })

  // ── 알림 ──
  await db.notification.createMany({
    data: [
      {
        userId: users.crosshub,
        type: 'product_change_requested',
        sourceId: requests.iki,
        payload: json({ type: 'product_change_requested', requestId: requests.iki, productId: products.iki.id, productName: products.iki.src.name, changeType: 'edit', requesterName: '일본관광연맹' }),
        read: false,
        createdAt: hoursAgo(19),
      },
      {
        userId: users.partner,
        type: 'product_change_resolved',
        sourceId: `${requests.tour}:rejected`,
        payload: json({ type: 'product_change_resolved', requestId: requests.tour, productId: products.tour.id, productName: products.tour.src.name, changeType: 'edit', result: 'rejected', reason: '공예 포함 요금 인상 폭이 커요(7,800엔 → 9,800엔). 이미 예약한 고객 안내 방법을 같이 적어서 다시 요청해 주세요.' }),
        read: false,
        createdAt: at(d(-11), 11),
      },
      {
        userId: users.federation,
        type: 'product_change_resolved',
        sourceId: `${requests.rentacar}:approved`,
        payload: json({ type: 'product_change_resolved', requestId: requests.rentacar, productId: products.rentacar.id, productName: products.rentacar.src.name, changeType: 'hide', targetStatus: 'hidden', result: 'approved' }),
        read: true,
        createdAt: at(d(-20), 10),
      },
      ...(['goto', 'iki', 'ryokan', 'rentacar'] as const).map((k) => ({
        userId: users.federation,
        type: 'product_status_changed' as const,
        sourceId: `${products[k].id}:live`,
        payload: json({ type: 'product_status_changed', productId: products[k].id, productName: products[k].src.name, status: 'live' }),
        read: true,
        createdAt: new Date(products[k].createdAt.getTime() + 20 * 3600_000),
      })),
      {
        userId: users.partner,
        type: 'product_status_changed',
        sourceId: `${products.tour.id}:live`,
        payload: json({ type: 'product_status_changed', productId: products.tour.id, productName: products.tour.src.name, status: 'live' }),
        read: true,
        createdAt: new Date(products.tour.createdAt.getTime() + 22 * 3600_000),
      },
    ],
  })

  // ── 작업 이력 ──
  type Audit = Prisma.AuditLogCreateManyInput
  const audits: Audit[] = []
  const log = (a: Omit<Audit, 'detail'> & { detail?: Record<string, [unknown, unknown]> }) => audits.push({ ...a, detail: a.detail ? json(a.detail) : undefined })
  const partnerNames: Record<string, string> = {
    [partnerIds.beppu]: '벳푸온천관광(주)',
    [partnerIds.tabinowa]: '규슈 아일랜드 트래블(주)',
    [partnerIds.yufuin]: '유후인 료칸 하나무라',
    [partnerIds.gotoCar]: '고토 아일랜드 렌터카',
    [partnerIds.sasebo]: '사세보 하버 크루즈',
    [partnerIds.shimabara]: '시마바라 체험 공방',
  }
  for (const [pid, name] of Object.entries(partnerNames)) log({ userId: users.crosshub, action: 'partner_create', partnerId: pid, targetId: pid, targetName: name, createdAt: at(d(pid === partnerIds.shimabara ? -10 : -176), 10, 30) })
  log({ userId: users.crosshub, action: 'account_issue', partnerId: null, targetId: users.federation, targetName: 'test-federation', createdAt: at(d(-176), 9, 10) })
  log({ userId: users.crosshub, action: 'account_issue', partnerId: partnerIds.beppu, targetId: users.partner, targetName: 'test-partner', createdAt: at(d(-176), 11, 10) })
  log({ userId: users.crosshub, action: 'partner_commission', partnerId: partnerIds.beppu, targetId: partnerIds.beppu, targetName: '벳푸온천관광(주)', detail: { commissionRate: [null, COMMISSION_RATE] }, createdAt: at(d(-176), 11, 20) })
  log({ userId: users.federation, action: 'partner_bank', partnerId: partnerIds.gotoCar, targetId: partnerIds.gotoCar, targetName: '고토 아일랜드 렌터카', createdAt: at(d(-60), 14) })
  log({ userId: users.crosshub, action: 'partner_deactivate', partnerId: partnerIds.sasebo, targetId: partnerIds.sasebo, targetName: '사세보 하버 크루즈', createdAt: at(d(-30), 17) })
  for (const b of Object.values(products)) {
    log({ userId: ownerUser(b.partnerId), action: 'product_create', partnerId: b.partnerId, targetId: b.id, targetName: b.src.name, createdAt: b.createdAt })
    if (b.status !== 'review') log({ userId: users.crosshub, action: 'product_status', partnerId: b.partnerId, targetId: b.id, targetName: b.src.name, detail: { status: ['review', 'live'] }, createdAt: new Date(b.createdAt.getTime() + 20 * 3600_000) })
    if (REVIEWED.has(b.p.key)) {
      for (const [i, locale] of ALL_LOCALES.filter((l) => l !== b.p.sourceLocale).entries()) {
        log({ userId: ownerUser(b.partnerId), action: 'product_translation', partnerId: b.partnerId, targetId: b.id, targetName: b.src.name, detail: { locale: [null, locale], reviewed: [false, true] }, createdAt: new Date(b.createdAt.getTime() + (2 + i) * 86400_000) })
      }
    }
  }
  log({ userId: users.crosshub, action: 'product_status', partnerId: products.rentacar.partnerId, targetId: products.rentacar.id, targetName: products.rentacar.src.name, detail: { status: ['live', 'hidden'] }, createdAt: at(d(-20), 10) })
  log({ userId: users.federation, action: 'product_update', partnerId: products.ryokan.partnerId, targetId: products.ryokan.id, targetName: products.ryokan.src.name, createdAt: at(d(-6), 13) })
  for (const r of refundAudits) log({ userId: ownerUser(r.partnerId), action: 'booking_refund', partnerId: r.partnerId, targetId: r.bookingId, targetName: r.customerName, detail: r.detail, createdAt: r.at })
  for (const a of answerAudits) log({ userId: ownerUser(a.partnerId), action: 'inquiry_answer', partnerId: a.partnerId, targetId: a.inquiryId, targetName: a.name, createdAt: a.at })
  for (const s of settlementAudits) log({ userId: users.crosshub, action: 'settlement_pay', partnerId: s.partnerId, targetId: s.period, targetName: partnerNames[s.partnerId], detail: { period: [null, s.period], payDate: [null, s.payDate], net: [null, s.net] }, createdAt: at(s.payDate, 11) })
  for (const a of affiliateRows) {
    const payDate = (a.payDate as Date).toISOString().slice(0, 10)
    log({ userId: users.crosshub, action: 'settlement_affiliate_pay', partnerId: null, targetId: a.period, targetName: '일본관광연맹', detail: { period: [null, a.period], currency: [null, 'JPY'], payDate: [null, payDate], amount: [null, a.amount] }, createdAt: at(payDate, 11, 30) })
  }
  await db.auditLog.createMany({ data: audits })

  // ── 로그인·접속 기록 (최근 3주) ──
  const UA = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  }
  const loginLogs: Prisma.LoginLogCreateManyInput[] = []
  const accessLogs: Prisma.AccessLogCreateManyInput[] = []
  const who = [
    { userId: users.crosshub, loginId: 'test-crosshub', ip: '211.45.62.10', ua: UA.mac, menus: ['dashboard', 'products', 'bookings', 'settlements', 'partners', 'auditLogs', 'stats'] },
    { userId: users.federation, loginId: 'test-federation', ip: '133.32.18.77', ua: UA.win, menus: ['dashboard', 'products', 'bookings', 'inquiries', 'settlements'] },
    { userId: users.partner, loginId: 'test-partner', ip: '126.15.204.3', ua: UA.iphone, menus: ['dashboard', 'bookings', 'inquiries', 'products'] },
  ]
  for (let n = -21; n <= 0; n++) {
    for (const u of who) {
      if (random() < 0.35 && n !== 0) continue
      const loginAt = n === 0 ? hoursAgo(u.loginId === 'test-crosshub' ? 2 : u.loginId === 'test-federation' ? 5 : 20) : at(d(n), int(8, 18), int(0, 59))
      loginLogs.push({ userId: u.userId, loginId: u.loginId, event: 'login', ip: u.ip, userAgent: u.ua, createdAt: loginAt })
      for (const [i, menu] of u.menus.entries()) {
        if (random() < 0.4) continue
        accessLogs.push({ userId: u.userId, menu, kind: i === 0 ? 'list' : pick(['list', 'view', 'update']), path: `/ko/${menu === 'auditLogs' ? 'audit-logs' : menu}`, ip: u.ip, userAgent: u.ua, createdAt: new Date(loginAt.getTime() + (i + 1) * int(2, 15) * 60_000) })
      }
      if (n !== 0 && random() < 0.5) loginLogs.push({ userId: u.userId, loginId: u.loginId, event: 'logout', ip: u.ip, userAgent: u.ua, createdAt: new Date(loginAt.getTime() + int(30, 180) * 60_000) })
    }
  }
  // 비밀번호 틀림·없는 아이디 시도
  loginLogs.push({ userId: users.partner, loginId: 'test-partner', event: 'failed', failReason: 'wrongPassword', ip: '126.15.204.3', userAgent: UA.iphone, createdAt: at(d(-3), 8, 2) })
  loginLogs.push({ userId: users.partner, loginId: 'test-partner', event: 'failed', failReason: 'wrongPassword', ip: '126.15.204.3', userAgent: UA.iphone, createdAt: at(d(-3), 8, 3) })
  loginLogs.push({ userId: null, loginId: 'admin', event: 'failed', failReason: 'unknownId', ip: '45.155.205.12', userAgent: 'python-requests/2.32', createdAt: at(d(-8), 3, 41) })
  await db.loginLog.createMany({ data: loginLogs.filter((l) => (l.createdAt as Date) <= now) })
  await db.accessLog.createMany({ data: accessLogs.filter((l) => (l.createdAt as Date) <= now) })

  const count = (s: string) => bookings.filter((b) => b.status === s).length
  return {
    업체: 6,
    계정: 3,
    상품: DEMO_PRODUCTS.length,
    예약: bookings.length,
    접수대기: count('pending'),
    고객확인중: count('quoted'),
    확정: count('confirmed'),
    이용완료: count('completed'),
    환불대기: count('canceled'),
    환불완료: count('refunded'),
    거절: count('rejected'),
    신청취소: count('withdrawn'),
    결제기록: payments.length,
    문의: INQUIRIES.length,
    지급완료정산: settlementRows.length,
    연맹정산: affiliateRows.length,
    작업이력: audits.length,
  }
}
