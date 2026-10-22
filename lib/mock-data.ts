// PoC 프로토타입용 목업 데이터.
// 실제 결제, 정산 흐름(국내/일본 PG 연동)은 문서 기준 미확정 상태라 화면 구조만 반영.

export type ProductStatus = '노출중' | '숨김' | '심사중'
export type ConfirmType = '즉시확정' | '견적확인후확정'

// 페리, 항공 등 복수 구간으로 구성되는 교통편 한 구간
export type TransportLeg = {
  id: string
  direction: '왕로' | '귀로'
  mode: '페리' | '항공' | '제트포일' | '버스' | '기타'
  operator: string
  from: string
  to: string
}

// 기본 숙박시설 외에 고객이 선택할 수 있는 대체 숙박시설
export type LodgingOption = {
  id: string
  name: string
  roomCapacity: number
  breakfastIncluded: boolean
  isDefault: boolean
}

export type ProductOptionChoice = {
  id: string
  label: string
}

// 여러 선택지 중 1개를 고르게 하는 옵션 그룹 (예: 체험 프로그램 중 1개 필수 선택)
export type ProductOptionGroup = {
  id: string
  title: string
  required: boolean
  choices: ProductOptionChoice[]
}

export type Product = {
  id: string
  name: string
  nameEn: string
  nameJa: string
  nameZh: string
  category: string
  partner: string
  price: number
  priceChild?: number
  subsidyAmount?: number
  currency: 'KRW' | 'JPY'
  status: ProductStatus
  confirmType: ConfirmType
  capacityPerDay: number
  salesCount: number
  createdAt: string
  cancelPolicy: string
  description: string
  transportLegs?: TransportLeg[]
  lodgingOptions?: LodgingOption[]
  optionGroups?: ProductOptionGroup[]
  meetingPoint?: string
  meetingTime?: string
  baseNights?: number
  maxExtraNights?: number
  escortIncluded?: boolean
  bookingDeadline?: string
  minParticipants?: number
}

