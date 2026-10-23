import 'server-only'
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto'

// Keycloak(crosshub realm, poc-backoffice — Confidential + PKCE) 연동 공용 코드.
// 로그인 시작(login route)·콜백(callback route)·세션 갱신(session.ts)·로그아웃(actions/auth.ts)이 같이 쓴다.

export const keycloakConfig = () => ({
  issuer: process.env.KEYCLOAK_ISSUER_URI ?? 'http://localhost:8080/realms/crosshub',
  clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'poc-backoffice',
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',
})

/** 로그인 1회용 값: state(CSRF), nonce(id_token 재사용 방지), PKCE verifier/challenge */
export function newLoginRequest() {
  const state = randomBytes(16).toString('base64url')
  const nonce = randomBytes(16).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url') // 43자 — RFC 7636 최소 길이 충족
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { state, nonce, codeVerifier, codeChallenge }
}

export type KeycloakTokens = {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_expires_in?: number // 0이면 오프라인 토큰(만료 없음)
  id_token?: string
}

async function tokenRequest(params: Record<string, string>): Promise<KeycloakTokens | null> {
  const { issuer, clientId, clientSecret } = keycloakConfig()
  try {
    const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json()) as KeycloakTokens
    return json.access_token ? json : null
  } catch {
    return null
  }
}

/** Authorization Code → 토큰. client_secret(앱 증명) + code_verifier(PKCE) 둘 다 보낸다. */
export function exchangeCode(code: string, redirectUri: string, codeVerifier: string) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier })
}

/** refresh_token으로 재발급. Keycloak에서 계정이 비활성화되거나 세션이 끊겼으면 null. */
export function refreshTokens(refreshToken: string) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

// ---- id_token 서명 검증 (JWKS) ----

type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string }
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null
const JWKS_TTL_MS = 10 * 60 * 1000

async function getJwks(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys
  const { issuer } = keycloakConfig()
  const res = await fetch(`${issuer}/protocol/openid-connect/certs`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`JWKS ${res.status}`)
  const { keys } = (await res.json()) as { keys: Jwk[] }
  jwksCache = { keys, fetchedAt: Date.now() }
  return keys
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

/**
 * Keycloak이 발급한 JWT의 서명(RS256, JWKS)·iss·aud(=poc-backoffice)를 확인하고 payload를 돌려준다. 틀리면 null.
 * 키 회전 대비: kid가 캐시에 없으면 JWKS를 한 번 새로 받는다.
 */
async function verifyKeycloakJwt(token: string): Promise<Record<string, unknown> | null> {
  const { issuer, clientId } = keycloakConfig()
  try {
    const [h, p, sig] = token.split('.')
    if (!h || !p || !sig) return null
    const header = decodePart(h) as { alg?: string; kid?: string }
    if (header.alg !== 'RS256') return null

    let jwk = (await getJwks()).find((k) => k.kid === header.kid)
    if (!jwk) jwk = (await getJwks(true)).find((k) => k.kid === header.kid)
    if (!jwk) return null

    const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'))
    if (!ok) return null

    const payload = decodePart(p)
    const aud = payload.aud
    const audOk = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId
    if (payload.iss !== issuer || !audOk) return null
    return payload
  } catch {
    return null
  }
}

/** id_token 검증: 서명·iss·aud + exp + nonce(이번 로그인 값) */
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<Record<string, unknown> | null> {
  const payload = await verifyKeycloakJwt(idToken)
  if (!payload) return null
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now - 30) return null
  if (payload.nonce !== expectedNonce) return null
  return payload
}

const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

/**
 * 백채널 로그아웃 토큰 검증 (OIDC Back-Channel Logout 1.0 §2.6).
 * 서명·iss·aud + iat가 최근 + events에 backchannel-logout + sid 또는 sub + nonce 없음. 맞으면 { sid, sub }.
 */
export async function verifyLogoutToken(token: string): Promise<{ sid: string | null; sub: string | null } | null> {
  const payload = await verifyKeycloakJwt(token)
  if (!payload) return null
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.iat !== 'number' || payload.iat < now - 300 || payload.iat > now + 60) return null
  const events = payload.events as Record<string, unknown> | undefined
  if (!events || typeof events !== 'object' || !(BACKCHANNEL_LOGOUT_EVENT in events)) return null
  if ('nonce' in payload) return null
  const sid = typeof payload.sid === 'string' ? payload.sid : null
  const sub = typeof payload.sub === 'string' ? payload.sub : null
  if (!sid && !sub) return null
  return { sid, sub }
}

/** Keycloak 로그아웃(SSO 세션 종료) 주소. id_token_hint를 주면 확인 화면 없이 바로 돌아온다. */
export function logoutUrl(idToken: string | null, postLogoutRedirect: string) {
  const { issuer, clientId } = keycloakConfig()
  const url = new URL(`${issuer}/protocol/openid-connect/logout`)
  if (idToken) url.searchParams.set('id_token_hint', idToken)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirect)
  return url.toString()
}

/** Keycloak 계정 콘솔(비밀번호 변경 등). Keycloak 로그인 사용자는 비밀번호를 여기서 바꾼다. */
export function accountConsoleUrl() {
  return `${keycloakConfig().issuer}/account/#/security/signingin`
}
