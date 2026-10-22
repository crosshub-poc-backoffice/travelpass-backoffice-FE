/*
  Warnings:

  - You are about to drop the column `bookingDeadline` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `minParticipants` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "bookingDeadline",
DROP COLUMN "minParticipants",
ADD COLUMN     "deadlineDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "deadlineTime" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "schedule" JSONB NOT NULL DEFAULT '{}';
