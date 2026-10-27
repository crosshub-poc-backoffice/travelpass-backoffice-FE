// 고객 문의 언어. 서버(번역 호출)와 화면(라벨 표시) 양쪽에서 쓴다 — 'server-only' 아님.
export const INQUIRY_LANGUAGES = ['en', 'zh', 'ja', 'vi'] as const
export type InquiryLanguageCode = (typeof INQUIRY_LANGUAGES)[number]

// BE inquiry/InquiryTranslateController 가 번역 대상 언어로 받는 한글 라벨과 맞춘다
export const INQUIRY_LANGUAGE_LABEL: Record<InquiryLanguageCode, string> = {
  en: '영어',
  zh: '중국어',
  ja: '일본어',
  vi: '베트남어',
}
