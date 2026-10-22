// 업체 관리 입력 항목. 화면(입력칸)·Server Action(검증)·서비스(저장)가 같이 쓴다.

export type PartnerInput = {
  name: string
  /** 대행 제휴사. null이면 직접 운영 */
  proxyAffiliateId: string | null
  /** 수수료율(%). 0~100 정수 (DB Partner.commissionRate가 Int) */
  commissionRate: number | null
  /** 통화 (ISO 코드). 상품가·결제·정산이 전부 이 통화. 선택지는 결제 설정(PgSetting)에 등록된 통화 */
  currency: string
  managerName: string | null
  phone: string | null
  email: string | null
  bankName: string | null
  bankAccountNumber: string | null
  bankAccountHolder: string | null
  memo: string | null
  /** 사업자 정보 */
  businessRegistrationNumber: string | null
  representativeName: string | null
  corporateName: string | null
  address: string | null
  /** 사업자등록증 파일 URL (먼저 /api/partners/license로 올리고 받은 URL) */
  businessLicenseUrl: string | null
  subManager: string | null
  subManagerPhone: string | null
  /** 해외송금용 은행코드 (SWIFT/BIC) */
  bankCode: string | null
}

export const PARTNER_NAME_MAX = 50
export const PARTNER_TEXT_MAX = 100
export const PARTNER_MEMO_MAX = 1000

// 아직 DB에 맞는 칸이 없는 항목. 화면에서 입력칸을 막아 두고 저장하지 않는다. (지금은 없음 — 정산 계좌까지 연결됨)
export const PENDING_FIELDS: ReadonlySet<keyof PartnerInput | 'active'> = new Set()
