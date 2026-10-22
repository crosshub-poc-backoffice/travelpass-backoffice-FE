import 'server-only'
import { prisma } from '@/lib/db'
import type { ProductInput } from '@/lib/products/types'
import { blocksFor, cancelRulesFor, priceTableFor, scheduleFor } from '@/lib/products/validate'
import { runInspection, type RunOptions } from './pipeline'
import { CHECKERS } from './registry'
import type { Finding, InspectResult, InspectTarget, Verdict } from './types'

// 검수 파이프라인과 DB 사이. 파이프라인 자체(pipeline.ts)는 DB를 모른다.
// 권한은 여기서 보지 않는다 — 부르는 Server Action·Route Handler가 각각 확인한다.

const PRODUCT_SELECT = {
  id: true,
  partnerId: true,
  category: true,
  name: true,
  images: true,
  description: true,
  deadlineDays: true,
  deadlineTime: true,
  confirmType: true,
  schedule: true,
  cancelRules: true,
  priceTable: true,
  blocks: true,
} as const

type ProductRow = {
  partnerId: string
  category: ProductInput['category']
  name: string
  images: string[]
  description: string
  deadlineDays: number
  deadlineTime: string
  confirmType: ProductInput['confirmType']
  schedule: unknown
  cancelRules: unknown
  priceTable: unknown
  blocks: unknown
}

/** DB 행을 검수 입력(ProductInput)으로. Json 칸은 화면이 쓰는 모양으로 정리해서 꺼낸다 */
export function productInputFrom(row: ProductRow): ProductInput {
  return {
    partnerId: row.partnerId,
    category: row.category,
    name: row.name,
    images: row.images,
    description: row.description,
    deadlineDays: row.deadlineDays,
    deadlineTime: row.deadlineTime,
    confirmType: row.confirmType,
    schedule: scheduleFor(row.schedule),
    cancelRules: cancelRulesFor(row.cancelRules),
    priceTable: priceTableFor(row.priceTable),
    blocks: blocksFor(row.blocks),
  }
}

async function save(productId: string, changeRequestId: string | null, result: InspectResult) {
  await prisma.productInspection.create({
    data: {
      productId,
      changeRequestId,
      status: 'done',
      verdict: result.verdict,
      aiRan: result.aiRan,
      findings: result.findings as unknown as object[],
    },
    select: { id: true },
  })
}

/** 상품 한 건 검수(최초 심사용). 결과를 ProductInspection에 남기고 돌려준다 */
export async function inspectProduct(productId: string, options: RunOptions = {}): Promise<InspectResult | null> {
  const row = await prisma.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT })
  if (!row) return null
  const target: InspectTarget = { kind: 'product', current: null, proposed: productInputFrom(row) }
  const result = await runInspection(target, CHECKERS, options)
  await save(productId, null, result)
  return result
}

/** 변경요청 검수. 지금 상품(current)과 수정안(proposed)을 함께 넘겨 "이 수정이 수상한가"를 본다 */
export async function inspectChangeRequest(changeRequestId: string, options: RunOptions = {}): Promise<InspectResult | null> {
  const cr = await prisma.productChangeRequest.findUnique({
    where: { id: changeRequestId },
    select: { id: true, productId: true, proposedData: true, product: { select: PRODUCT_SELECT } },
  })
  if (!cr?.proposedData) return null
  const proposedRow = cr.proposedData as unknown as Partial<ProductRow>
  const current = productInputFrom(cr.product)
  const target: InspectTarget = {
    kind: 'product',
    current,
    // proposedData는 ProductInput 전체 스냅샷이다 (prisma/schema.prisma의 ProductChangeRequest 주석)
    proposed: productInputFrom({ ...cr.product, ...proposedRow } as ProductRow),
  }
  const result = await runInspection(target, CHECKERS, options)
  await save(cr.productId, cr.id, result)
  return result
}

/** after()에서 부르는 백그라운드 판정. 실패해도 저장·심사 흐름을 막지 않는다 */
export async function inspectProductInBackground(productId: string): Promise<void> {
  try {
    await inspectProduct(productId)
  } catch (e) {
    console.error('[inspect] 백그라운드 검수 실패', productId, e)
    try {
      await prisma.productInspection.create({
        data: { productId, status: 'failed', verdict: 'pass', aiRan: false, findings: [] },
        select: { id: true },
      })
    } catch {
      // 실패 기록까지 실패하면 로그만 남기고 조용히 끝낸다
    }
  }
}

export type StoredInspection = {
  id: string
  status: string
  verdict: Verdict
  aiRan: boolean
  findings: Finding[]
  createdAt: string
  changeRequestId: string | null
}

/** 가장 최근 검수 결과. 없으면 null */
export async function latestInspection(productId: string, changeRequestId?: string): Promise<StoredInspection | null> {
  const row = await prisma.productInspection.findFirst({
    where: { productId, ...(changeRequestId ? { changeRequestId } : {}) },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    verdict: row.verdict as Verdict,
    aiRan: row.aiRan,
    findings: row.findings as unknown as Finding[],
    createdAt: row.createdAt.toISOString(),
    changeRequestId: row.changeRequestId,
  }
}
