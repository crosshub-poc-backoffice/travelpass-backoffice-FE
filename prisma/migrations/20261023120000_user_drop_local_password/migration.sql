-- 로그인·비밀번호는 Keycloak이 관리한다 → 앱 DB의 비밀번호 해시와 '첫 로그인 비번 변경' 플래그 제거
-- ('대기' 상태는 lastLoginAt IS NULL로 판단한다)
ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" DROP COLUMN "mustChangePassword";
