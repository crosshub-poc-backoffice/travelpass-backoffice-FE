import 'server-only'
import { prisma } from '@/lib/db'
import { backend } from '@/lib/api/backend'
import type { Prisma } from '@/lib/generated/prisma/client'
import type { ErrorKey } from '@/lib/errors'
import type { Role } from '@/lib/permissions'
import type { PartnerInput } from '@/lib/partner-fields'
import type { SessionUser } from '@/lib/server/auth/session'
import { maskAccount, type AuditDetail } from '@/lib/audit'
import { audit } from '@/lib/server/audit/service'
import { sharesExceedCommission } from '@/lib/server/payments/service'

/** 크로스허브가 수수료율을 정할 때: PG 수수료율 + 연맹 몫보다 작으면 크로스허브 몫이 마이너스라 막는다 */
async function commissionBelowShares(input: PartnerInput, proxyAffiliateId: string | null): Promise<boolean> {
  if (input.commissionRate == null) return false
  const [setting, affiliate] = await Promise.all([
    prisma.pgSetting.findUnique({ where: { currency: input.currency }, select: { feeRate: true } }),
    proxyAffiliateId ? prisma.affiliate.findUnique({ where: { id: proxyAffiliateId }, select: { shareRate: true } }) : null,
  ])
  return sharesExceedCommission([{ commissionRate: input.commissionRate, pgFeeRate: setting?.feeRate ?? 0, affiliateShareRate: affiliate?.shareRate ?? 0 }])
}

// 업체 관리. 크로스허브는 전체 업체, 연맹은 대행 업체만 다룬다 (메뉴권한표).
// 업체 전환과 상관없이 관리 범위 전체를 보여준다.

const partnerSelect = {
  id: true,
  name: true,
  proxyAffiliateId: true,
  createdAt: true,
  active: true,
  commissionRate: true,
  currency: true,
  manager: true,
  phone: true,
  email: true,
  bankName: true,
  bankAccountNumber: true,
  bankAccountHolder: true,
  memo: true,
  businessRegistrationNumber: true,
  representativeName: true,
  corporateName: true,
  address: true,
  businessLicenseUrl: true,
  subManager: true,
  subManagerPhone: true,
  bankCode: true,
  proxyAffiliate: { select: { name: true } },
  _count: { select: { products: { where: { hiddenByPartnerOff: true } } } },
} satisfies Prisma.PartnerSelect

type PartnerRecord = Prisma.PartnerGetPayload<{ select: typeof partnerSelect }>

export type PartnerRow = Omit<PartnerInput, 'proxyAffiliateId'> & {
  id: string
  proxyAffiliateId: string | null
  proxyAffiliateName: string | null
  active: boolean | null
  createdAt: string
  /** 비활성화로 숨김된 상품 수. 다시 활성화할 때 되돌릴지 묻는다 */
  hiddenByOffCount: number
}

// DB → 화면. 아직 칸이 없는 항목(lib/partner-fields.ts의 PENDING_FIELDS)은 null
// 메모는 크로스허브·연맹만 보는 내부 메모라 업체 계정에게는 비워서 보낸다
function toRow(p: PartnerRecord, role: Role): PartnerRow {
  return {
    id: p.id,
    name: p.name,
    proxyAffiliateId: p.proxyAffiliateId,
    proxyAffiliateName: p.proxyAffiliate?.name ?? null,
    createdAt: p.createdAt.toISOString(),
    active: p.active,
    commissionRate: p.commissionRate,
    currency: p.currency,
    managerName: p.manager,
    phone: p.phone,
    email: p.email,
    bankName: p.bankName,
    bankAccountNumber: p.bankAccountNumber,
    bankAccountHolder: p.bankAccountHolder,
    memo: role === 'partner' ? null : p.memo,
    businessRegistrationNumber: p.businessRegistrationNumber,
    representativeName: p.representativeName,
    corporateName: p.corporateName,
    address: p.address,
    businessLicenseUrl: p.businessLicenseUrl,
    subManager: p.subManager,
    subManagerPhone: p.subManagerPhone,
    bankCode: p.bankCode,
    hiddenByOffCount: p._count.products,
  }
}

// 입력 → DB. 정산 계좌는 세 역할 모두 고친다 (메뉴권한표 5: 업체도 직접 고치되 변경 이력을 남긴다)
// 수수료율·통화는 크로스허브만 바꾼다: 연맹·업체가 저장할 때는 빼고 저장
// 내부 메모는 업체가 고치지 못한다
function toData(input: PartnerInput, role: Role) {
  return {
    name: input.name,
    manager: input.managerName,
    phone: input.phone,
    email: input.email,
    bankName: input.bankName,
    bankAccountNumber: input.bankAccountNumber,
    bankAccountHolder: input.bankAccountHolder,
    bankCode: input.bankCode,
    businessRegistrationNumber: input.businessRegistrationNumber,
    representativeName: input.representativeName,
    corporateName: input.corporateName,
    address: input.address,
    businessLicenseUrl: input.businessLicenseUrl,
    subManager: input.subManager,
    subManagerPhone: input.subManagerPhone,
    ...(role !== 'partner'
      ? { memo: input.memo }
      : {}),
    ...(role === 'crosshub' ? { commissionRate: input.commissionRate, currency: input.currency } : {}),
  }
}

