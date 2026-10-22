// 상품 사진 저장. DB에는 여기서 돌려주는 공개 URL만 넣는다.
// S3 프로토콜로 올리므로 로컬(RustFS, docker-compose)·Supabase Storage·NCP Object Storage·AWS S3 모두 같은 코드로 붙는다.
//
// 환경변수 (없으면 로컬 RustFS 기본값):
//   S3_ENDPOINT     예) https://xxxx.supabase.co/storage/v1/s3, https://kr.object.ncloudstorage.com
//   S3_REGION       Supabase는 프로젝트 리전(예: ap-northeast-2), NCP는 kr-standard
//   S3_BUCKET       공개 읽기 버킷 이름 (기본 product-images)
//   S3_ACCESS_KEY / S3_SECRET_KEY
//   S3_PUBLIC_URL   공개 URL 앞부분. Supabase는 https://xxxx.supabase.co/storage/v1/object/public/product-images 처럼
//                   업로드 주소와 다르므로 꼭 넣는다. 비우면 S3_ENDPOINT/S3_BUCKET
import 'server-only'
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import { LOCAL_S3, imagePublicUrl } from './storage-url'

export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

const BUCKET = process.env.S3_BUCKET || LOCAL_S3.bucket
const PUBLIC_URL = imagePublicUrl()
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT || LOCAL_S3.endpoint,
  region: process.env.S3_REGION || 'ap-northeast-2',
  forcePathStyle: true, // RustFS·Supabase는 경로 방식(host/bucket/key)
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || LOCAL_S3.accessKey,
    secretAccessKey: process.env.S3_SECRET_KEY || LOCAL_S3.secretKey,
  },
})

/** 버킷이 없으면 만들고 공개 읽기로 둔다 (로컬 RustFS용. 배포 버킷은 미리 만들어 둔다) */
let bucketReady: Promise<void> | null = null
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: BUCKET }))
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }))
      const policy = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${BUCKET}/*`] }] }
      await client.send(new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: JSON.stringify(policy) }))
    }
  })().catch((e) => {
    bucketReady = null // 다음 업로드 때 다시 시도
    throw e
  })
  return bucketReady
}

/** 파일 앞부분으로 실제 이미지인지 확인한다 (확장자·content-type만 믿지 않는다) */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

/** 사진을 올리고 화면·DB에 쓸 공개 URL을 돌려준다 */
export async function putProductImage(bytes: Uint8Array, mime: string): Promise<string> {
  await ensureBucket()
  const key = `products/${randomUUID()}.${IMAGE_TYPES[mime]}`
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }))
  return `${PUBLIC_URL}/${key}`
}

// 사업자등록증. 사진(JPG·PNG) 또는 PDF. 상품 사진과 같은 버킷의 partners/ 아래에 둔다 (주소를 아는 사람만 열 수 있는 무작위 이름)
export const LICENSE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
export const LICENSE_MAX_BYTES = 10 * 1024 * 1024

export function sniffLicenseType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf' // %PDF
  const image = sniffImageType(bytes)
  return image && LICENSE_TYPES[image] ? image : null
}

export async function putPartnerLicense(bytes: Uint8Array, mime: string): Promise<string> {
  await ensureBucket()
  const key = `partners/${randomUUID()}.${LICENSE_TYPES[mime]}`
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime }))
  return `${PUBLIC_URL}/${key}`
}

// 상품 소개서. 등록 화면을 채우려고 Upstage에 보내는 원본 — 무엇을 보고 채웠는지 남겨두려고 같이 보관한다.
// 50MB는 Upstage 상한에 맞춘 값.
export const DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/haansofthwp': 'hwp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024

const starts = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b)

/** OOXML(docx·xlsx·pptx)·HWPX는 전부 ZIP이라 앞부분만으로는 구분되지 않는다.
 *  Upstage는 content-type이 아니라 파일 내용을 보고 처리하므로, ZIP·OLE는 확장자로 종류를 정한다 */
export function sniffDocumentType(bytes: Uint8Array, filename: string): string | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf' // %PDF
  const image = sniffImageType(bytes)
  if (image && DOCUMENT_TYPES[image]) return image

  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return ext === 'hwp' ? 'application/haansofthwp' : null // 옛 한글·옛 오피스(OLE)
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    if (ext === 'hwpx') return 'application/haansofthwp'
  }
  return null
}

export async function putProductDocument(bytes: Uint8Array, mime: string): Promise<string> {
  await ensureBucket()
  const key = `product-docs/${randomUUID()}.${DOCUMENT_TYPES[mime]}`
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime }))
  return `${PUBLIC_URL}/${key}`
}
