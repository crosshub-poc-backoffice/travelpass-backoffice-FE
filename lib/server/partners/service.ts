import 'server-only'
import { prisma } from '@/lib/db'
import { backend, BackendError } from '@/lib/api/backend'
import type { ErrorKey } from '@/lib/errors'
import type { Role } from '@/lib/permissions'
import type { PartnerInput } from '@/lib/partner-fields'
import type { SessionUser } from '@/lib/server/auth/session'

// 업체 관리. 크로스허브는 전체 업체, 연맹은 대행 업체만 다룬다 (메뉴권한표).
// 업체 전환과 상관없이 관리 범위 전체를 보여준다.

export type PartnerRow = Omit<PartnerInput, 'proxyAffiliateId'> & {
  id: string
  proxyAffiliateId: string | null
  proxyAffiliateName: string | null
  active: boolean | null
  createdAt: string
  /** 비활성화로 숨김된 상품 수. 다시 활성화할 때 되돌릴지 묻는다 */
  hiddenByOffCount: number
}

type PartnerResult = { ok: true; partner: PartnerRow } | { ok: false; error: ErrorKey }

/** BE(/api/v1/partners) 응답 모양. 역할별 마스킹은 아래 rowFromBe에서 FE가 건다. */
type BePartner = {
  id: string; name: string; proxyAffiliateId: string | null; proxyAffiliateName: string | null
  active: boolean; commissionRate: number | null; currency: string
  manager: string | null; phone: string | null; email: string | null
  bankName: string | null; bankAccountNumber: string | null; bankAccountHolder: string | null; bankCode: string | null
  memo: string | null; businessRegistrationNumber: string | null; representativeName: string | null
  corporateName: string | null; address: string | null; businessLicenseUrl: string | null
  subManager: string | null; subManagerPhone: string | null; hiddenByOffCount: number; createdAt: string
}

// BE 원값 → 화면 행. memo는 업체 계정에게는 비워서 보낸다(내부 메모).
function rowFromBe(b: BePartner, role: Role): PartnerRow {
  return {
    id: b.id,
    name: b.name,
    proxyAffiliateId: b.proxyAffiliateId,
    proxyAffiliateName: b.proxyAffiliateName,
    createdAt: b.createdAt,
    active: b.active,
    commissionRate: b.commissionRate,
    currency: b.currency,
    managerName: b.manager,
    phone: b.phone,
    email: b.email,
    bankName: b.bankName,
    bankAccountNumber: b.bankAccountNumber,
    bankAccountHolder: b.bankAccountHolder,
    memo: role === 'partner' ? null : b.memo,
    businessRegistrationNumber: b.businessRegistrationNumber,
    representativeName: b.representativeName,
    corporateName: b.corporateName,
    address: b.address,
    businessLicenseUrl: b.businessLicenseUrl,
    subManager: b.subManager,
    subManagerPhone: b.subManagerPhone,
    bankCode: b.bankCode,
    hiddenByOffCount: b.hiddenByOffCount,
  }
}

export async function listPartners(user: SessionUser) {
  // BE는 dev에서 전체를 준다. 연맹/업체 범위는 FE가 거른다(products와 동일 하이브리드).
  const all = await backend.get<BePartner[]>('/api/v1/partners')
  const scoped = user.role === 'crosshub'
    ? all
    : all.filter((b) => user.managedPartners.some((p) => p.id === b.id))
  // createdAt desc
  scoped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return scoped.map((b) => rowFromBe(b, user.role))
}

export async function getPartner(user: SessionUser, id: string) {
  const inRange = user.role === 'crosshub' || user.managedPartners.some((p) => p.id === id)
  if (!inRange) return null
  try {
    const b = await backend.get<BePartner>(`/api/v1/partners/${id}`)
    return rowFromBe(b, user.role)
  } catch {
    return null
  }
}

/** 운영방식 선택지 (크로스허브만 고른다) */
export async function listAffiliateOptions() {
  return prisma.affiliate.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
}

// 업체 쓰기(등록·수정·활성화)는 BE(/api/v1/partners)가 한다 — 권한·범위 확인, 이름 중복, 통화·운영방식 잠금,
// 수수료율 하한, 작업 이력까지. 실패는 BE가 {code}(FE 에러 키와 같은 이름)로 준다.
function toError(e: unknown): { ok: false; error: ErrorKey } {
  if (e instanceof BackendError) {
    if (e.status === 404) return { ok: false, error: 'notFound' }
    if (e.code) return { ok: false, error: e.code as ErrorKey }
  }
  throw e
}

export async function createPartner(user: SessionUser, input: PartnerInput): Promise<PartnerResult> {
  try {
    const b = await backend.post<BePartner>('/api/v1/partners', input)
    return { ok: true, partner: rowFromBe(b, user.role) }
  } catch (e) {
    return toError(e)
  }
}

export async function updatePartner(user: SessionUser, id: string, input: PartnerInput): Promise<PartnerResult> {
  try {
    const b = await backend.put<BePartner>(`/api/v1/partners/${encodeURIComponent(id)}`, input)
    return { ok: true, partner: rowFromBe(b, user.role) }
  } catch (e) {
    return toError(e)
  }
}

/** 활성화·비활성화. 크로스허브만 (BE가 확인). 비활성 = 노출중 상품 숨김, 다시 켤 때 restoreProducts면 되돌린다 */
export async function togglePartnerActive(user: SessionUser, id: string, restoreProducts = false): Promise<PartnerResult> {
  try {
    const b = await backend.post<BePartner>(`/api/v1/partners/${encodeURIComponent(id)}/toggle-active`, { restoreProducts })
    return { ok: true, partner: rowFromBe(b, user.role) }
  } catch (e) {
    return toError(e)
  }
}
