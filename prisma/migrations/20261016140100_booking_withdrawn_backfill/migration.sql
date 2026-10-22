-- 고객이 견적을 거절한 예약(거절 + 고객응답 거절)은 업체 거절이 아니라 고객의 신청취소로 옮긴다.
-- (새 enum 값은 추가한 트랜잭션 안에서 못 써서 마이그레이션을 나눴다)
UPDATE "Booking" SET "status" = 'withdrawn' WHERE "status" = 'rejected' AND "customerDecision" = 'declined';
