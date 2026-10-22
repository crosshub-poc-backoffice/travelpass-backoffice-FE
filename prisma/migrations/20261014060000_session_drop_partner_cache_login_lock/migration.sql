-- 업체 범위는 요청마다 새로 조회한다. 세션에 저장해 둔 업체 목록 캐시를 지운다
ALTER TABLE "Session" DROP COLUMN "managedPartners";

-- 로그인 시도 제한: ID·IP별 최근 실패 횟수 조회
CREATE INDEX "LoginLog_loginId_createdAt_idx" ON "LoginLog"("loginId", "createdAt");
CREATE INDEX "LoginLog_ip_createdAt_idx" ON "LoginLog"("ip", "createdAt");
