-- CreateEnum
CREATE TYPE "ChangeFee" AS ENUM ('same', 'free');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "changeFee" "ChangeFee" NOT NULL DEFAULT 'same';
