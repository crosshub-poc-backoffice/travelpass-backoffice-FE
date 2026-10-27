import 'server-only'
import { env } from '@/lib/env.mjs'
import { createClient, type RedisClientType } from 'redis'

/**
 * FE 전용 세션 저장소 (Redis). 로그인 세션과 Keycloak 토큰(암호화된 값)을 둔다.
 * 리소스 DB(BE 소유)에는 세션을 두지 않는다 — docs/auth-architecture.md(BE 레포) 원칙 6.
 *
 * 키 구조
 *   sess:<sessionId>  JSON(StoredSession). 만료 = expiresAt (Keycloak refresh 수명)
 *   user:<userId>     그 계정의 sessionId 집합  → 비활성화·비번 초기화 때 전부 끊기
 *   sid:<kcSid>       Keycloak SSO 세션별 집합   → 백채널 로그아웃(sid)
 *   sub:<kcSub>       Keycloak 유저별 집합       → 백채널 로그아웃(sub)
 * 집합 키의 만료는 그 안의 세션 중 가장 늦은 만료로 맞춘다 (PEXPIREAT GT).
 *
 * 로컬: infra/redis/docker-compose.yml (redis://localhost:6379). 운영: Upstash (REDIS_URL=rediss://...).
 */
export type StoredSession = {
  userId: string
  loginId: string
  activePartnerId: string | null
  /** 세션 만료 (ms epoch). Keycloak refresh 수명 */
  expiresAt: number
  createdAt: number
  kcAccessToken: string
  kcAccessExpiresAt: number
  kcRefreshToken: string | null
  kcIdToken: string | null
  kcSid: string | null
  kcSub: string | null
}

const SESS = (id: string) => `sess:${id}`
const USER = (userId: string) => `user:${userId}`
const SID = (sid: string) => `sid:${sid}`
const SUB = (sub: string) => `sub:${sub}`

// 개발 중 핫리로드로 연결이 늘어나지 않게 전역 1개
const g = globalThis as unknown as { sessionRedis?: RedisClientType; sessionRedisReady?: Promise<RedisClientType> }

async function redis(): Promise<RedisClientType> {
  if (g.sessionRedisReady) return g.sessionRedisReady
  const client = createClient({ url: env('REDIS_URL') }) as RedisClientType
  client.on('error', (e) => console.error('[session-store] redis error', e?.message ?? e))
  g.sessionRedis = client
  g.sessionRedisReady = client.connect().then(() => client)
  return g.sessionRedisReady
}

function indexKeys(s: Pick<StoredSession, 'userId' | 'kcSid' | 'kcSub'>): string[] {
  return [USER(s.userId), ...(s.kcSid ? [SID(s.kcSid)] : []), ...(s.kcSub ? [SUB(s.kcSub)] : [])]
}

export async function createStoredSession(id: string, s: StoredSession): Promise<void> {
  const r = await redis()
  const m = r.multi()
  m.set(SESS(id), JSON.stringify(s), { PXAT: s.expiresAt })
  for (const k of indexKeys(s)) {
    m.sAdd(k, id)
    m.pExpireAt(k, s.expiresAt, 'GT')
  }
  await m.exec()
}

export async function getStoredSession(id: string): Promise<StoredSession | null> {
  const raw = await (await redis()).get(SESS(id))
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as StoredSession
    return s.expiresAt > Date.now() ? s : null
  } catch {
    return null
  }
}

/** 일부 필드 갱신 (토큰 refresh, 업체 전환). 만료는 patch.expiresAt 이 있으면 그걸로, 없으면 기존 값 유지 */
export async function updateStoredSession(id: string, patch: Partial<StoredSession>): Promise<StoredSession | null> {
  const current = await getStoredSession(id)
  if (!current) return null
  const next = { ...current, ...patch }
  const r = await redis()
  const m = r.multi()
  m.set(SESS(id), JSON.stringify(next), { PXAT: next.expiresAt })
  if (next.expiresAt !== current.expiresAt) for (const k of indexKeys(next)) m.pExpireAt(k, next.expiresAt, 'GT')
  await m.exec()
  return next
}

export async function deleteStoredSession(id: string): Promise<StoredSession | null> {
  const r = await redis()
  const raw = await r.get(SESS(id))
  const s = raw ? (JSON.parse(raw) as StoredSession) : null
  const m = r.multi()
  m.del(SESS(id))
  if (s) for (const k of indexKeys(s)) m.sRem(k, id)
  await m.exec()
  return s
}

async function deleteAllIn(indexKey: string): Promise<number> {
  const r = await redis()
  const ids = await r.sMembers(indexKey)
  let n = 0
  for (const id of ids) if (await deleteStoredSession(id)) n++
  await r.del(indexKey)
  return n
}

/** 그 계정의 FE 세션 전부 끊기 (비활성화·비번 초기화) */
export const deleteSessionsByUser = (userId: string) => deleteAllIn(USER(userId))
/** 백채널 로그아웃: Keycloak SSO 세션(sid) 하나 */
export const deleteSessionsBySid = (sid: string) => deleteAllIn(SID(sid))
/** 백채널 로그아웃: 그 Keycloak 유저(sub)의 세션 전부 */
export const deleteSessionsBySub = (sub: string) => deleteAllIn(SUB(sub))

/** 테스트·헬스체크용 */
export async function pingSessionStore(): Promise<boolean> {
  try {
    return (await (await redis()).ping()) === 'PONG'
  } catch {
    return false
  }
}