export const PRODUCTS: Product[] = [
  {
    id: 'PRD-0001',
    name: '벳푸 온천 & 페리 연계 1일 투어',
    nameEn: 'Beppu Hot Spring & Ferry Day Tour',
    nameJa: '別府温泉 & フェリー連携1日ツアー',
    nameZh: '别府温泉&渡轮联运一日游',
    category: '체험, 온천',
    partner: '벳푸온천관광(주)',
    price: 68000,
    priceChild: 42000,
    subsidyAmount: 10000,
    currency: 'JPY',
    status: '노출중',
    confirmType: '즉시확정',
    capacityPerDay: 20,
    salesCount: 134,
    createdAt: '2026-08-24',
    cancelPolicy: '이용일 3일 전까지 전액 환불, 이후 50% 수수료',
    description: '벳푸 지옥온천 순례와 간나와 온천을 페리 연계 일정으로 즐기는 당일 투어입니다.',
    transportLegs: [
      { id: 'LEG-1', direction: '왕로', mode: '페리', operator: '한큐페리', from: '부산항', to: '벳푸항' },
      { id: 'LEG-2', direction: '귀로', mode: '항공', operator: 'ANA', from: '오이타공항', to: '김해공항' },
    ],
    lodgingOptions: [
      { id: 'LDG-1', name: '벳푸 간나와 료칸', roomCapacity: 2, breakfastIncluded: true, isDefault: true },
      { id: 'LDG-2', name: '벳푸베이 호텔', roomCapacity: 2, breakfastIncluded: false, isDefault: false },
    ],
    optionGroups: [
      {
        id: 'OPT-1',
        title: '체험 프로그램 선택',
        required: true,
        choices: [
          { id: 'CH-1', label: '지옥온천 순례' },
          { id: 'CH-2', label: '족욕 체험' },
          { id: 'CH-3', label: '온천 요리 교실' },
        ],
      },
    ],
    meetingPoint: '벳푸항 여객터미널 2층 로비',
    meetingTime: '09:00',
    baseNights: 1,
    maxExtraNights: 2,
    escortIncluded: true,
    bookingDeadline: '이용일 5일 전까지',
    minParticipants: 2,
  },
  {
    id: 'PRD-0002',
    name: '고베 제트포일 & 간사이공항 연계권',
    nameEn: 'Kobe Jet-Foil & KIX Transfer Pass',
    nameJa: '神戸ジェットフォイル & 関西空港連携券',
    nameZh: '神户喷射飞船&关西机场联运券',
    category: '교통, 연계권',
    partner: '간사이트래블㈜',
    price: 5200,
    currency: 'JPY',
    status: '심사중',
    confirmType: '즉시확정',
    capacityPerDay: 60,
    salesCount: 0,
    createdAt: '2026-10-02',
    cancelPolicy: '출발 24시간 전까지 무료 취소',
    description: '고베 공항에서 간사이공항까지 제트포일로 이동하는 고속 연계 티켓.',
  },
  {
    id: 'PRD-0003',
    name: '나가사키 군함섬 크루즈 & 전세기 연계',
    nameEn: 'Nagasaki Gunkanjima Cruise & Charter Flight',
    nameJa: '長崎軍艦島クルーズ & チャーター便連携',
    nameZh: '长崎军舰岛游船&包机联运',
    category: '체험, 크루즈',
    partner: '나가사키크루즈',
    price: 9800,
    priceChild: 6500,
    currency: 'JPY',
    status: '숨김',
    confirmType: '견적확인후확정',
    capacityPerDay: 12,
    salesCount: 22,
    createdAt: '2026-07-18',
    cancelPolicy: '이용일 7일 전까지 전액 환불, 이후 환불 불가',
    description: '유네스코 세계유산 군함섬을 둘러보는 소수 정예 크루즈 상품. 기상에 따라 일정 조율 필요.',
    transportLegs: [{ id: 'LEG-1', direction: '왕로', mode: '페리', operator: '나가사키크루즈', from: '나가사키항', to: '군함섬' }],
    meetingPoint: '나가사키항 크루즈터미널',
    meetingTime: '10:30',
    minParticipants: 4,
  },
  {
    id: 'PRD-0004',
    name: '유후인 소도시 체험 패스',
    nameEn: 'Yufuin Small-Town Experience Pass',
    nameJa: '由布院まちあるき体験パス',
    nameZh: '由布院小镇体验通票',
    category: '체험, 지역투어',
    partner: '유후인관광협회',
    price: 4500,
    currency: 'JPY',
    status: '노출중',
    confirmType: '즉시확정',
    capacityPerDay: 40,
    salesCount: 86,
    createdAt: '2026-08-18',
    cancelPolicy: '이용일 1일 전까지 전액 환불',
    description: '지역 소상공인 체험 프로그램 3종을 자유롭게 선택해 이용하는 패스.',
  },
]

export type BookingStatus =
  | '업체확인중'
  | '고객확인중'
  | '확정'
  | '거절'
  | '이용완료'
  | '취소'
  | '환불완료'

export type CustomerDecision = '대기' | '수락' | '거절'

export type Booking = {
  id: string
  productId: string
  productName: string
  partner: string
  customerName: string
  nationality: string
  useDate: string
  people: number
  amount: number
  status: BookingStatus
  confirmType: ConfirmType
  requestedAt: string
  // 견적확인후확정 상품에서만 쓰이는 견적 정보
  quoteAmount?: number
  quoteValidUntil?: string
  quoteMessage?: string
  customerDecision?: CustomerDecision
}

