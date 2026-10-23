import 'server-only'
import { prisma } from '@/lib/db'
import { backend, BackendError, qs } from '@/lib/api/backend'
import type { PaymentType } from '@/lib/generated/prisma/client'
import type { ErrorKey } from '@/lib/errors'
import type { SessionUser } from '@/lib/server/auth/session'

// 결제 설정(통화별 PG)·연맹 몫·결제내역. 숫자는 전부 DB 설정값이라 코드에 박힌 수수료율이 없다

export type PgSettingRow = { currency: string; pgName: string; feeRate: number; payDay: number }

export async function listPgSettings(): Promise<PgSettingRow[]> {
  return backend.get<PgSettingRow[]>('/api/v1/pg-settings')
}

/** 결제 행에 복사해 둘 PG사명. 그 통화에 설정이 없으면 '-' */
export async function pgNameFor(currency: string): Promise<string> {
  const found = await prisma.pgSetting.findUnique({ where: { currency }, select: { pgName: true } })
  return found?.pgName ?? '-'
}

type Result = { ok: true } | { ok: false; error: ErrorKey }

/** BE 쓰기 호출. 실패는 BE가 주는 {code}(FE 에러 키와 같은 이름)를 그대로 돌려준다 */
async function call(run: () => Promise<unknown>): Promise<Result> {
  try {
    await run()
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.code) return { ok: false, error: e.code as ErrorKey }
      if (e.status === 404) return { ok: false, error: 'notFound' }
      if (e.status === 403) return { ok: false, error: 'forbidden' }
    }
    throw e
  }
}

/** 통화별 PG 설정 등록·수정. 크로스허브만. 검사(수수료 하한)·저장·작업 이력은 BE가 한다 */
export async function savePgSetting(_user: SessionUser, input: PgSettingRow): Promise<Result> {
  return call(() => backend.put(`/api/v1/pg-settings/${encodeURIComponent(input.currency)}`, { pgName: input.pgName, feeRate: input.feeRate, payDay: input.payDay }))
}

export type AffiliateBank = { bankName: string | null; bankAccountNumber: string | null; bankAccountHolder: string | null }
export type AffiliateShareRow = { id: string; name: string; shareRate: number | null } & AffiliateBank

export async function listAffiliateShares(): Promise<AffiliateShareRow[]> {
  return backend.get<AffiliateShareRow[]>('/api/v1/affiliate-shares')
}

export type MyAffiliate = { name: string; shareRate: number | null } & AffiliateBank

/** 연맹 계정의 "내 연맹 정보" */
export async function getMyAffiliate(user: SessionUser): Promise<MyAffiliate | null> {
  if (user.role !== 'affiliate' || !user.affiliateId) return null
  try {
    return await backend.get<MyAffiliate>('/api/v1/my-affiliate')
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return null
    throw e
  }
}

/** 연맹이 자기 정산 계좌를 고친다. 연맹 몫은 크로스허브만 (결제 설정) */
export async function saveMyAffiliateBank(_user: SessionUser, bank: AffiliateBank): Promise<Result> {
  return call(() => backend.put('/api/v1/my-affiliate/bank', bank))
}

/** 연맹 몫(%p)·정산 계좌 변경. 크로스허브만. 수수료 하한 검사·저장·이력(몫/계좌 따로, 계좌번호 뒤 4자리)은 BE가 한다 */
export async function saveAffiliateShare(_user: SessionUser, id: string, shareRate: number | null, bank: AffiliateBank): Promise<Result> {
  return call(() => backend.put(`/api/v1/affiliate-shares/${encodeURIComponent(id)}`, { shareRate, ...bank }))
}

export type PaymentRow = {
  id: string
  createdAt: string
  bookingId: string
  partner: string
  currency: string
  productId: string
  productName: string
  /** productName이 보는 사람 언어의 AI 번역이면 true (페이지에서 채운다) */
  productNameAi?: boolean
  type: PaymentType
  amount: number
  pg: string
  pgTransactionId: string | null
}

export type PaymentFilter = { from: string; to: string; type: PaymentType | null; page: number }

/** 결제내역. 범위: 업체 전환으로 고른 업체가 있으면 그 업체, 없으면 BE가 토큰 기준 관리 범위 전체 */
export async function listPayments(user: SessionUser, filter: PaymentFilter): Promise<{ rows: PaymentRow[]; total: number }> {
  const res = await backend.get<{ rows: PaymentRow[]; total: number }>(
    `/api/v1/payments${qs({ from: filter.from, to: filter.to, type: filter.type ?? undefined, page: filter.page, partnerId: user.activePartnerId ?? undefined })}`,
  )
  return { rows: res.rows, total: res.total }
}
