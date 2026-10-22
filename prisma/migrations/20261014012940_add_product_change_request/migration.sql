-- CreateEnum
CREATE TYPE "ProductChangeType" AS ENUM ('edit', 'delete', 'hide');

-- CreateEnum
CREATE TYPE "ProductChangeRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'product_change_requested';
ALTER TYPE "NotificationType" ADD VALUE 'product_change_approved';
ALTER TYPE "NotificationType" ADD VALUE 'product_change_rejected';
ALTER TYPE "NotificationType" ADD VALUE 'product_direct_change';

-- CreateTable
CREATE TABLE "ProductChangeRequest" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductChangeType" NOT NULL,
    "targetStatus" "ProductStatus",
    "proposedData" JSONB,
    "status" "ProductChangeRequestStatus" NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductChangeRequest_productId_idx" ON "ProductChangeRequest"("productId");

-- CreateIndex
CREATE INDEX "ProductChangeRequest_status_idx" ON "ProductChangeRequest"("status");

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductChangeRequest" ADD CONSTRAINT "ProductChangeRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
