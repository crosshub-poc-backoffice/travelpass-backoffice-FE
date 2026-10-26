import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Session에 저장하는 Keycloak 토큰(access/refresh/id) 암호화. AES-256-GCM.
// DB가 유출돼도 키(SESSION_ENCRYPTION_KEY, 환경변수)가 없으면 토큰을 쓸 수 없다.
// 저장 형식: v1.<iv>.<tag>.<ciphertext> (각 base64url). 키를 바꾸면 기존 세션은 복호화 실패 → 로그아웃된다.

const VERSION = 'v1'

function key(): Buffer {
  const raw = process.env.SESSION_ENCRYPTION_KEY
  if (!raw) throw new Error('SESSION_ENCRYPTION_KEY 환경변수가 필요합니다 (openssl rand -base64 32)')
  const k = Buffer.from(raw, 'base64')
  if (k.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY는 32바이트(base64)여야 합니다')
  return k
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

/** 복호화. 형식이 다르거나(예전 평문·다른 키) 변조됐으면 null */
export function decryptToken(stored: string | null): string | null {
  if (!stored) return null
  const [v, iv, tag, ct] = stored.split('.')
  if (v !== VERSION || !iv || !tag || !ct) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
