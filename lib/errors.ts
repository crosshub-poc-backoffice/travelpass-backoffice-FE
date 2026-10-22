import type ko from '@/messages/ko.json'

// Server Action이 돌려주는 오류 코드. 화면에서 t(`errors.${코드}`)로 보여준다 (messages/*.json의 errors).
export type ErrorKey = keyof (typeof ko)['errors']
