// API(Route Handler)용 로그인·권한 확인. 화면과 같은 DB 세션(lib/server/auth/session.ts)을 쓴다.
// (예전 auth-stub.ts의 x-role 헤더 방식은 누구나 역할을 바꿔 보낼 수 있어서 이걸로 교체)
import 'server-only'
import { NextResponse } from 'next/server'
import { canAccess, canEdit, type Menu, type Role } from '@/lib/permissions'
import { getSessionUser, type SessionUser } from '@/lib/server/auth/session'
import type { ApiError } from './contract'

export type Session = {
  user: SessionUser
  role: Role
  /** role === 'partner'일 때 본인 소속 업체명. 그 외엔 null. */
  partnerName: string | null
}

/**
 * 로그인(임시 비밀번호 상태 제외)과 메뉴 권한을 확인한다.
 * 실패하면 바로 돌려줄 응답(401·403)을 준다: `if ('response' in auth) return auth.response`
 * menu를 비우면 로그인만 확인한다.
 */
export async function requireApiSession(
  menu?: Menu,
  level: 'read' | 'edit' = 'read',
): Promise<{ session: Session } | { response: NextResponse<ApiError> }> {
  const user = await getSessionUser()
  if (!user || user.mustChangePassword) {
    return { response: NextResponse.json({ error: '로그인이 필요합니다.', code: 'UNAUTHORIZED' }, { status: 401 }) }
  }
  if (menu && !(level === 'edit' ? canEdit(user.role, menu) : canAccess(user.role, menu))) {
    return { response: NextResponse.json({ error: '권한이 없습니다.', code: 'FORBIDDEN' }, { status: 403 }) }
  }
  const partnerName = user.role === 'partner' ? (user.managedPartners[0]?.name ?? null) : null
  return { session: { user, role: user.role, partnerName } }
}