export const BOOKINGS: Booking[] = [
  {
    id: 'BK-20261001-A1',
    productId: 'PRD-0001',
    productName: '벳푸 온천 & 페리 연계 1일 투어',
    partner: '벳푸온천관광(주)',
    customerName: 'Emily Chen',
    nationality: '대만',
    useDate: '2026-10-15',
    people: 2,
    amount: 136000,
    status: '확정',
    confirmType: '즉시확정',
    requestedAt: '2026-10-01 09:12',
  },
  {
    id: 'BK-20261003-B2',
    productId: 'PRD-0004',
    productName: '유후인 소도시 체험 패스',
    partner: '유후인관광협회',
    customerName: 'Wang Mei',
    nationality: '중국',
    useDate: '2026-10-20',
    people: 4,
    amount: 18000,
    status: '이용완료',
    confirmType: '즉시확정',
    requestedAt: '2026-10-03 14:40',
  },
  {
    id: 'BK-20261005-C3',
    productId: 'PRD-0003',
    productName: '나가사키 군함섬 크루즈 & 전세기 연계',
    partner: '나가사키크루즈',
    customerName: 'Nguyen Lan',
    nationality: '베트남',
    useDate: '2026-10-25',
    people: 2,
    amount: 19600,
    status: '고객확인중',
    confirmType: '견적확인후확정',
    requestedAt: '2026-10-05 11:02',
    quoteAmount: 21000,
    quoteValidUntil: '2026-10-12',
    quoteMessage: '2인 기준 소형 크루즈 단독 배정, 기상 악화 시 1회 무료 일정 변경 가능합니다.',
    customerDecision: '대기',
  },
  {
    id: 'BK-20261006-D4',
    productId: 'PRD-0001',
    productName: '벳푸 온천 & 페리 연계 1일 투어',
    partner: '벳푸온천관광(주)',
    customerName: 'John Park',
    nationality: '미국',
    useDate: '2026-10-18',
    people: 1,
    amount: 68000,
    status: '업체확인중',
    confirmType: '즉시확정',
    requestedAt: '2026-10-06 20:31',
  },
  {
    id: 'BK-20260928-E5',
    productId: 'PRD-0004',
    productName: '유후인 소도시 체험 패스',
    partner: '유후인관광협회',
    customerName: 'Sato Rina',
    nationality: '일본',
    useDate: '2026-10-02',
    people: 2,
    amount: 9000,
    status: '취소',
    confirmType: '즉시확정',
    requestedAt: '2026-09-28 08:20',
  },
]

export type InquiryStatus = '답변대기' | '답변완료'

// 문의 스레드를 구성하는 메시지 1건. 고객 메시지는 원문(text)+번역(textKo)을,
// 관리자 메시지는 한국어 원문(text)+고객 언어 번역(textKo)을 담는다.
export type InquiryMessage = {
  id: string
  sender: '고객' | '관리자'
  text: string
  textKo?: string
  createdAt: string
}

export type Inquiry = {
  id: string
  productName: string
  partner: string
  customerName: string
  language: '영어' | '중국어' | '일본어' | '베트남어'
  question: string
  questionKo: string
  answer: string
  answerTranslated: string
  status: InquiryStatus
  createdAt: string
  messages: InquiryMessage[]
}

export const INQUIRIES: Inquiry[] = [
  {
    id: 'QA-0001',
    productName: '벳푸 온천 & 페리 연계 1일 투어',
    partner: '벳푸온천관광(주)',
    customerName: 'Emily Chen',
    language: '중국어',
    question: '请问这个行程可以带6岁小孩参加吗？需要额外收费吗？',
    questionKo: '이 일정에 6세 아이를 데려가도 되나요? 추가 요금이 있나요?',
    answer: '',
    answerTranslated: '',
    status: '답변대기',
    createdAt: '2026-10-06 10:15',
    messages: [
      {
        id: 'MSG-0001',
        sender: '고객',
        text: '请问这个行程可以带6岁小孩参加吗？需要额外收费吗？',
        textKo: '이 일정에 6세 아이를 데려가도 되나요? 추가 요금이 있나요?',
        createdAt: '2026-10-06 10:15',
      },
    ],
  },
  {
    id: 'QA-0002',
    productName: '유후인 소도시 체험 패스',
    partner: '유후인관광협회',
    customerName: 'Wang Mei',
    language: '중국어',
    question: '下雨天体验项目可以改期吗？',
    questionKo: '우천 시 체험 일정을 변경할 수 있나요?',
    answer: '네, 우천 시에는 이용일 기준 하루 전까지 무료로 일정 변경이 가능합니다.',
    answerTranslated: '是的，如遇雨天，可在使用日前一天免费更改日程。',
    status: '답변완료',
    createdAt: '2026-10-04 16:02',
    messages: [
      {
        id: 'MSG-0002',
        sender: '고객',
        text: '下雨天体验项目可以改期吗？',
        textKo: '우천 시 체험 일정을 변경할 수 있나요?',
        createdAt: '2026-10-04 16:02',
      },
      {
        id: 'MSG-0003',
        sender: '관리자',
        text: '네, 우천 시에는 이용일 기준 하루 전까지 무료로 일정 변경이 가능합니다.',
        textKo: '是的，如遇雨天，可在使用日前一天免费更改日程。',
        createdAt: '2026-10-04 16:40',
      },
    ],
  },
]

