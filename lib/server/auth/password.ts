// 비밀번호 해시. Node 기본 scrypt를 써서 추가 라이브러리가 없다.
// 시드 스크립트에서도 쓰므로 'server-only'를 붙이지 않는다 (node:crypto라 브라우저 번들에는 못 들어간다).
import { randomBytes, randomInt, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto'

const KEY_LENGTH = 64

function derive(password: BinaryLike, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

// 저장 형식: scrypt$<salt>$<hash> (base64)
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false
  const expected = Buffer.from(keyB64, 'base64')
  const actual = await derive(password, Buffer.from(saltB64, 'base64'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// 계정 발급·초기화 때 주는 임시 비밀번호. 헷갈리는 글자(0/O, 1/l/I)는 뺐다.
const TEMP_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

export function generateTempPassword(length = 12): string {
  return Array.from({ length }, () => TEMP_CHARS[randomInt(TEMP_CHARS.length)]).join('')
}

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/** 새 비밀번호 규칙: 8~128자, 영문·숫자·특수문자를 모두 넣고, 아이디는 넣을 수 없다 */
export function checkNewPassword(password: string, loginId: string): 'pwRule' | 'pwHasId' | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return 'pwRule'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return 'pwRule'
  if (password.toLowerCase().includes(loginId.toLowerCase())) return 'pwHasId'
  return null
}
