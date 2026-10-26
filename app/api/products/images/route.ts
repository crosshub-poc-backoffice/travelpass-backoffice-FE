// 상품 사진 업로드 (화면 내부용). multipart로 file 하나를 받아 저장하고 URL을 돌려준다.
// 사진은 상품 저장과 별개로 먼저 올라가므로, 저장을 취소하면 파일이 남을 수 있다 (PoC에서는 그대로 둔다).
import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import type { ApiError } from '@/lib/api/contract'
import { IMAGE_MAX_BYTES, IMAGE_TYPES, putProductImage, sniffImageType } from '@/lib/storage'

export async function POST(request: Request) {
  const auth = await requireApiSession('products', 'edit')
  if ('response' in auth) return auth.response

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json<ApiError>({ error: 'file', code: 'VALIDATION_ERROR' }, { status: 400 })
  if (file.size > IMAGE_MAX_BYTES) return NextResponse.json<ApiError>({ error: 'tooLarge', code: 'VALIDATION_ERROR' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffImageType(bytes)
  if (!mime || !IMAGE_TYPES[mime]) return NextResponse.json<ApiError>({ error: 'imageType', code: 'VALIDATION_ERROR' }, { status: 400 })

  const url = await putProductImage(bytes, mime)
  return NextResponse.json({ url })
}
