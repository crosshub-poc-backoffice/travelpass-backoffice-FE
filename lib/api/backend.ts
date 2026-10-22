import 'server-only'

/**
 * BE(Spring Boot) REST 호출 클라이언트.
 * FE의 데이터 접근을 prisma에서 이 클라이언트로 갈아끼우기 위한 공용 입구.
 *
 * - BASE_URL은 환경변수 BACKEND_API_URL (기본 http://localhost:8081)
 * - 지금은 BE가 dev 모드(토큰 없이 허용)라 Authorization 없이 호출한다.
 *   Keycloak을 붙이면 여기서 Bearer 토큰을 붙이면 된다 (TODO).
 */
const BASE_URL = process.env.BACKEND_API_URL ?? 'http://localhost:8081'

export type PageResponse<T> = { rows: T[]; total: number; page: number; size: number }

/** BE가 에러로 응답했을 때 던지는 에러. status로 404(없음)만 따로 처리하고 싶을 때 쓴다. */
export class BackendError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // TODO(keycloak): Authorization: `Bearer ${token}`
      ...(init?.headers ?? {}),
    },
    // 백오피스 데이터는 매 요청 최신으로 (목록·상세 캐시 안 함)
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new BackendError(res.status, `BE ${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`)
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
}

/** dev 전용: BE에게 "이 사용자로 로그인한 것처럼" 보게 하는 헤더 (CallerService가 읽음).
 *  사용자 단위 데이터(notifications의 event log)에서만 쓴다 — products/bookings/inquiries처럼
 *  업체범위를 FE가 직접 거르는 쪽은 BE가 crosshub-전체 뷰를 줘야 하므로 이 헤더를 보내면 안 된다.
 *  Keycloak 붙으면 이 헤더와 호출부를 같이 지운다. */
export function devLoginHeader(loginId: string): Record<string, string> {
  return { 'X-Dev-Login-Id': loginId }
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
