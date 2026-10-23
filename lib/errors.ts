import koMessages from '@/messages/ko.json'

// Server Action이 돌려주는 오류 코드. 화면에서 t(`errors.${코드}`)로 보여준다 (messages/*.json의 errors).
export type ErrorKey = keyof (typeof koMessages)['errors']

const ERROR_KEYS = new Set(Object.keys(koMessages.errors))

/** 쿼리스트링처럼 타입 없는 값으로 들어온 문자열이 실제 에러 코드인지 (URL 조작 방어) */
export function isErrorKey(value: string | undefined): value is ErrorKey {
  return !!value && ERROR_KEYS.has(value)
}
