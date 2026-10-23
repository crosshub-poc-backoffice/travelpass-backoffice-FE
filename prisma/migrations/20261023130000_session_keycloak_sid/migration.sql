-- 백채널 로그아웃: Keycloak logout token의 sid/sub로 세션을 찾아 지운다
ALTER TABLE "Session" ADD COLUMN "kcSid" TEXT;
ALTER TABLE "Session" ADD COLUMN "kcSub" TEXT;
CREATE INDEX "Session_kcSid_idx" ON "Session"("kcSid");
CREATE INDEX "Session_kcSub_idx" ON "Session"("kcSub");
