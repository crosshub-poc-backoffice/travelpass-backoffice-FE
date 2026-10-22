// TP(Travel Pass)에 주는 외부 API(/api/v1/...)가 공통으로 쓰는 응답 모양.

export type ApiError = {
  error: string
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'INTERNAL_ERROR'
  fieldErrors?: Record<string, string>
}

export type Paginated<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
