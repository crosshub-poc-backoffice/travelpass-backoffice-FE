import 'server-only'
import { redirect } from 'next/navigation'
import { getAccessToken } from '@/lib/server/auth/session'

/**
 * BE(Spring Boot) REST 호출 클라이언트.
 * FE의 데이터 접근을 prisma에서 이 클라이언트로 갈아끼우기 위한 공용 입구.
 *
 * - BASE_URL은 환경변수 BACKEND_API_URL (기본 http://localhost:8081)
 * - Keycloak으로 로그인한 세션이면 서버 DB에 보관된 access token을 Authorization: Bearer로 붙인다
 *   (만료 임박 시 session.ts가 refresh). BE는 이 토큰으로 서명·role·업체 범위를 확인한다.
 * - 로그인은 Keycloak으로만 하므로 로그인한 세션에는 항상 토큰이 있다. 토큰이 없으면 BE가 401을 준다.
 */
const BASE_URL = process.env.BACKEND_API_URL ?? 'http://localhost:8081'

export type PageResponse<T> = { rows: T[]; total: number; page: number; size: number }

/**
 * BE가 에러로 응답했을 때 던지는 에러. status로 404(없음)만 따로 처리하고 싶을 때 쓴다.
 * BE의 쓰기 API(상품·계정 등)는 실패 시 {code: "..."} 바디를 주는데(FE 에러 키와 같은 이름),
 * 파싱되면 code에 담긴다 — 호출부는 `e.code`를 FE의 기존 CreateResult 등 error 필드에 그대로 꽂으면 된다.
 */
export class BackendError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    // 백오피스 데이터는 매 요청 최신으로 (목록·상세 캐시 안 함)
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const code = (() => {
      try {
        const parsed = JSON.parse(body)
        return typeof parsed?.code === 'string' ? parsed.code : undefined
      } catch {
        return undefined
      }
    })()
    // 토큰 role ≠ DB role: 어느 화면도 쓸 수 없는 상태라 에러 화면 대신 로그아웃시키고 안내한다
    // (redirect는 서버 컴포넌트·서버 액션 어디서 불려도 동작한다)
    if (res.status === 403 && code === 'roleMismatch') redirect('/api/auth/role-mismatch')
    throw new BackendError(res.status, `BE ${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`, code)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const backend = {
  get: <T>(path: string, headers?: Record<string, string>) => request<T>(path, headers ? { headers } : undefined),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body), headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'PUT', body: body == null ? undefined : JSON.stringify(body), headers }),
  delete: <T>(path: string, headers?: Record<string, string>) => request<T>(path, { method: 'DELETE', headers }),
}

/** 쿼리스트링 조립 헬퍼 (빈 값은 생략). */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
