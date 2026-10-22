// TravelPass 고객 앱이 호출하는 /api/v1/* 전용 인증. 로그인 세션이 아니라 고정 API 키를 쓴다.
import 'server-only'
import { NextResponse } from 'next/server'
import type { ApiError } from './contract'

/** 통과하면 null, 실패하면 바로 돌려줄 응답을 준다: `const denied = requireApiKey(request); if (denied) return denied` */
export function requireApiKey(request: Request): NextResponse<ApiError> | null {
  const expected = process.env.TP_APP_API_KEY
  if (!expected) {
    const err: ApiError = { error: 'TP_APP_API_KEY가 서버에 설정되지 않았습니다.', code: 'INTERNAL_ERROR' }
    return NextResponse.json(err, { status: 500 })
  }

  const key = request.headers.get('x-api-key')
  if (key !== expected) {
    const err: ApiError = { error: 'API 키가 올바르지 않습니다.', code: 'UNAUTHORIZED' }
    return NextResponse.json(err, { status: 401 })
  }

  return null
}
