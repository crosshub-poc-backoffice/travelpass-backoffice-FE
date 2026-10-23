-- Keycloak 로그인 세션: 토큰을 서버 DB에 보관 (브라우저엔 세션 쿠키만)
ALTER TABLE "Session" ADD COLUMN "kcAccessToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "kcAccessExpiresAt" TIMESTAMPTZ;
ALTER TABLE "Session" ADD COLUMN "kcRefreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "kcIdToken" TEXT;
