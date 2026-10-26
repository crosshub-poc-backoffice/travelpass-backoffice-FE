import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createHash, randomBytes } from 'node:crypto'
import { canAccess, canEdit, type Menu, type Role } from '@/lib/permissions'
import { backend, BackendError, backendWithToken } from '@/lib/api/backend'
import { SESSION_COOKIE } from './cookie'
import { refreshTokens, type KeycloakTokens } from './keycloak'
import {
  createStoredSession, deleteStoredSession, getStoredSession, updateStoredSession, type StoredSession,
} from './session-store'
import { decryptToken, encryptToken } from './token-crypto'
import { recordAccess } from '@/lib/server/audit/access'
import type { AccessKind } from '@/lib/audit'

// 세션은 FE 전용 Redis(session-store.ts)에, 로그인한 사람의 역할·업체 범위는 BE GET /api/v1/me 로 받는다.
// 이 파일은 리소스 DB(Prisma)를 쓰지 않는다.

const DEFAULT_MS = 12 * 60 * 60 * 1000 // Keycloak이 refresh 수명을 안 주면(오프라인 토큰 등) 12시간
const ACCESS_REFRESH_MARGIN_MS = 30 * 1000 // access token 만료 30초 전부터 미리 갱신

/** Keycloak 토큰 → 저장 필드(토큰은 AES-GCM 암호화). 세션 만료는 Keycloak refresh 수명(SSO idle)을 따른다 */
function kcFields(tokens: KeycloakTokens, previous?: { kcIdToken: string | null }) {
  const now = Date.now()
  return {
    kcAccessToken: encryptToken(tokens.access_token),
    kcAccessExpiresAt: now + tokens.expires_in * 1000,
    kcRefreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
    // refresh 응답에 id_token이 없으면 기존 것(암호화된 값)을 유지 (로그아웃 id_token_hint용)
    kcIdToken: tokens.id_token ? encryptToken(tokens.id_token) : (previous?.kcIdToken ?? null),
    expiresAt: now + (tokens.refresh_expires_in && tokens.refresh_expires_in > 0 ? tokens.refresh_expires_in * 1000 : DEFAULT_MS),
  }
}

// 저장소에는 쿠키 값 대신 해시를 키로 써서, 저장소가 새도 세션을 가로챌 수 없게 한다
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

/** BE /api/v1/me 응답 — 로그인한 직원의 역할·소속·업체 범위 (DB 기준) */
export type Me = {
  id: string
  loginId: string
  name: string
  role: Role
  affiliateId: string | null
  partnerId: string | null
  orgName: string | null
  managedPartners: PartnerRef[]
}

/**
 * access token 으로 BE 에 "나는 누구인가"를 묻는다.
 * - 200: Me
 * - 403 roleMismatch: 토큰 role ≠ DB role → 'roleMismatch'
 * - 그 밖의 401/403/404(미등록·비활성): null
 * - 5xx·네트워크: 던진다 (BE 장애를 로그아웃으로 오해하지 않게)
 */
export async function fetchMe(accessToken: string): Promise<Me | null | 'roleMismatch'> {
  try {
    return await backendWithToken<Me>('/api/v1/me', accessToken)
  } catch (e) {
    if (e instanceof BackendError && e.status === 403 && e.code === 'roleMismatch') return 'roleMismatch'
    if (e instanceof BackendError && [401, 403, 404].includes(e.status)) return null
    throw e
  }
}

/** Keycloak 로그인 직후 세션 생성. 토큰은 암호화해 Redis 에 보관하고, 세션 수명은 Keycloak을 따른다 */
export async function createSession(me: Pick<Me, 'id' | 'loginId'>, kcTokens: KeycloakTokens, ids: { sid: string | null; sub: string | null }) {
  const token = randomBytes(32).toString('base64url')
  const stored: StoredSession = {
    userId: me.id,
    loginId: me.loginId,
    activePartnerId: null,
    createdAt: Date.now(),
    kcSid: ids.sid,
    kcSub: ids.sub,
    ...kcFields(kcTokens),
  }
  await createStoredSession(hashToken(token), stored)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // 만료일 없는 쿠키 — 브라우저를 닫으면 사라진다. 실제 수명은 저장소의 expiresAt(Keycloak 기준)이 정한다
  })
}

/** 지금 세션을 지운다. 로그아웃 id_token_hint용으로 (복호화한) id_token을 돌려준다 */
export async function deleteCurrentSession(): Promise<{ idToken: string | null }> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  let idToken: string | null = null
  if (token) {
    const removed = await deleteStoredSession(hashToken(token))
    idToken = decryptToken(removed?.kcIdToken ?? null)
  }
  cookieStore.delete(SESSION_COOKIE)
  return { idToken }
}

/** 업체 전환으로 고른 업체를 세션에 저장하고 작업 이력(BE)에 남긴다. 권한 확인은 호출하는 쪽에서 한다. */
export async function setActivePartner(user: SessionUser, partnerId: string | null) {
  await updateStoredSession(user.sessionId, { activePartnerId: partnerId })
  // partnerId가 null이면 "전체 보기"로 돌아간 것. 이력은 BE 가 scope_switch 로 남긴다 (관리 범위 밖 업체면 404)
  await backend.post('/api/v1/me/scope-switch', { partnerId })
}

