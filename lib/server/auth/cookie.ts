// proxy.ts도 쓰는 값이라 DB 코드와 분리해 둔다
export const SESSION_COOKIE = 'tp_session'

/** Keycloak Authorization Code 요청~콜백 사이 1회용 값(state·nonce·PKCE code_verifier)을 담아두는 임시 쿠키 (5분) */
export const KEYCLOAK_LOGIN_COOKIE = 'kc_login'
