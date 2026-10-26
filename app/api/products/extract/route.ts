// 상품 소개서 업로드 → 등록 화면 초안 (화면 내부용). multipart로 file 하나를 받는다.
// 원본은 무엇을 보고 채웠는지 남기려고 같이 보관한다 — 상품 저장과 별개라 저장을 취소하면 파일이 남을 수 있다 (PoC에서는 그대로 둔다).
import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import type { ApiError } from '@/lib/api/contract'
import { UpstageError, extractProductDraft, usingSample } from '@/lib/api/upstage.server'
import { toProductDraft } from '@/lib/products/extract-map'
import { DOCUMENT_MAX_BYTES, putProductDocument, sniffDocumentType } from '@/lib/storage'

// 문서를 읽고 값을 뽑는 데 분 단위가 걸린다 (기본값으로는 끊긴다)
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireApiSession('products', 'edit')
  if ('response' in auth) return auth.response

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json<ApiError>({ error: 'file', code: 'VALIDATION_ERROR' }, { status: 400 })
  if (file.size > DOCUMENT_MAX_BYTES) return NextResponse.json<ApiError>({ error: 'tooLarge', code: 'VALIDATION_ERROR' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffDocumentType(bytes, file.name)
  if (!mime) return NextResponse.json<ApiError>({ error: 'documentType', code: 'VALIDATION_ERROR' }, { status: 400 })

  try {
    const draft = toProductDraft(await extractProductDraft(bytes, mime))
    // 추출이 끝난 뒤에 올린다 — 읽지 못한 문서까지 쌓아두지 않는다.
    // 화면은 이 주소를 쓰지 않는다. 뽑아낸 값이 이상할 때 원본을 열어보려고 로그에만 남긴다
    putProductDocument(bytes, mime)
      .then((url) => console.log(`상품 소개서 추출: ${url}`))
      .catch((e) => console.error('상품 소개서 보관 실패', e))
    return NextResponse.json({ draft, sample: usingSample() })
  } catch (e) {
    if (e instanceof UpstageError) return NextResponse.json<ApiError>({ error: e.message, code: 'INTERNAL_ERROR' }, { status: 502 })
    throw e
  }
}
