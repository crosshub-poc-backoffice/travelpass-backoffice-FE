import 'server-only'
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { AUDIT_ACTIONS, type AccessKind, type AuditAction, type AuditCategory, type AuditDetail, type LoginAction, type LoginResult, type LoginSearchField } from '@/lib/audit'
import type { SessionUser } from '@/lib/server/auth/session'

export type AuditEntry = {
  userId: string
  action: AuditAction
  partnerId: string | null
  targetId?: string | null
  targetName?: string | null
  detail?: AuditDetail
}

/** 작업 이력 한 줄을 만든다. await하지 않고 prisma.$transaction([...])에 같이 넣으면 작업과 함께 저장된다 */
export function audit(entry: AuditEntry) {
  return prisma.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      partnerId: entry.partnerId,
      targetId: entry.targetId ?? null,
      targetName: entry.targetName ?? null,
      detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: { id: true },
  })
}

export const AUDIT_PAGE_SIZE = 20

export type AuditFilter = {
  from: string // YYYY-MM-DD (일본 시간)
  to: string
  partnerId: string | null
  category: AuditCategory | null
  page: number
}

// 크로스허브는 전체, 연맹은 대행 업체 것만 (메뉴권한표: 작업 이력 크로스허브 R · 연맹 R · 업체 –)
function scopeWhere(user: SessionUser): Prisma.AuditLogWhereInput {
  if (user.role === 'crosshub') return {}
  return { partnerId: { in: user.managedPartners.map((p) => p.id) } }
}

const jstStart = (day: string) => new Date(`${day}T00:00:00+09:00`)

export async function listAuditLogs(user: SessionUser, filter: AuditFilter) {
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      scopeWhere(user),
      { createdAt: { gte: jstStart(filter.from), lt: new Date(jstStart(filter.to).getTime() + 24 * 60 * 60 * 1000) } },
      filter.partnerId ? { partnerId: filter.partnerId } : {},
      filter.category ? { action: { in: AUDIT_ACTIONS.filter((a) => a.startsWith(`${filter.category}_`)) } } : {},
    ],
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        targetId: true,
        targetName: true,
        detail: true,
        createdAt: true,
        partner: { select: { name: true } },
        user: { select: { name: true, loginId: true, role: true, affiliate: { select: { name: true } }, partner: { select: { name: true } } } },
      },
    }),
  ])

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      targetId: r.targetId,
      targetName: r.targetName,
      /** targetName이 보는 사람 언어의 AI 번역이면 true (상품 대상만, 페이지에서 채운다) */
      targetNameAi: false,
      detail: (r.detail ?? null) as AuditDetail | null,
      createdAt: r.createdAt.toISOString(),
      partnerName: r.partner?.name ?? null,
      userName: r.user.name,
      userLoginId: r.user.loginId,
      userRole: r.user.role,
      userOrgName: r.user.affiliate?.name ?? r.user.partner?.name ?? null,
    })),
  }
}

export type AuditRow = Awaited<ReturnType<typeof listAuditLogs>>['rows'][number]

// ── 로그인 내역 · 접근 기록 (크로스허브만 본다) ──

export type LogFilter = { from: string; to: string; keyword: string; page: number }

function periodWhere(from: string, to: string) {
  return { createdAt: { gte: jstStart(from), lt: new Date(jstStart(to).getTime() + 24 * 60 * 60 * 1000) } }
}

export type LoginLogFilter = LogFilter & {
  action: LoginAction | null
  result: LoginResult | null
  field: LoginSearchField
  exact: boolean // 일치: 체크하면 검색어와 똑같은 것만, 아니면 포함하는 것
}

