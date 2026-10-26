// 사진 공개 URL의 앞부분. 서버(validate·storage)에서 쓴다. 로컬 기본값은 BE 레포 infra/local/docker-compose.yml의 RustFS.
// 환경변수는 lib/storage.ts 설명 참고.
export const LOCAL_S3 = {
  endpoint: 'http://localhost:9000',
  bucket: 'product-images',
  accessKey: 'rustfsadmin',
  secretKey: 'rustfsadmin',
}

export function imagePublicUrl(): string {
  const endpoint = process.env.S3_ENDPOINT || LOCAL_S3.endpoint
  const bucket = process.env.S3_BUCKET || LOCAL_S3.bucket
  return (process.env.S3_PUBLIC_URL || `${endpoint}/${bucket}`).replace(/\/$/, '')
}
