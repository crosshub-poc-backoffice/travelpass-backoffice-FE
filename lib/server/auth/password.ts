// 계정 발급·초기화 때 Keycloak에 넣는 임시 비밀번호 생성. (비밀번호 저장·검증은 Keycloak이 한다)
import { randomInt } from 'node:crypto'

// 계정 발급·초기화 때 주는 임시 비밀번호. 헷갈리는 글자(0/O, 1/l/I)는 뺐다.
// Keycloak 비밀번호 정책(영문·숫자·특수문자 각 1개 이상, crosshub-realm.json passwordPolicy)을 통과하도록
// 영문·숫자·특수문자를 최소 1개씩 넣고 섞는다 — 안 그러면 Admin API가 임시 비밀번호를 거부한다.
const TEMP_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'
const TEMP_DIGITS = '23456789'
const TEMP_SPECIALS = '!@#$%*?'
const TEMP_CHARS = TEMP_LETTERS + TEMP_DIGITS + TEMP_SPECIALS

const pick = (chars: string) => chars[randomInt(chars.length)]

export function generateTempPassword(length = 12): string {
  const chars = [pick(TEMP_LETTERS), pick(TEMP_DIGITS), pick(TEMP_SPECIALS)]
  while (chars.length < length) chars.push(pick(TEMP_CHARS))
  // Fisher–Yates로 섞어 필수 문자가 항상 앞에 오지 않게
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
