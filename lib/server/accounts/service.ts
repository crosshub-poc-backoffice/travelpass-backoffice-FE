import 'server-only'
import { prisma } from '@/lib/db'
import { backend, qs, type PageResponse } from '@/lib/api/backend'
import { Prisma } from '@/lib/generated/prisma/client'
import type { AccountStatus } from '@/lib/accounts'
import type { Role } from '@/lib/permissions'
import { generateTempPassword, hashPassword } from '@/lib/server/auth/password'
import {
  createKeycloakUser,
  deleteKeycloakUser,
  keycloakAdminEnabled,
  KeycloakSyncError,
  keycloakUserExists,
  resetKeycloakPassword,
  setKeycloakUserEnabled,
} from '@/lib/server/auth/keycloak-admin'
import { markAllReadOnReactivate } from '@/lib/server/notifications/service'
import { audit } from '@/lib/server/audit/service'

export const ACCOUNT_PAGE_SIZE = 20

export type AccountFilter = {
  role: Role | null
  orgId: string | null // 연맹 또는 업체 id
  status: AccountStatus | null
  keyword: string
  page: number
  /** 최종 접속내역 탭은 마지막 로그인 순, 계정 조회 탭은 발급일 순 */
  sort?: 'created' | 'lastLogin'
}

const STATUS_WHERE: Record<AccountStatus, Prisma.UserWhereInput> = {
  active: { active: true, mustChangePassword: false },
  pending: { active: true, mustChangePassword: true },
  inactive: { active: false },
}

type BeAccount = {
  id: string
  loginId: string
  name: string
  role: Role
  orgName: string | null
  mustChangePassword: boolean
  active: boolean
  lastLoginAt: string | null
  lastLoginIp: string | null
  lastLoginUserAgent: string | null
  createdAt: string
}

export async function listAccounts(filter: AccountFilter) {
  // 계정 목록을 BE에서 가져온다. 필터·정렬·페이징은 쿼리스트링으로 전달.
  const res = await backend.get<PageResponse<BeAccount>>(
    `/api/v1/accounts${qs({
      role: filter.role ?? undefined,
      orgId: filter.orgId ?? undefined,
      status: filter.status ?? undefined,
      keyword: filter.keyword || undefined,
      sort: filter.sort,
      page: filter.page,
    })}`,
  )
  return { total: res.total, rows: res.rows }
}

export type AccountRow = Awaited<ReturnType<typeof listAccounts>>['rows'][number]

/** 소속 선택지(연맹·직접 운영 업체). 업체 계정은 직접 운영 업체에만 준다 (대행 업체는 연맹이 처리).
 *  hasAccount: 이미 계정이 있는 소속 — 소속당 계정은 1개라 발급 화면에서 뺀다 */
export async function listAccountOrgs() {
  const select = { id: true, name: true, _count: { select: { users: true } } } as const
  const [affiliates, partners] = await Promise.all([
    prisma.affiliate.findMany({ select, orderBy: { name: 'asc' } }),
    prisma.partner.findMany({ where: { proxyAffiliateId: null }, select, orderBy: { name: 'asc' } }),
  ])
  const toOrg = (o: { id: string; name: string; _count: { users: number } }) => ({ id: o.id, name: o.name, hasAccount: o._count.users > 0 })
  return { affiliates: affiliates.map(toOrg), partners: partners.map(toOrg) }
}

export type AccountOrg = Awaited<ReturnType<typeof listAccountOrgs>>['partners'][number]

type CreateAccountResult =
  | { ok: true; user: { id: string; loginId: string; partnerId: string | null }; tempPassword: string }
  | { ok: false; error: 'loginIdTaken' | 'invalidOrg' | 'orgHasAccount' | 'affiliateNameTaken' | 'keycloakSyncFailed' }

/** 계정 발급. 연맹 계정은 새 연맹(newAffiliateName)을 만들면서 발급할 수도 있다 — 연맹 추가는 여기서만 한다.
 *  연맹·업체는 소속당 1개이고, 계정 이름은 소속명으로 채운다 (업체명이 바뀌면 partners/service.ts가 같이 바꾼다).
 *  크로스허브 계정은 소속이 없어 작업 이력에서 구분되도록 이름(담당자)을 받는다 */
