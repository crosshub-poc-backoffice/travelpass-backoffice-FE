-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "managedPartners" JSONB NOT NULL DEFAULT '[]';
