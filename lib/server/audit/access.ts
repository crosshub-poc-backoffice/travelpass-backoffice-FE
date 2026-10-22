import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { prisma } from '@/lib/db'
import type { AccessKind } from '@/lib/audit'
import type { Menu } from '@/lib/permissions'

// 로그인 내역·접근 기록. 응답을 보낸 뒤(after)에 저장해서 화면 속도에 영향이 없게 한다.

export const ACCESS_LOG_RETENTION_DAYS = 30

export type LoginFailReason = 'wrongPassword' | 'unknownId' | 'inactive' | 'locked'

/** 접속한 IP와 브라우저 정보. Vercel은 x-forwarded-for 맨 앞이 실제 접속 IP */
export async function requestInfo() {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
  return { ip, userAgent: h.get('user-agent')?.slice(0, 300) ?? null }
}

export async function recordLogin(entry: {
  userId: string | null
  loginId: string
  event: 'login' | 'logout' | 'failed'
  failReason?: LoginFailReason
}) {
  const info = await requestInfo()
  after(() =>
    prisma.loginLog.create({
      data: { ...entry, loginId: entry.loginId.slice(0, 100), failReason: entry.failReason ?? null, ...info },
    }),
  )
}

// 한 요청에서 남길 접근 기록 (메뉴별 행위). React cache라 요청마다 새로 만들어진다
const pendingAccess = cache(() => ({ scheduled: false, byMenu: new Map<string, { userId: string; kind: AccessKind }>() }))

// 같은 요청에서 layout(목록)과 page(상세)·Server Action(수정)이 함께 부르면 더 구체적인 행위 하나만 남긴다
const KIND_RANK: Record<AccessKind, number> = { list: 0, view: 1, update: 2, create: 3, delete: 4 }

/** 메뉴 접근 기록. requireMenu가 부른다. 응답을 보낸 뒤 요청당 메뉴별 1줄씩 저장 */
export async function recordAccess(userId: string, menu: Menu, kind: AccessKind) {
  const pending = pendingAccess()
  const prev = pending.byMenu.get(menu)
  if (!prev || KIND_RANK[kind] > KIND_RANK[prev.kind]) pending.byMenu.set(menu, { userId, kind })
  if (pending.scheduled) return
  pending.scheduled = true

  const h = await headers()
  // 저장·삭제는 어느 화면에서 눌렀는지 주소를 같이 남긴다 (Server Action 요청의 referer)
  let referer: string | null = null
  try {
    referer = new URL(h.get('referer') ?? '').pathname
  } catch {
    referer = null
  }
  const info = await requestInfo()
  after(() =>
    prisma.accessLog.createMany({
      data: [...pending.byMenu].map(([m, e]) => ({
        userId: e.userId,
        menu: m,
        kind: e.kind,
        path: e.kind === 'create' || e.kind === 'update' || e.kind === 'delete' ? referer : null,
        ...info,
      })),
    }),
  )
}

/** 보관 기간이 지난 접근 기록 기준 시각 */
export function accessLogCutoff() {
  return new Date(Date.now() - ACCESS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
}
