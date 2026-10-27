// 상품 사진 업로드 (화면 내부용). multipart로 file 하나를 받아 BE 가 저장하고 URL을 돌려준다 (BE storage/UploadController).
// 저장소 키는 BE 에만 있다. 사진은 상품 저장과 별개로 먼저 올라가므로, 저장을 취소하면 파일이 남을 수 있다 (PoC에서는 그대로 둔다).
import { forward } from '@/lib/api/backend'

export async function POST(request: Request) {
  return forward('/api/v1/uploads/product-images', await request.formData())
}