// 관리 범위 안의 업체로 좁힌다. 연맹은 대행 업체, 업체는 자기 업체 (session.ts의 findManagedPartners가 계산해 둔 범위)
// { id, ...범위 }처럼 펼치면 범위의 id 조건이 요청한 id를 덮어쓰므로 AND로 묶는다
function inScope(user: SessionUser, where: Prisma.PartnerWhereInput = {}): Prisma.PartnerWhereInput {
  if (user.role === 'crosshub') return where
  return { AND: [where, { id: { in: user.managedPartners.map((p) => p.id) } }] }
}

async function isNameTaken(name: string, exceptId?: string) {
  const found = await prisma.partner.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  return !!found
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

export async function createPartner(user: SessionUser, input: PartnerInput): Promise<PartnerResult> {
  // 연맹이 등록하면 항상 자기 대행 업체. 크로스허브만 운영방식을 고른다
  let proxyAffiliateId: string | null
  if (user.role === 'affiliate') proxyAffiliateId = user.affiliateId
  else if (user.role === 'crosshub') proxyAffiliateId = input.proxyAffiliateId
  else return { ok: false, error: 'forbidden' }

  if (user.role === 'affiliate' && !proxyAffiliateId) return { ok: false, error: 'invalidOrg' }
  if (proxyAffiliateId && !(await prisma.affiliate.findUnique({ where: { id: proxyAffiliateId }, select: { id: true } }))) {
    return { ok: false, error: 'invalidOrg' }
  }
  if (await isNameTaken(input.name)) return { ok: false, error: 'partnerNameTaken' }
  if (user.role === 'crosshub' && (await commissionBelowShares(input, proxyAffiliateId))) return { ok: false, error: 'commissionBelowShares' }

  const partner = await prisma.partner.create({
    data: { ...toData(input, user.role), proxyAffiliateId },
    select: partnerSelect,
  })
  await audit({ userId: user.id, action: 'partner_create', partnerId: partner.id, targetId: partner.id, targetName: partner.name })

  return { ok: true, partner: toRow(partner, user.role) }
}

export async function updatePartner(user: SessionUser, id: string, input: PartnerInput): Promise<PartnerResult> {
  const existing = await prisma.partner.findFirst({
    where: inScope(user, { id }),
    select: {
      id: true,
      proxyAffiliateId: true,
      commissionRate: true,
      currency: true,
      bankName: true,
      bankAccountNumber: true,
      bankAccountHolder: true,
      bankCode: true,
      name: true,
      businessRegistrationNumber: true,
      corporateName: true,
      representativeName: true,
      address: true,
      businessLicenseUrl: true,
      _count: { select: { users: true, products: { where: { bookings: { some: {} } } } } },
    },
  })
  if (!existing) return { ok: false, error: 'notFound' }
  // 통화는 예약이 생긴 뒤에는 못 바꾼다 — 이미 그 통화로 결제·정산된 금액이 있어서
  if (user.role === 'crosshub' && input.currency !== existing.currency && existing._count.products > 0) return { ok: false, error: 'currencyLocked' }

  // 운영방식은 크로스허브만 바꾼다. 연맹이 보낸 값은 무시한다
  const proxyAffiliateId = user.role === 'crosshub' ? input.proxyAffiliateId : existing.proxyAffiliateId
  if (proxyAffiliateId !== existing.proxyAffiliateId) {
    // 예약이 생긴 뒤에는 못 바꾼다 — 연맹 몫은 지금 대행 연맹 기준으로 모으므로, 바꾸면 지난 달 몫(지급완료 포함)이 새 연맹으로 넘어간다
    if (existing._count.products > 0) return { ok: false, error: 'proxyLocked' }
    if (proxyAffiliateId && !(await prisma.affiliate.findUnique({ where: { id: proxyAffiliateId }, select: { id: true } }))) {
      return { ok: false, error: 'invalidOrg' }
    }
    // 대행 업체는 계정 없이 연맹이 처리한다 (계정 발급도 직접 운영 업체에만 한다)
    if (proxyAffiliateId && existing._count.users > 0) return { ok: false, error: 'partnerHasAccounts' }
  }
  if (await isNameTaken(input.name, id)) return { ok: false, error: 'partnerNameTaken' }
  if (user.role === 'crosshub' && (await commissionBelowShares(input, proxyAffiliateId))) return { ok: false, error: 'commissionBelowShares' }

  const data = { ...toData(input, user.role), proxyAffiliateId }
  // 업체 수정은 수수료율·정산 계좌·사업자 정보가 바뀔 때만 작업 이력에 남긴다 (이전값·새값 포함). 담당자·연락처 수정은 남기지 않는다
  const rateChanged = 'commissionRate' in data && data.commissionRate !== existing.commissionRate
  // 정산 계좌가 바뀌면 이력에 남긴다. 계좌번호는 뒤 4자리만 (이력 화면에 전체 번호를 깔지 않는다)
  const bankFields = ['bankName', 'bankAccountNumber', 'bankAccountHolder', 'bankCode'] as const
  const bankDetail: AuditDetail = {}
  for (const key of bankFields) {
    if ((existing[key] ?? null) !== (data[key] ?? null)) bankDetail[key] = key === 'bankAccountNumber' ? [maskAccount(existing[key]), maskAccount(data[key])] : [existing[key], data[key]]
  }
  // 사업자 정보는 업체도 직접 고치므로(정산 계좌와 같이) 바뀐 칸만 이전값·새값으로 남긴다. 담당자·연락처는 남기지 않는다
  const infoFields = ['name', 'businessRegistrationNumber', 'corporateName', 'representativeName', 'address', 'businessLicenseUrl'] as const
  const infoDetail: AuditDetail = {}
  for (const key of infoFields) {
    if ((existing[key] ?? null) !== (data[key] ?? null)) infoDetail[key] = [existing[key], data[key]]
  }
  const [partner] = await prisma.$transaction([
    prisma.partner.update({ where: { id: existing.id }, data, select: partnerSelect }),
    // 업체 계정 이름은 업체명을 그대로 쓴다 (accounts/service.ts의 createAccount)
    prisma.user.updateMany({ where: { partnerId: existing.id }, data: { name: input.name } }),
    ...(rateChanged
      ? [
          audit({
            userId: user.id,
            action: 'partner_commission',
            partnerId: existing.id,
            targetId: existing.id,
            targetName: input.name,
            detail: { commissionRate: [existing.commissionRate, data.commissionRate ?? null] },
          }),
        ]
      : []),
    ...(Object.keys(bankDetail).length
      ? [audit({ userId: user.id, action: 'partner_bank', partnerId: existing.id, targetId: existing.id, targetName: input.name, detail: bankDetail })]
      : []),
    ...(Object.keys(infoDetail).length
      ? [audit({ userId: user.id, action: 'partner_info', partnerId: existing.id, targetId: existing.id, targetName: input.name, detail: infoDetail })]
      : []),
  ])
  return { ok: true, partner: toRow(partner, user.role) }
}

/** 활성화·비활성화. 크로스허브만.
 *  비활성 = 새로 파는 것만 멈춘다: 노출중 상품을 숨김으로 바꾸고(hiddenByPartnerOff 표시), 상품 등록·수정·노출을 막는다 (products/service.ts).
 *  남은 예약·문의는 마무리해야 하니 업체 계정 로그인과 연맹 접근은 그대로 둔다.
 *  다시 활성화할 때 restoreProducts면 표시해 둔 상품만 노출중으로 되돌린다. 어느 쪽이든 표시는 지운다 */
export async function togglePartnerActive(user: SessionUser, id: string, restoreProducts = false): Promise<PartnerResult> {
  if (user.role !== 'crosshub') return { ok: false, error: 'forbidden' }
  const existing = await prisma.partner.findUnique({ where: { id }, select: { active: true, name: true } })
  if (!existing) return { ok: false, error: 'notFound' }

  const active = !existing.active
  // 비활성화: 노출중 → 숨김. 활성화: 되돌리기를 골랐으면 비활성화로 숨긴 것 → 노출중
  const [from, to] = active ? (['hidden', 'live'] as const) : (['live', 'hidden'] as const)
  const moved =
    active && !restoreProducts
      ? []
      : await prisma.product.findMany({
          where: { partnerId: id, status: from, ...(active ? { hiddenByPartnerOff: true } : {}) },
          select: { id: true, name: true },
        })
  const [partner] = await prisma.$transaction([
    prisma.partner.update({ where: { id }, data: { active }, select: partnerSelect }),
    audit({ userId: user.id, action: active ? 'partner_activate' : 'partner_deactivate', partnerId: id, targetId: id, targetName: existing.name }),
    ...(moved.length
      ? [prisma.product.updateMany({ where: { id: { in: moved.map((p) => p.id) } }, data: { status: to, hiddenByPartnerOff: !active } })]
      : []),
    // 되돌리지 않고 활성화하면 표시만 지운다 (그 뒤로는 업체가 직접 숨긴 상품과 같다)
    ...(active && !restoreProducts
      ? [prisma.product.updateMany({ where: { partnerId: id, hiddenByPartnerOff: true }, data: { hiddenByPartnerOff: false } })]
      : []),
    ...moved.map((p) =>
      audit({ userId: user.id, action: 'product_status', partnerId: id, targetId: p.id, targetName: p.name, detail: { status: [from, to] } }),
    ),
  ])
  return { ok: true, partner: toRow(partner, user.role) }
}
