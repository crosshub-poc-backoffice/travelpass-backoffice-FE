-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('payment', 'refund');

-- CreateEnum
CREATE TYPE "SettlementBasis" AS ENUM ('completed', 'paid');

-- AlterTable
ALTER TABLE "Affiliate" ADD COLUMN     "shareRate" INTEGER;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancelFee" INTEGER,
ADD COLUMN     "commission" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "commissionRate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "net" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'JPY';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "pg" TEXT NOT NULL,
    "pgTransactionId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PgSetting" (
    "currency" TEXT NOT NULL,
    "pgName" TEXT NOT NULL,
    "feeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basis" "SettlementBasis" NOT NULL DEFAULT 'completed',
    "payDay" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PgSetting_pkey" PRIMARY KEY ("currency")
);

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 기존 예약의 금액 스냅샷 채우기: 지금 업체 수수료율로 수수료·정산액 계산 (비어 있으면 0%)
UPDATE "Booking" b
SET "commissionRate" = COALESCE(pa."commissionRate", 0),
    "commission"     = ROUND(b."amount" * COALESCE(pa."commissionRate", 0) / 100.0),
    "net"            = b."amount" - ROUND(b."amount" * COALESCE(pa."commissionRate", 0) / 100.0)
FROM "Product" pr
JOIN "Partner" pa ON pa."id" = pr."partnerId"
WHERE pr."id" = b."productId";
