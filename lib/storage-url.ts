// 사진 공개 URL의 앞부분. 서버(validate·업체 저장)에서 쓴다. 로컬 기본값은 BE 레포 infra/local/docker-compose.yml의 RustFS.
// 파일은 BE 가 저장한다(storage/ObjectStorage). 여기서는 공개 URL 모양만 안다 — 값은 BE 의 S3_ENDPOINT·S3_BUCKET·S3_PUBLIC_URL 과 같게 둔다.
export const LOCAL_S3 = {
  endpoint: 'http://localhost:9000',
  bucket: 'product-images',
}

export function imagePublicUrl(): string {
  const endpoint = process.env.S3_ENDPOINT || LOCAL_S3.endpoint
  const bucket = process.env.S3_BUCKET || LOCAL_S3.bucket
  return (process.env.S3_PUBLIC_URL || `${endpoint}/${bucket}`).replace(/\/$/, '')
}
