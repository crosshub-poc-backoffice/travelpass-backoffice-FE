// 판매 일정·예약 마감 검사.
import { saleRange } from '@/lib/products/schedule'
import { ruleChecker, type Finding } from '../types'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** 예약 마감 입력이 형태에 안 맞음 */
export const deadlineInvalid = ruleChecker('DEADLINE_INVALID', (t) => {
  const { deadlineDays, deadlineTime } = t.proposed
  const out: Finding[] = []
  if (!Number.isInteger(deadlineDays) || deadlineDays < 0 || deadlineDays > 365) {
    out.push({ code: 'DEADLINE_INVALID', severity: 'high', source: 'rule', field: 'deadlineDays', evidence: { deadlineDays } })
  }
  if (!TIME.test(deadlineTime)) {
    out.push({ code: 'DEADLINE_INVALID', severity: 'high', source: 'rule', field: 'deadlineTime', evidence: { deadlineTime } })
  }
  return out
})

/** 판매 일정에서 실제로 파는 날이 하나도 안 나온다 — 노출해도 아무도 예약할 수 없다.
 *  saleRange는 정리된(scheduleFor를 거친) 일정을 전제로 해서, 모양이 깨져 있으면 던진다.
 *  던지는 것도 "팔 수 있는 날이 없다"와 같은 뜻이라 같은 지적으로 묶는다.
 *
 *  등급이 low인 이유: saleStart/saleEnd는 지금 앱 어디서도 읽지 않아서, 판매기간이 비어 있는 게
 *  정말 비정상인지 확인하지 못했다. 실제 상품 데이터로 노이즈를 재본 뒤 등급을 정한다 (HANDOVER.md 참고) */
export const saleRangeEmpty = ruleChecker('SALE_RANGE_EMPTY', (t) => {
  try {
    if (saleRange(t.proposed.schedule)) return []
  } catch {
    // 아래에서 지적으로 남긴다
  }
  return [{ code: 'SALE_RANGE_EMPTY', severity: 'low', source: 'rule', field: 'schedule' }]
})

export const scheduleRules = [deadlineInvalid, saleRangeEmpty]
