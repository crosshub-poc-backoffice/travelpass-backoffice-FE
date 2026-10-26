// FE 세션 저장소(Redis) — 로컬 Redis(infra/redis) 가 떠 있을 때만 돈다. 없으면 건너뛴다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createStoredSession, deleteSessionsBySid, deleteSessionsByUser, deleteStoredSession, getStoredSession,
  pingSessionStore, updateStoredSession, type StoredSession,
} from '../lib/server/auth/session-store'

const uid = `test-user-${Date.now()}`
const base = (id: string, sid: string): StoredSession => ({
  userId: uid, loginId: 'test', activePartnerId: null, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
  kcAccessToken: 'enc-access', kcAccessExpiresAt: Date.now() + 300_000, kcRefreshToken: 'enc-refresh', kcIdToken: null,
  kcSid: sid, kcSub: 'sub-1',
})

// tsx(cjs) 는 top-level await 를 못 써서 각 테스트 안에서 Redis 유무를 본다
const noRedis = async (t: { skip: (m?: string) => void }) => { if (await pingSessionStore()) return false; t.skip('Redis 없음'); return true }

test('만들고 → 읽고 → 일부 갱신 → 지우기', async (t) => {
  if (await noRedis(t)) return
  await createStoredSession('s1', base('s1', 'sid-a'))
  assert.equal((await getStoredSession('s1'))?.loginId, 'test')
  const updated = await updateStoredSession('s1', { activePartnerId: 'p1' })
  assert.equal(updated?.activePartnerId, 'p1')
  assert.equal((await getStoredSession('s1'))?.kcRefreshToken, 'enc-refresh') // 다른 필드는 유지
  const removed = await deleteStoredSession('s1')
  assert.equal(removed?.userId, uid)
  assert.equal(await getStoredSession('s1'), null)
})

test('만료 지난 세션은 null', async (t) => {
  if (await noRedis(t)) return
  await createStoredSession('s-old', { ...base('s-old', 'sid-old'), expiresAt: Date.now() + 50 })
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(await getStoredSession('s-old'), null)
})

test('sid 로 하나만, userId 로 전부 끊기', async (t) => {
  if (await noRedis(t)) return
  await createStoredSession('s2', base('s2', 'sid-b'))
  await createStoredSession('s3', base('s3', 'sid-c'))
  assert.equal(await deleteSessionsBySid('sid-b'), 1)
  assert.equal(await getStoredSession('s2'), null)
  assert.ok(await getStoredSession('s3'))
  assert.equal(await deleteSessionsByUser(uid), 1)
  assert.equal(await getStoredSession('s3'), null)
  process.exit(0) // redis 연결이 이벤트 루프를 잡고 있어 테스트 러너가 안 끝난다
})
