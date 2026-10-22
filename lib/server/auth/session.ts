import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { canAccess, canEdit, type Menu, type Role } from '@/lib/permissions'
import { SESSION_COOKIE } from './cookie'
import { audit } from '@/lib/server/audit/service'
import { recordAccess } from '@/lib/server/audit/access'
import type { AccessKind } from '@/lib/audit'

const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000 // 로그인 유지: 30일
const DEFAULT_MS = 12 * 60 * 60 * 1000 // 유지 안 함: 브라우저를 닫거나 12시간 지나면 끝

// DB에는 토큰 원문 대신 해시를 저장해서, DB가 새도 세션을 가로챌 수 없게 한다
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string, remember: boolean) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_MS : DEFAULT_MS))

  // 만료된 세션은 로그인할 때 같이 정리. 계정 관리 화면의 "마지막 로그인"도 여기서 남긴다
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }),
    prisma.session.create({
      data: { id: hashToken(token), userId, expiresAt },
    }),
    prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
  ])

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // 로그인 유지를 안 하면 만료일 없는 쿠키라 브라우저를 닫을 때 사라진다
    ...(remember ? { expires: expiresAt } : {}),
  })
}

export async function deleteCurrentSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } })
  cookieStore.delete(SESSION_COOKIE)
}

/** 업체 전환으로 고른 업체를 세션에 저장하고 작업 이력에 남긴다. 권한 확인은 호출하는 쪽에서 한다. */
export async function setActivePartner(user: SessionUser, partnerId: string | null) {
  await prisma.$transaction([
    prisma.session.update({ where: { id: user.sessionId }, data: { activePartnerId: partnerId } }),
    // partnerId가 null이면 "전체 보기"로 돌아간 것
    audit({
      userId: user.id,
      action: 'scope_switch',
      partnerId,
      targetId: partnerId,
      targetName: user.managedPartners.find((p) => p.id === partnerId)?.name ?? null,
    }),
  ])
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
  mustChangePassword: boolean
  /** 이 계정이 다룰 수 있는 업체. 크로스허브는 전체, 연맹은 대행 업체, 업체는 자기 업체 */
  managedPartners: PartnerRef[]
  /** 업체 전환으로 고른 업체. null이면 관리 범위 전체. 업체 계정은 자기 업체 고정 */
  activePartnerId: string | null
}

async function findManagedPartners(role: Role, affiliateId: string | null, partnerId: string | null): Promise<PartnerRef[]> {
  const select = { id: true, name: true } as const
  if (role === 'crosshub') {
    return prisma.partner.findMany({ select, orderBy: { name: 'asc' } })
  }
  if (role === 'affiliate') {
    // affiliateId가 비면 proxyAffiliateId: null(직접 운영 업체 전체)로 조회되므로 반드시 막는다
    if (!affiliateId) return []
    return prisma.partner.findMany({ where: { proxyAffiliateId: affiliateId }, select, orderBy: { name: 'asc' } })
  }
  if (!partnerId) return []
  return prisma.partner.findMany({ where: { id: partnerId }, select })
}

// 요청 한 번 안에서는 결과를 재사용한다 (React cache)
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { affiliate: true, partner: true } } },
  })
  if (!session || session.expiresAt < new Date()) return null

  const { user } = session
  // 계정이 비활성화되면 세션도 같이 지우지만(toggleAccountActive), 혹시 남아있더라도 여기서 한 번 더 막는다.
  if (!user.active) return null
  // 업체 범위는 권한이라 요청마다 새로 조회한다. 세션에 저장해 두면 업체 등록·운영방식 변경이 다시 로그인할 때까지 반영되지 않는다
  const managedPartners = await findManagedPartners(user.role, user.affiliateId, user.partnerId)
  const activePartnerId =
    user.role === 'partner'
      ? (managedPartners[0]?.id ?? null)
      : managedPartners.some((p) => p.id === session.activePartnerId)
        ? session.activePartnerId
        : null

  return {
    sessionId: session.id,
    id: user.id,
    loginId: user.loginId,
    name: user.name,
    role: user.role,
    affiliateId: user.affiliateId,
    partnerId: user.partnerId,
    orgName: user.affiliate?.name ?? user.partner?.name ?? null,
    mustChangePassword: user.mustChangePassword,
    managedPartners,
    activePartnerId,
  }
})

/** 지금 언어를 붙인 주소. 예: '/dashboard' → '/ko/dashboard' */
export async function localePath(path: string) {
  return `/${await getLocale()}${path === '/' ? '' : path}`
}

/** 로그인 안 했으면 로그인 화면으로, 임시 비밀번호 상태면 비밀번호 변경 화면으로 보낸다. */
export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect(await localePath('/'))
  if (user.mustChangePassword && !options.allowPasswordChange) redirect(await localePath('/change-password'))
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