export async function createAccount(actorId: string, input: {
  role: Role
  name: string
  loginId: string
  affiliateId: string | null
  partnerId: string | null
  newAffiliateName?: string | null
}): Promise<CreateAccountResult> {
  const newAffiliateName = input.role === 'affiliate' ? (input.newAffiliateName ?? null) : null
  const affiliateId = input.role === 'affiliate' && !newAffiliateName ? input.affiliateId : null
  const partnerId = input.role === 'partner' ? input.partnerId : null

  let name = input.name
  if (newAffiliateName) {
    const taken = await prisma.affiliate.findFirst({ where: { name: { equals: newAffiliateName, mode: 'insensitive' } }, select: { id: true } })
    if (taken) return { ok: false, error: 'affiliateNameTaken' }
    name = newAffiliateName
  } else if (input.role === 'affiliate') {
    const found =
      affiliateId && (await prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { name: true, _count: { select: { users: true } } } }))
    if (!found) return { ok: false, error: 'invalidOrg' }
    if (found._count.users > 0) return { ok: false, error: 'orgHasAccount' }
    name = found.name
  }
  if (input.role === 'partner') {
    const found =
      partnerId &&
      (await prisma.partner.findUnique({ where: { id: partnerId }, select: { name: true, proxyAffiliateId: true, _count: { select: { users: true } } } }))
    if (!found || found.proxyAffiliateId) return { ok: false, error: 'invalidOrg' }
    if (found._count.users > 0) return { ok: false, error: 'orgHasAccount' }
    name = found.name
  }

  const tempPassword = generateTempPassword()

  // Keycloak 연동(A-2): DB보다 먼저 Keycloak에 같은 아이디·임시 비밀번호·role로 만든다.
  // DB 생성이 실패하면 Keycloak 계정을 지워 되돌린다 → 두 쪽이 항상 같이 있거나 같이 없다.
  // 로그인이 Keycloak 전용이라 Keycloak에 계정이 없으면 로그인할 수 없다 → 연동 설정이 없으면 발급 자체를 막는다
  if (!keycloakAdminEnabled()) return { ok: false, error: 'keycloakSyncFailed' }
  let keycloakUserId: string | null = null
  {
    if (await prisma.user.findUnique({ where: { loginId: input.loginId }, select: { id: true } })) return { ok: false, error: 'loginIdTaken' }
    try {
      if (await keycloakUserExists(input.loginId)) return { ok: false, error: 'loginIdTaken' }
      keycloakUserId = await createKeycloakUser({ loginId: input.loginId, name, role: input.role, tempPassword })
    } catch (e) {
      console.error('[keycloak] createAccount', e)
      return { ok: false, error: 'keycloakSyncFailed' }
    }
  }

  try {
    // 새 연맹은 계정과 한 번에 만든다 (아이디 중복으로 계정이 실패하면 연맹도 안 생긴다)
    const user = await prisma.user.create({
      data: {
        loginId: input.loginId,
        name,
        role: input.role,
        ...(newAffiliateName
          ? { affiliate: { create: { name: newAffiliateName } } }
          : affiliateId
            ? { affiliate: { connect: { id: affiliateId } } }
            : {}),
        ...(partnerId ? { partner: { connect: { id: partnerId } } } : {}),
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
      },
      select: { id: true, loginId: true, partnerId: true, affiliateId: true },
    })
    if (newAffiliateName && user.affiliateId) {
      await audit({ userId: actorId, action: 'account_affiliate_create', partnerId: null, targetId: user.affiliateId, targetName: newAffiliateName })
    }
    await audit({ userId: actorId, action: 'account_issue', partnerId: user.partnerId, targetId: user.id, targetName: user.loginId })
    return { ok: true, user, tempPassword }
  } catch (e) {
    if (keycloakUserId) await deleteKeycloakUser(keycloakUserId)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'loginIdTaken' }
    }
    throw e
  }
}

/** 임시 비밀번호로 바꾸고, 그 계정의 로그인을 모두 끊는다. Keycloak에도 같은 임시 비밀번호로 반영(실패하면 DB도 안 바꾼다). */
export async function resetAccountPassword(userId: string, actorId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, loginId: true, partnerId: true, name: true, role: true } })
  if (!user) return null

  const tempPassword = generateTempPassword()
  if (!keycloakAdminEnabled()) throw new KeycloakSyncError('KEYCLOAK_ADMIN_CLIENT_SECRET 미설정')
  {
    await resetKeycloakPassword({ loginId: user.loginId, name: user.name, role: user.role, tempPassword }) // 실패 시 KeycloakSyncError
  }
  const passwordHash = await hashPassword(tempPassword)
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true } }),
    prisma.session.deleteMany({ where: { userId } }),
    audit({ userId: actorId, action: 'account_password_reset', partnerId: user.partnerId, targetId: user.id, targetName: user.loginId }),
  ])
  return { user, tempPassword }
}

type ToggleActiveResult = { ok: true; active: boolean } | { ok: false; error: 'notFound' | 'toggleSelf' }

/** 계정 활성화/비활성화를 뒤집는다. 본인 계정은 막는다 — 호출하는 쪽(actions.ts)이 이미 확인해도 여기서 한 번 더 막는다.
 *  비활성화하면 로그인된 기기에서도 모두 로그아웃된다. */
export async function toggleAccountActive(userId: string, actorId: string): Promise<ToggleActiveResult> {
  if (userId === actorId) return { ok: false, error: 'toggleSelf' }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, active: true, loginId: true, partnerId: true } })
  if (!user) return { ok: false, error: 'notFound' }

  const active = !user.active
  // Keycloak 계정도 같이 켜고 끈다 (끄면 Keycloak 세션도 종료). 실패하면 KeycloakSyncError로 DB도 안 바꾼다
  if (!keycloakAdminEnabled()) throw new KeycloakSyncError('KEYCLOAK_ADMIN_CLIENT_SECRET 미설정')
  await setKeycloakUserEnabled(user.loginId, active)
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { active } }),
    prisma.session.deleteMany({ where: { userId } }),
    ...(active ? [markAllReadOnReactivate(userId)] : []),
    audit({
      userId: actorId,
      action: active ? 'account_activate' : 'account_deactivate',
      partnerId: user.partnerId,
      targetId: user.id,
      targetName: user.loginId,
    }),
  ])
  return { ok: true, active }
}
