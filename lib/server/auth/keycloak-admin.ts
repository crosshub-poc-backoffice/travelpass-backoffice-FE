import 'server-only'
import type { Role } from '@/lib/permissions'
import { keycloakConfig } from './keycloak'

// 계정 발급(A-2): 백오피스 계정 관리 화면 → 서버 → Keycloak Admin API.
// backoffice-admin-api(service account, client credentials)로 호출한다.
// 필요한 권한: realm-management manage-users + query-clients, 그리고 fine-grained 권한으로 poc-backoffice에만 view·map-roles
// (infra/keycloak/realm/crosshub-realm.json — 다른 client는 조회 불가)
//
// 로그인이 Keycloak 전용이라 KEYCLOAK_ADMIN_CLIENT_SECRET은 필수다. 없으면 계정 발급·초기화·토글이 keycloakSyncFailed로 막힌다.
// Keycloak 반영이 실패하면 DB도 바꾸지 않는다 → 두 시스템이 어긋나지 않게.

export class KeycloakSyncError extends Error {}

const cfg = () => {
  const { issuer, clientId } = keycloakConfig()
  return {
    adminBase: issuer.replace('/realms/', '/admin/realms/'),
    issuer,
    appClientId: clientId, // role이 달린 client (poc-backoffice)
    adminClientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? 'backoffice-admin-api',
    adminClientSecret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? '',
  }
}

export function keycloakAdminEnabled() {
  return !!cfg().adminClientSecret
}

let tokenCache: { token: string; expiresAt: number } | null = null

async function adminToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - Date.now() > 10_000) return tokenCache.token
  const c = cfg()
  const res = await fetch(`${c.issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.adminClientId, client_secret: c.adminClientSecret }),
    cache: 'no-store',
  })
  if (!res.ok) throw new KeycloakSyncError(`admin token ${res.status}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${cfg().adminBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await adminToken()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  })
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new KeycloakSyncError(`${init.method ?? 'GET'} ${path} → ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }
  return res
}

async function findUserId(username: string): Promise<string | null> {
  const res = await api(`/users?username=${encodeURIComponent(username)}&exact=true`)
  const rows = (await res.json()) as { id: string }[]
  return rows[0]?.id ?? null
}

/** 같은 username이 Keycloak에 이미 있는가 (발급 전 중복 확인) */
export async function keycloakUserExists(username: string) {
  return (await findUserId(username)) !== null
}

async function assignClientRole(userId: string, role: Role) {
  const c = cfg()
  const clients = (await (await api(`/clients?clientId=${encodeURIComponent(c.appClientId)}`)).json()) as { id: string }[]
  const clientUuid = clients[0]?.id
  if (!clientUuid) throw new KeycloakSyncError(`client ${c.appClientId} 없음`)
  const roleRes = await api(`/clients/${clientUuid}/roles/${encodeURIComponent(role)}`)
  if (roleRes.status === 404) throw new KeycloakSyncError(`client role ${role} 없음 — Keycloak에 crosshub/affiliate/partner role을 만들어야 함`)
  const roleRep = await roleRes.json()
  await api(`/users/${userId}/role-mappings/clients/${clientUuid}`, { method: 'POST', body: JSON.stringify([roleRep]) })
}

/**
 * Keycloak 사용자 생성: username = User.loginId, 임시 비밀번호 + 첫 로그인 때 비밀번호 변경 강제,
 * poc-backoffice client role(= DB role과 같은 이름) 부여. 생성된 Keycloak user id를 돌려준다.
 */
export async function createKeycloakUser(input: { loginId: string; name: string; role: Role; tempPassword: string }): Promise<string> {
  const res = await api('/users', {
    method: 'POST',
    body: JSON.stringify({
      username: input.loginId,
      firstName: input.name,
      enabled: true,
      requiredActions: ['UPDATE_PASSWORD'],
      credentials: [{ type: 'password', value: input.tempPassword, temporary: true }],
    }),
  })
  if (res.status === 409) throw new KeycloakSyncError('이미 있는 username')
  const id = res.headers.get('location')?.split('/').pop() ?? (await findUserId(input.loginId))
  if (!id) throw new KeycloakSyncError('생성된 사용자 id를 못 찾음')
  try {
    await assignClientRole(id, input.role)
  } catch (e) {
    await deleteKeycloakUser(id) // role 없는 반쪽 계정이 남지 않게
    throw e
  }
  return id
}

export async function deleteKeycloakUser(keycloakUserId: string) {
  await api(`/users/${keycloakUserId}`, { method: 'DELETE' }).catch(() => undefined)
}

/** 임시 비밀번호로 초기화 + 로그인 세션 모두 종료. Keycloak에 없던 (예전) 계정이면 새로 만든다. */
export async function resetKeycloakPassword(input: { loginId: string; name: string; role: Role; tempPassword: string }) {
  const id = await findUserId(input.loginId)
  if (!id) {
    await createKeycloakUser(input)
    return
  }
  await api(`/users/${id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: input.tempPassword, temporary: true }),
  })
  await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: ['UPDATE_PASSWORD'] }) })
  await api(`/users/${id}/logout`, { method: 'POST' })
}

/** 활성/비활성. 비활성화하면 Keycloak 세션도 끊는다. Keycloak에 없는 계정이면 아무것도 안 한다. */
export async function setKeycloakUserEnabled(loginId: string, enabled: boolean) {
  const id = await findUserId(loginId)
  if (!id) return
  await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) })
  if (!enabled) await api(`/users/${id}/logout`, { method: 'POST' })
}