export type PartnerRef = { id: string; name: string }

export type SessionUser = {
  sessionId: string
  id: string
  loginId: string
  name: string
  role: Role
  affiliateId: string | null
  partnerId: string | null
  /** 소속 이름 (연맹 이름 또는 업체 이름). 크로스허브는 null */
  orgName: string | null
  /** 이 계정이 다룰 수 있는 업체. 크로스허브는 전체, 연맹은 대행 업체, 업체는 자기 업체 */
  managedPartners: PartnerRef[]
  /** 업체 전환으로 고른 업체. null이면 관리 범위 전체. 업체 계정은 자기 업체 고정 */
  activePartnerId: string | null
}

type LoadedSession = { user: SessionUser; accessToken: string }

// 요청 한 번 안에서는 결과를 재사용한다 (React cache)
const loadSession = cache(async (): Promise<LoadedSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const sessionId = hashToken(token)

  const session = await getStoredSession(sessionId)
  if (!session) return null

  // 토큰 복호화. 복호화가 안 되면(키 변경·변조) 세션을 버린다
  const dropSession = async () => {
    await deleteStoredSession(sessionId)
    return null
  }
  const refreshToken = decryptToken(session.kcRefreshToken)
  let accessToken = decryptToken(session.kcAccessToken)
  if (!refreshToken || !accessToken) return dropSession()

  // access token이 곧 만료면 refresh. 실패 = Keycloak에서 계정 비활성화·세션 종료 → 여기서도 로그아웃
  const expiring = session.kcAccessExpiresAt - Date.now() < ACCESS_REFRESH_MARGIN_MS
  if (expiring) {
    const refreshed = await refreshTokens(refreshToken)
    if (!refreshed) return dropSession()
    await updateStoredSession(sessionId, kcFields(refreshed, session))
    accessToken = refreshed.access_token
  }

  // 역할·소속·업체 범위는 권한이라 요청마다 BE 에 새로 묻는다 (세션에 저장해 두면 업체 등록·운영방식 변경이 다시 로그인할 때까지 반영되지 않는다)
  const me = await fetchMe(accessToken)
  // 토큰 role ≠ DB role: 어느 화면도 쓸 수 없는 상태라 세션·SSO 를 끊고 안내한다
  if (me === 'roleMismatch') redirect('/api/auth/role-mismatch')
  // 미등록·비활성(BE 403) 또는 토큰 거절(401) → 로그아웃
  if (!me) return dropSession()

  const activePartnerId =
    me.role === 'partner'
      ? (me.managedPartners[0]?.id ?? null)
      : me.managedPartners.some((p) => p.id === session.activePartnerId)
        ? session.activePartnerId
        : null

  return {
    accessToken,
    user: {
      sessionId,
      id: me.id,
      loginId: me.loginId,
      name: me.name,
      role: me.role,
      affiliateId: me.affiliateId,
      partnerId: me.partnerId,
      orgName: me.orgName,
      managedPartners: me.managedPartners,
      activePartnerId,
    },
  }
})

export const getSessionUser = cache(async (): Promise<SessionUser | null> => (await loadSession())?.user ?? null)

/** BE 호출용 Keycloak access token (필요하면 이미 갱신된 값). 로그인 안 했으면 null */
export async function getAccessToken(): Promise<string | null> {
  return (await loadSession())?.accessToken ?? null
}

/** 지금 언어를 붙인 주소. 예: '/dashboard' → '/ko/dashboard' */
export async function localePath(path: string) {
  return `/${await getLocale()}${path === '/' ? '' : path}`
}

/** 로그인 안 했으면 로그인 화면으로 보낸다. (임시 비밀번호 변경은 Keycloak이 로그인 중에 강제한다) */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect(await localePath('/'))
  return user
}

/** 메뉴 권한까지 확인한다. 권한이 없으면 대시보드로 보낸다.
 *  access: 접근 기록에 남길 행위. 기본은 조회 권한이면 목록, 수정 권한이면 수정.
 *  상세 화면은 'view', 등록·삭제 Server Action은 'create'·'delete'를 넘긴다 */
export async function requireMenu(menu: Menu, level: 'read' | 'edit' = 'read', access?: AccessKind): Promise<SessionUser> {
  const user = await requireUser()
  const allowed = level === 'edit' ? canEdit(user.role, menu) : canAccess(user.role, menu)
  if (!allowed) redirect(await localePath('/dashboard'))
  await recordAccess(user.id, menu, access ?? (level === 'edit' ? 'update' : 'list'))
  return user
}

/** 지금 화면에서 다룰 업체 id 목록. 업체를 골랐으면 그 업체만, 아니면 관리 범위 전체 */
export function visiblePartnerIds(user: SessionUser): string[] {
  return user.activePartnerId ? [user.activePartnerId] : user.managedPartners.map((p) => p.id)
}

/** 화면(클라이언트)에 넘겨도 되는 값만 추린다 */
export function toClientSession(user: SessionUser) {
  return {
    loginId: user.loginId,
    name: user.name,
    role: user.role,
    orgName: user.orgName,
    managedPartners: user.managedPartners,
    activePartnerId: user.activePartnerId,
  }
}
