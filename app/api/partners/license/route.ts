// 사업자등록증 업로드 (업체 관리 화면 내부용). multipart로 file 하나를 받아 저장하고 URL을 돌려준다.
// 업체 저장과 별개로 먼저 올라가므로, 저장을 취소하면 파일이 남을 수 있다 (상품 사진과 같이 PoC에서는 그대로 둔다).
import { NextResponse } from 'next/server'
import { requireApiSession } from '@/lib/api/session.server'
import type { ApiError } from '@/lib/api/contract'
import { LICENSE_MAX_BYTES, putPartnerLicense, sniffLicenseType } from '@/lib/storage'

export async function POST(request: Request) {
  const auth = await requireApiSession('partners', 'edit')
  if ('response' in auth) return auth.response

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json<ApiError>({ error: 'file', code: 'VALIDATION_ERROR' }, { status: 400 })
  if (file.size > LICENSE_MAX_BYTES) return NextResponse.json<ApiError>({ error: 'tooLarge', code: 'VALIDATION_ERROR' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffLicenseType(bytes)
  if (!mime) return NextResponse.json<ApiError>({ error: 'licenseType', code: 'VALIDATION_ERROR' }, { status: 400 })

  const url = await putPartnerLicense(bytes, mime)
  return NextResponse.json({ url })
}
