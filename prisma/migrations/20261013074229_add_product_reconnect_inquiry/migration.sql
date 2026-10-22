-- CreateEnum
CREATE TYPE "ConfirmType" AS ENUM ('instant', 'quote');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('review', 'live', 'hidden');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'review',
    "confirmType" "ConfirmType" NOT NULL DEFAULT 'instant',
    "name" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "saleStart" DATE,
    "saleEnd" DATE,
    "bookingDeadline" DATE,
    "minParticipants" INTEGER,
    "cancelRules" JSONB NOT NULL DEFAULT '[]',
    "priceFrom" INTEGER,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_partnerId_idx" ON "Product"("partnerId");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
