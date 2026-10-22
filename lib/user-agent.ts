// 브라우저 정보(User-Agent)를 "Mac OS / Chrome / PC"처럼 짧게 줄인다. 라이브러리 없이 흔한 경우만 구분한다
export function describeUserAgent(ua: string | null): string {
  if (!ua) return '-'
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac OS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other'
  // Edge·Opera·삼성 브라우저도 Chrome·Safari 글자를 같이 갖고 있어서 먼저 확인한다
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Other'
  const device = /Mobi|iPhone|Android/.test(ua) ? 'Mobile' : 'PC'
  return `${os} / ${browser} / ${device}`
}
