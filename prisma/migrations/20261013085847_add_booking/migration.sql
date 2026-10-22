-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'quoted', 'confirmed', 'rejected', 'completed', 'canceled', 'refunded');

-- CreateEnum
CREATE TYPE "CustomerDecision" AS ENUM ('waiting', 'accepted', 'declined');

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "useDate" DATE NOT NULL,
    "people" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'pending',
    "confirmType" "ConfirmType" NOT NULL,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quoteAmount" INTEGER,
    "quoteValidUntil" DATE,
    "quoteMessage" TEXT,
    "customerDecision" "CustomerDecision",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_productId_idx" ON "Booking"("productId");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
