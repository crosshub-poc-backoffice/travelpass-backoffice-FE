import 'server-only'

// 기록 목록 화면(작업 이력, 계정 관리의 로그 탭)이 같이 쓰는 주소값 해석. 기본 기간은 최근 30일 (일본 시간)

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function kstDay(daysAgo = 0) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function parsePage(page?: string) {
  return Math.max(1, Number.parseInt(page ?? '1', 10) || 1)
}

export function parseLogPeriod(sp: { from?: string; to?: string; page?: string }) {
  return {
    from: sp.from && DAY_PATTERN.test(sp.from) ? sp.from : kstDay(30),
    to: sp.to && DAY_PATTERN.test(sp.to) ? sp.to : kstDay(),
    page: parsePage(sp.page),
  }
}
