import 'server-only'
import { prisma } from '@/lib/db'
import { hashPassword, verifyPassword } from './password'
import { audit } from '@/lib/server/audit/service'
import type { LoginFailReason } from '@/lib/server/audit/access'
import type { Role } from '@/lib/permissions'

// 로그인 시도 제한. 최근 15분 동안 같은 ID로 5번, 같은 IP로 20번 실패하면 15분 동안 막는다
const LOCK_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILS_PER_ID = 5
const MAX_FAILS_PER_IP = 20

/** 막힌 상태인지. 막힌 동안 시도한 것도 실패로 남기므로, 계속 시도하면 그만큼 늦게 풀린다.
 *  ID 기준은 그 ID의 마지막 로그인 성공 뒤의 실패만 센다 */
export async function isLoginLocked(loginId: string, ip: string | null) {
  const since = new Date(Date.now() - LOCK_WINDOW_MS)
  const lastSuccess = await prisma.loginLog.findFirst({
    where: { loginId, event: 'login', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const [idFails, ipFails] = await Promise.all([
    prisma.loginLog.count({ where: { loginId, event: 'failed', createdAt: { gt: lastSuccess?.createdAt ?? since } } }),
    ip ? prisma.loginLog.count({ where: { ip, event: 'failed', createdAt: { gte: since } } }) : 0,
  ])
  return idFails >= MAX_FAILS_PER_ID || ipFails >= MAX_FAILS_PER_IP
}

// 없는 ID로 로그인해도 응답 시간이 같도록 비교용 해시를 하나 만들어 둔다
let dummyHash: Promise<string> | null = null
function getDummyHash() {
  dummyHash ??= hashPassword('dummy-password-for-timing')
  return dummyHash
}

type VerifyResult =
  | { ok: true; user: { id: string; role: Role; affiliateId: string | null; partnerId: string | null; mustChangePassword: boolean } }
  | { ok: false; userId: string | null; reason: LoginFailReason }

/** 화면에는 실패 이유를 구분하지 않고 알리지만(계정 존재 여부 노출 방지), 로그인 내역에는 이유를 남긴다 */
export async function verifyCredentials(loginId: string, password: string): Promise<VerifyResult> {
  const user = await prisma.user.findUnique({
    where: { loginId },
    select: { id: true, passwordHash: true, role: true, affiliateId: true, partnerId: true, mustChangePassword: true, active: true },
  })
  if (!user) {
    await verifyPassword(password, await getDummyHash())
    return { ok: false, userId: null, reason: 'unknownId' }
  }
  const ok = await verifyPassword(password, user.passwordHash)
  // 계정이 있고 비밀번호도 맞는지와 별개로, 비활성화된 계정인지는 구분해서 알려주지 않는다 (계정 존재 여부 노출 방지)
  if (!ok) return { ok: false, userId: user.id, reason: 'wrongPassword' }
  // 소속 업체가 비활성이어도 로그인은 된다 — 남은 예약·문의를 마무리해야 해서. 상품 등록·수정·노출만 막는다 (products/service.ts)
  if (!user.active) return { ok: false, userId: user.id, reason: 'inactive' }
  return {
    ok: true,
    user: {
      id: user.id,
      role: user.role,
      affiliateId: user.affiliateId,
      partnerId: user.partnerId,
      mustChangePassword: user.mustChangePassword,
    },
  }
}

/** 현재 비밀번호가 맞으면 바꾸고, 지금 쓰는 세션 말고 다른 기기의 로그인은 끊는다. */
export async function changeUserPassword(userId: string, currentSessionId: string, current: string, next: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, loginId: true, partnerId: true } })
  if (!user || !(await verifyPassword(current, user.passwordHash))) return false

  const passwordHash = await hashPassword(next)
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
    prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
    audit({ userId, action: 'account_password_change', partnerId: user.partnerId, targetId: userId, targetName: user.loginId }),
  ])
  return true
}
