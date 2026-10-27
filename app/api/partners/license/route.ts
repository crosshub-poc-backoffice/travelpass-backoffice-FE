// 사업자등록증 업로드 (업체 관리 화면 내부용). multipart로 file 하나를 받아 BE 가 저장하고 URL을 돌려준다 (BE storage/UploadController).
// 업체 저장과 별개로 먼저 올라가므로, 저장을 취소하면 파일이 남을 수 있다 (상품 사진과 같이 PoC에서는 그대로 둔다).
import { forward } from '@/lib/api/backend'

export async function POST(request: Request) {
  return forward('/api/v1/uploads/partner-licenses', await request.formData())
}
