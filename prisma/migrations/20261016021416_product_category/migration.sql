-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('tour', 'lodging', 'transport', 'package', 'other');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" "ProductCategory" NOT NULL DEFAULT 'other';
