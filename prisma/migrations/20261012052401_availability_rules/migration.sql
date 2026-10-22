-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "availabilityRules" JSONB NOT NULL DEFAULT '[]';
