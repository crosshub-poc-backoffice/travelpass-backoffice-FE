'use client'

// 사진 업로드 처리(상품 등록 화면 전용). 긴 변 1,600px JPEG로 줄여 /api/products/images에 올리고 공개 URL을 돌려준다.
// 아이폰 HEIC는 브라우저가 못 읽는 경우(Chrome·Edge)가 있어 heic-to(wasm)로 먼저 JPEG로 바꾼다.
const MAX_EDGE = 1600

const looksHeic = (file: File) => /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)

async function decodable(file: File): Promise<Blob> {
  if (!looksHeic(file)) return file
  const { heicTo } = await import('heic-to/next')
  return heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 })
}

async function shrink(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(await decodable(file))
  } catch {
    return null
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
}

export async function uploadProductImage(file: File): Promise<string> {
  const blob = await shrink(file)
  if (!blob) throw new Error('decode')
  const body = new FormData()
  body.append('file', blob, 'photo.jpg')
  const res = await fetch('/api/products/images', { method: 'POST', body })
  if (!res.ok) throw new Error('upload')
  const { url } = (await res.json()) as { url: string }
  return url
}
