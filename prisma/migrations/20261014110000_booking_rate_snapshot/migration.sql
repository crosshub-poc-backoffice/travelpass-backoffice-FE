-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "affiliateShareRate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pgFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0;


-- 기존 예약: 지금 연맹 몫(대행 업체만)과 통화별 PG 수수료율로 채운다
UPDATE "Booking" b
SET "affiliateShareRate" = COALESCE(af."shareRate", 0),
    "pgFeeRate"          = COALESCE(pg."feeRate", 0)
FROM "Product" pr
JOIN "Partner" pa ON pa."id" = pr."partnerId"
LEFT JOIN "Affiliate" af ON af."id" = pa."proxyAffiliateId"
LEFT JOIN "PgSetting" pg ON pg."currency" = pa."currency"
WHERE pr."id" = b."productId";
