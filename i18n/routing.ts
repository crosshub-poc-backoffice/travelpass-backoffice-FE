import { defineRouting } from 'next-intl/routing'

// 다국어 라우팅 설정. travelpass-website(src/i18n/routing.ts)와 동일한 패턴.
export const routing = defineRouting({
  // 표준 언어 코드: 일본어는 ja, 중국어는 간체 zh-CN · 번체 zh-TW, 베트남어는 vi.
  locales: ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'vi'],
  // 백오피스는 크로스허브(한국 법인) 운영팀이 기본 사용자라 기본 언어는 한국어.
  // (website는 방한 외국인 대상이라 en 기본 — 그 프로젝트와 다른 부분)
  defaultLocale: 'ko',
  // 모든 주소에 언어를 붙인다: /ko/dashboard
  localePrefix: 'always',
  // 사용자가 직접 고른 언어를 1년간 기억한다.
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
})

export type Locale = (typeof routing.locales)[number]

// 언어 선택 UI에 보이는 이름. 각 언어의 자기 표기라서 번역하지 않는다.
export const LOCALE_LABELS: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  vi: 'Tiếng Việt',
}
