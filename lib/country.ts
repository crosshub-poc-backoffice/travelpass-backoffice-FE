// 예약 국적은 ISO 3166-1 국가코드(KR, JP …)로 저장하고, 화면에서 보는 사람 언어의 국가명으로 바꿔 보여준다.

const REGION_NAMES_EN = new Intl.DisplayNames(['en'], { type: 'region' })

/** 실제 국가코드인지 — 모르는 코드면 DisplayNames가 코드를 그대로 돌려준다. ZZ는 '알 수 없는 지역'이라 뺀다 */
export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value) && value !== 'ZZ' && REGION_NAMES_EN.of(value) !== value
}

/** 국가코드 → 화면 언어 국가명. 코드가 아닌 옛 값(자유 입력 글자)은 그대로 보여준다 */
export function countryName(value: string, locale: string): string {
  if (!isCountryCode(value)) return value
  return new Intl.DisplayNames([locale], { type: 'region' }).of(value) ?? value
}
