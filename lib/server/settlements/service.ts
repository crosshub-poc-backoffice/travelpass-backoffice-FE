import 'server-only'
import { backend, BackendError, qs } from '@/lib/api/backend'
import type { ErrorKey } from '@/lib/errors'
import type { SessionUser } from '@/lib/server/auth/session'
import { jstToday, shiftMonth } from '@/lib/settlements'

// 월별 정산. 계산·지급 처리는 BE(/api/v1/settlements)가 한다 — 지급대기 동안은 예약에서 그때그때 계산하고,
// 크로스허브가 지급완료하는 순간 금액을 Settlement 행에 굳힌다. 지급 취소하면 행을 지워 다시 계산 상태로 돌아간다.
// 범위: 업체 전환으로 고른 업체가 있으면 그 업체(partnerId), 없으면 BE가 토큰 기준으로 관리 범위 전체.

export type SettlementLine = {
  bookingId: string
  productId: string
  productName: string
  /** productName이 보는 사람 언어의 AI 번역이면 true (페이지에서 채운다) */
  productNameAi?: boolean
  useDate: string
  status: string
  /** 정산 기준 금액: 이용완료는 판매가, 취소·환불은 취소 수수료 */
  base: number
  commissionRate: number
  commission: number
  net: number
  isCancel: boolean
  /** 수수료 안의 배분. 예약 시점에 박힌 요율로 계산. 크로스허브에게만 오고 그 외엔 null (마진이 드러나서) */
  affiliateShareRate: number | null
  affiliate: number | null
  pgFeeRate: number | null
  pg: number | null
}

export type SettlementRow = {
  partnerId: string
  partnerName: string
  currency: string
  /** 그 달 예약들의 수수료율. 섞이면 "12~15". 건이 없으면 업체의 지금 요율 */
  commissionRateLabel: string
  gross: number
  commission: number
  net: number
  bookingCount: number
  status: 'pending' | 'paid'
  payDate: string | null
  lines: SettlementLine[]
  /** 송금할 정산 계좌 "은행 계좌번호 (예금주)". 크로스허브만. 미등록이면 null */
  bankAccount: string | null
  /** 수수료 배분 (크로스허브만). 건별 스냅샷의 합. PG 설정이 없으면 pgName null */
  distribution: {
    pgName: string | null
    pgFeeRateLabel: string
    pg: number
    affiliateName: string | null
    affiliateShareRateLabel: string
    affiliate: number
    crosshub: number
  } | null
}

/** 그 달의 업체별 정산. 크로스허브는 전체(업체 전환 시 그 업체), 연맹은 대행 업체, 업체는 자기 업체 */
export async function listMonthlySettlements(user: SessionUser, month: string): Promise<SettlementRow[]> {
  return backend.get<SettlementRow[]>(`/api/v1/settlements${qs({ month, partnerId: user.activePartnerId ?? undefined })}`)
}

type Result = { ok: true } | { ok: false; error: ErrorKey }

async function call(path: string, body: unknown): Promise<Result> {
  try {
    await backend.post(path, body)
    return { ok: true }
  } catch (e) {
    if (e instanceof BackendError) {
      if (e.code) return { ok: false, error: e.code as ErrorKey }
      if (e.status === 404) return { ok: false, error: 'notFound' }
    }
    throw e
  }
}

/** 지급완료 처리. 크로스허브만 (BE가 확인). 지금 계산된 금액을 굳힌다 */
export async function markSettlementPaid(_user: SessionUser, partnerId: string, period: string, payDate: string): Promise<Result> {
  return call('/api/v1/settlements/pay', { partnerId, period, payDate })
}

/** 지급완료 취소. 행을 지워 다시 예약 기준으로 계산되게 한다 */
export async function unmarkSettlementPaid(_user: SessionUser, partnerId: string, period: string): Promise<Result> {
  return call('/api/v1/settlements/unpay', { partnerId, period })
}

// ── 연맹 지급 ──────────────────────────────────────────────────────────────
// 연맹 몫 = 대행 업체 예약마다 (정산 기준 금액 × 예약 때 박힌 연맹 몫 %p)의 합. 업체 지급과 따로 월 1회

export type AffiliateSettlementRow = {
  affiliateId: string
  affiliateName: string
  currency: string
  /** 그 달 예약들의 연맹 몫 %p. 섞이면 "4~5". 건이 없으면 지금 설정값 */
  shareRateLabel: string
  amount: number
  partnerCount: number
  status: 'pending' | 'paid'
  payDate: string | null
  /** 연맹 몫을 송금할 계좌 "은행 계좌번호 (예금주)". 미등록이면 null */
  bankAccount: string | null
}

/** 그 달의 연맹 몫. 크로스허브는 연맹 전체, 연맹은 자기 것만, 업체는 없음 */
export async function listAffiliateSettlements(user: SessionUser, month: string): Promise<AffiliateSettlementRow[]> {
  if (user.role === 'partner') return []
  return backend.get<AffiliateSettlementRow[]>(`/api/v1/settlements/affiliates${qs({ month })}`)
}

/** 연맹 지급완료 처리. 크로스허브만. 지금 계산된 연맹 몫을 굳힌다 */
export async function markAffiliateSettlementPaid(_user: SessionUser, affiliateId: string, period: string, currency: string, payDate: string): Promise<Result> {
  return call('/api/v1/settlements/affiliates/pay', { affiliateId, period, currency, payDate })
}

export async function unmarkAffiliateSettlementPaid(_user: SessionUser, affiliateId: string, period: string, currency: string): Promise<Result> {
  return call('/api/v1/settlements/affiliates/unpay', { affiliateId, period, currency })
}

export type PendingSettlementRow = {
  id: string
  partnerName: string
  period: string
  currency: string
  gross: number
  commission: number
  /** "15" 또는 업체 안에서 섞이면 "12~15" */
  commissionRate: string
  net: number
}

/** 대시보드 "정산 요약": 지난달 이용분 중 아직 송금 안 한 업체. 정산 화면과 같은 계산(BE)을 쓴다 */
export async function listPendingSettlements(user: SessionUser): Promise<PendingSettlementRow[]> {
  const period = shiftMonth(jstToday().slice(0, 7), -1)
  const rows = await listMonthlySettlements(user, period)
  return rows
    .filter((r) => r.status === 'pending' && r.bookingCount > 0)
    .map((r) => ({
      id: `${r.partnerId}-${period}`,
      partnerName: r.partnerName,
      period,
      currency: r.currency,
      gross: r.gross,
      commission: r.commission,
      commissionRate: r.commissionRateLabel,
      net: r.net,
    }))
}
