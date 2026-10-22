-- CreateTable
CREATE TABLE "LiveNotificationDismissal" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveNotificationDismissal_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "LiveNotificationDismissal" ADD CONSTRAINT "LiveNotificationDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