export type ManageType = '자체관리' | '대행관리'

export type Partner = {
  id: string
  name: string
  manager: string
  email: string
  manageType: ManageType
  active: boolean
  productCount: number
  joinedAt: string
  commissionRate: number
  // 업체별 운영정보 (2026년 10월 목표 범위 "업체별 운영정보 관리" 항목, 전부 선택 입력)
  businessRegistrationNumber?: string
  phone?: string
  address?: string
  bankAccount?: string
  memo?: string
}

export const PARTNERS: Partner[] = [
  {
    id: 'PT-001',
    name: '벳푸온천관광(주)',
    manager: '다나카 유키',
    email: 'tanaka@beppu-tour.jp',
    manageType: '자체관리',
    active: true,
    productCount: 3,
    joinedAt: '2026-08-20',
    commissionRate: 12,
    businessRegistrationNumber: '501-81-23456',
    phone: '+81-977-21-1234',
    address: '오이타현 벳푸시 간나와 1-2-3',
    bankAccount: '미즈호은행 벳푸지점 1234567',
    memo: '온천 체험 프로그램 성수기(7~9월) 예약 폭주, 응대 지연 주의',
  },
  {
    id: 'PT-002',
    name: '유후인관광협회',
    manager: '사토 리나',
    email: 'sato@yufuin-assoc.jp',
    manageType: '자체관리',
    active: true,
    productCount: 2,
    joinedAt: '2026-08-18',
    commissionRate: 10,
  },
  {
    id: 'PT-003',
    name: '나가사키크루즈',
    manager: '일본관광연맹 사무국 (대행)',
    email: 'office@jp-tourism-federation.or.jp',
    manageType: '대행관리',
    active: true,
    productCount: 1,
    joinedAt: '2026-07-15',
    commissionRate: 15,
  },
  {
    id: 'PT-004',
    name: '고토열도 소규모 민박',
    manager: '일본관광연맹 사무국 (대행)',
    email: 'office@jp-tourism-federation.or.jp',
    manageType: '대행관리',
    active: false,
    productCount: 0,
    joinedAt: '2026-09-30',
    commissionRate: 15,
  },
]

export type SettlementStatus = '지급대기' | '지급완료'

export type SettlementRow = {
  partner: string
  gross: number
  commissionRate: number
  commission: number
  net: number
  bookingCount: number
  status: SettlementStatus
  payDate: string | null
}

export const SETTLEMENTS: SettlementRow[] = [
  { partner: '벳푸온천관광(주)', gross: 952000, commissionRate: 12, commission: 114240, net: 837760, bookingCount: 14, status: '지급완료', payDate: '2026-10-05' },
  { partner: '유후인관광협회', gross: 387000, commissionRate: 10, commission: 38700, net: 348300, bookingCount: 9, status: '지급완료', payDate: '2026-10-05' },
  { partner: '나가사키크루즈', gross: 196000, commissionRate: 15, commission: 29400, net: 166600, bookingCount: 2, status: '지급대기', payDate: null },
]

export const LANGUAGES = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
] as const
