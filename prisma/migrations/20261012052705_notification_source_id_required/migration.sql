/*
  Warnings:

  - Made the column `sourceId` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "sourceId" SET NOT NULL;
