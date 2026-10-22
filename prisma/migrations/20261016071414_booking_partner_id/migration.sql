-- AlterTable: 일단 nullable로 추가
ALTER TABLE "Booking" ADD COLUMN "partnerId" TEXT;

-- Backfill: 기존 예약은 상품의 현재 소속 업체로 채운다
UPDATE "Booking" SET "partnerId" = "Product"."partnerId" FROM "Product" WHERE "Product"."id" = "Booking"."productId";

-- AlterTable: 백필 후 NOT NULL로 확정
ALTER TABLE "Booking" ALTER COLUMN "partnerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_partnerId_status_useDate_idx" ON "Booking"("partnerId", "status", "useDate");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
