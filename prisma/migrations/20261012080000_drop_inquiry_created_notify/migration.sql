-- 실시간 알림을 SSE(LISTEN/NOTIFY)에서 폴링으로 전환하면서 더 이상 쓰지 않는 트리거·함수를 제거한다.
-- (도입: 20261012014432_inquiry_created_notify)
DROP TRIGGER IF EXISTS inquiry_created_notify ON "Inquiry";
DROP FUNCTION IF EXISTS notify_inquiry_created();
