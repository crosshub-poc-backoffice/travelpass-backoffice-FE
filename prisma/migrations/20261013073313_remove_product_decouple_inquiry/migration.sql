/*
  Warnings:

  - You are about to drop the `AvailabilityOverride` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Booking` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Product` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AvailabilityOverride" DROP CONSTRAINT "AvailabilityOverride_productId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_productId_fkey";

-- DropForeignKey
ALTER TABLE "Inquiry" DROP CONSTRAINT "Inquiry_productId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_partnerId_fkey";

-- DropTable
DROP TABLE "AvailabilityOverride";

-- DropTable
DROP TABLE "Booking";

-- DropTable
DROP TABLE "Product";

-- DropEnum
DROP TYPE "BookingStatus";

-- DropEnum
DROP TYPE "ChangeFee";

-- DropEnum
DROP TYPE "ConfirmType";

-- DropEnum
DROP TYPE "CustomerDecision";

-- DropEnum
DROP TYPE "ProductKind";

-- DropEnum
DROP TYPE "ProductStatus";