export async function listLoginLogs(filter: LoginLogFilter) {
  const text = (v: string) => (filter.exact ? { equals: v } : { contains: v, mode: 'insensitive' as const })
  const keywordWhere: Prisma.LoginLogWhereInput =
    filter.field === 'name' ? { user: { name: text(filter.keyword) } } : { [filter.field]: text(filter.keyword) }
  const where: Prisma.LoginLogWhereInput = {
    AND: [
      periodWhere(filter.from, filter.to),
      filter.action === 'login' ? { event: { in: ['login', 'failed'] } } : filter.action === 'logout' ? { event: 'logout' } : {},
      filter.result === 'success' ? { event: { in: ['login', 'logout'] } } : filter.result === 'failed' ? { event: 'failed' } : {},
      filter.keyword ? keywordWhere : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.loginLog.count({ where }),
    prisma.loginLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        loginId: true,
        event: true,
        failReason: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
  ])
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      loginId: r.loginId,
      userName: r.user?.name ?? null,
      event: r.event,
      failReason: r.failReason,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

export type LoginLogRow = Awaited<ReturnType<typeof listLoginLogs>>['rows'][number]

export async function listAccessLogs(filter: LogFilter & { menu: string | null; kind: AccessKind | null }) {
  const where: Prisma.AccessLogWhereInput = {
    AND: [
      periodWhere(filter.from, filter.to),
      filter.menu ? { menu: filter.menu } : {},
      filter.kind ? { kind: filter.kind } : {},
      filter.keyword
        ? {
            user: {
              OR: [
                { loginId: { contains: filter.keyword, mode: 'insensitive' } },
                { name: { contains: filter.keyword, mode: 'insensitive' } },
              ],
            },
          }
        : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.accessLog.count({ where }),
    prisma.accessLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        menu: true,
        kind: true,
        path: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        user: { select: { name: true, loginId: true } },
      },
    }),
  ])
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      menu: r.menu,
      kind: r.kind as AccessKind,
      path: r.path,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      userName: r.user.name,
      userLoginId: r.user.loginId,
    })),
  }
}

export type AccessLogRow = Awaited<ReturnType<typeof listAccessLogs>>['rows'][number]

// ── 계정 변동 이력 (계정 관리 탭). 대상 계정 기준으로 발급·비밀번호·활성 상태 변동을 보여준다 ──

const ACCOUNT_ACTIONS = AUDIT_ACTIONS.filter((a) => a.startsWith('account_'))

export async function listAccountChanges(filter: LogFilter & { action: AuditAction | null }) {
  const keyword = filter.keyword
  // 대상 계정 검색: 이름·로그인 ID로 계정을 먼저 찾고 그 계정의 기록만
  const targetIds = keyword
    ? (
        await prisma.user.findMany({
          where: {
            OR: [
              { loginId: { contains: keyword, mode: 'insensitive' } },
              { name: { contains: keyword, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        })
      ).map((u) => u.id)
    : null
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      periodWhere(filter.from, filter.to),
      { action: filter.action && ACCOUNT_ACTIONS.includes(filter.action) ? filter.action : { in: ACCOUNT_ACTIONS } },
      targetIds ? { targetId: { in: targetIds } } : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: { id: true, action: true, targetId: true, targetName: true, createdAt: true, userId: true, user: { select: { name: true, loginId: true } } },
    }),
  ])
  // 대상 계정의 지금 이름 (기록에는 로그인 ID만 복사해 둔다)
  const targets = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.targetId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  })
  const nameOf = new Map(targets.map((u) => [u.id, u.name]))

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      targetLoginId: r.targetName,
      targetName: (r.targetId && nameOf.get(r.targetId)) ?? null,
      actorName: r.user.name,
      actorLoginId: r.user.loginId,
      bySelf: r.userId === r.targetId,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

export type AccountChangeRow = Awaited<ReturnType<typeof listAccountChanges>>['rows'][number]

// ── 업체 작업 이력 (업체 관리 탭). 등록·수수료율 변경·활성/비활성. 크로스허브 전체 · 연맹 대행 업체 ──

const PARTNER_ACTIONS = AUDIT_ACTIONS.filter((a) => a.startsWith('partner_'))

export async function listPartnerHistory(user: SessionUser, filter: LogFilter & { partnerId: string | null; action: AuditAction | null }) {
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      scopeWhere(user),
      periodWhere(filter.from, filter.to),
      { action: filter.action && PARTNER_ACTIONS.includes(filter.action) ? filter.action : { in: PARTNER_ACTIONS } },
      filter.partnerId ? { partnerId: filter.partnerId } : {},
    ],
  }
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filter.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        action: true,
        targetName: true,
        detail: true,
        createdAt: true,
        partner: { select: { name: true } },
        user: { select: { name: true, loginId: true } },
      },
    }),
  ])
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      // 업체명이 바뀌었으면 지금 이름, 없으면 기록 당시 이름
      partnerName: r.partner?.name ?? r.targetName ?? '-',
      detail: (r.detail ?? null) as AuditDetail | null,
      actorName: r.user.name,
      actorLoginId: r.user.loginId,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}

export type PartnerHistoryRow = Awaited<ReturnType<typeof listPartnerHistory>>['rows'][number]
