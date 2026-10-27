// 인증 단위 테스트: 세션 토큰 암호화, 백채널 로그아웃 토큰 검증.
// 실행: npm test   ('server-only'를 통과시키려고 react-server 조건으로 돈다)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'

process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.KEYCLOAK_OFFICE_ISSUER_URI = 'http://kc.test/realms/tp-office'
process.env.KEYCLOAK_CLIENT_ID = 'tp-office-partner-web'
process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret'

// ---------- 토큰 암호화 ----------
test('encrypt → decrypt 하면 원래 값', async () => {
  const { encryptToken, decryptToken } = await import('../lib/server/auth/token-crypto')
  const enc = encryptToken('eyJ.access.token')
  assert.notEqual(enc, 'eyJ.access.token')
  assert.ok(enc.startsWith('v1.'))
  assert.equal(decryptToken(enc), 'eyJ.access.token')
})

test('같은 값도 매번 다른 암호문 (IV 랜덤)', async () => {
  const { encryptToken } = await import('../lib/server/auth/token-crypto')
  assert.notEqual(encryptToken('same'), encryptToken('same'))
})

test('변조·평문·다른 키는 null', async () => {
  const { encryptToken, decryptToken } = await import('../lib/server/auth/token-crypto')
  const enc = encryptToken('secret-token')
  const parts = enc.split('.')
  const flipped = Buffer.from(parts[3], 'base64url')
  flipped[0] ^= 1
  assert.equal(decryptToken([parts[0], parts[1], parts[2], flipped.toString('base64url')].join('.')), null)
  assert.equal(decryptToken('eyJ.plain.old-session'), null)
  assert.equal(decryptToken(null), null)
  const prev = process.env.SESSION_ENCRYPTION_KEY
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  assert.equal(decryptToken(enc), null)
  process.env.SESSION_ENCRYPTION_KEY = prev
})

// ---------- 백채널 로그아웃 토큰 ----------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' }
globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as typeof fetch

function sign(payload: Record<string, unknown>, key = privateKey) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const data = `${b64({ alg: 'RS256', kid: 'test-kid', typ: 'logout+jwt' })}.${b64(payload)}`
  const sig = createSign('RSA-SHA256').update(data).sign(key).toString('base64url')
  return `${data}.${sig}`
}
const now = () => Math.floor(Date.now() / 1000)
const valid = () => ({
  iss: 'http://kc.test/realms/tp-office', aud: 'tp-office-partner-web', iat: now(), sid: 'sid-1', sub: 'sub-1',
  events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
})

test('정상 logout token → sid/sub', async () => {
  const { verifyLogoutToken } = await import('../lib/server/auth/keycloak')
  assert.deepEqual(await verifyLogoutToken(sign(valid())), { sid: 'sid-1', sub: 'sub-1' })
})

test('거부: 다른 키 서명 / 다른 issuer / 다른 aud / event 없음 / nonce 있음 / 오래된 iat', async () => {
  const { verifyLogoutToken } = await import('../lib/server/auth/keycloak')
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  assert.equal(await verifyLogoutToken(sign(valid(), other)), null)
  assert.equal(await verifyLogoutToken(sign({ ...valid(), iss: 'http://evil/realms/x' })), null)
  assert.equal(await verifyLogoutToken(sign({ ...valid(), aud: 'tp-office-partner-svc' })), null)
  assert.equal(await verifyLogoutToken(sign({ ...valid(), events: {} })), null)
  assert.equal(await verifyLogoutToken(sign({ ...valid(), nonce: 'x' })), null)
  assert.equal(await verifyLogoutToken(sign({ ...valid(), iat: now() - 3600 })), null)
  assert.equal(await verifyLogoutToken('not.a.jwt'), null)
})
