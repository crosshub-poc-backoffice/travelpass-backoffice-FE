// 상품 등록 때 자동으로 넣는 기본 섹션 제목·금액 열 이름 (언어별).
// 상품 데이터로 저장되는 값이라 messages가 아니라 여기 둔다 — 다른 언어로 저장된 기본 제목도 알아봐서
// 지금 화면 언어로 바꿔 보여줘야 하기 때문 (일본어로 등록한 "行程表"를 한국어 화면에서 "일정표"로)

import type { Locale } from '@/i18n/routing'

export type DefaultTitleKind = 'amountColumn' | 'itinerary' | 'program' | 'transport' | 'lodging'

export const DEFAULT_TITLES: Record<Locale, Record<DefaultTitleKind, string>> = {
  ko: { amountColumn: '금액', itinerary: '일정표', program: '프로그램', transport: '교통수단', lodging: '숙박 정보' },
  en: { amountColumn: 'Price', itinerary: 'Itinerary', program: 'Program', transport: 'Transportation', lodging: 'Accommodation' },
  ja: { amountColumn: '金額', itinerary: '行程表', program: 'プログラム', transport: '交通手段', lodging: '宿泊情報' },
  'zh-CN': { amountColumn: '金额', itinerary: '行程表', program: '活动项目', transport: '交通方式', lodging: '住宿信息' },
  'zh-TW': { amountColumn: '金額', itinerary: '行程表', program: '活動項目', transport: '交通方式', lodging: '住宿資訊' },
  vi: { amountColumn: 'Giá', itinerary: 'Lịch trình', program: 'Chương trình', transport: 'Phương tiện', lodging: 'Thông tin lưu trú' },
}

/** 어느 언어든 기본 제목이면 그 종류, 직접 쓴 제목이면 null */
export function defaultTitleKind(title: string): DefaultTitleKind | null {
  for (const names of Object.values(DEFAULT_TITLES)) {
    const hit = (Object.keys(names) as DefaultTitleKind[]).find((k) => names[k] === title)
    if (hit) return hit
  }
  return null
}

/** 기본 제목이면 화면 언어로, 아니면 그대로 */
export function displayTitle(title: string, locale: string): string {
  const kind = defaultTitleKind(title)
  return kind ? (DEFAULT_TITLES[locale as Locale] ?? DEFAULT_TITLES.ko)[kind] : title
}
