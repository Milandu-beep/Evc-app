-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('ALL', 'ADMINS', 'MEMBERS', 'VISITORS');

-- CreateEnum
CREATE TYPE "NotificationLogEvent" AS ENUM ('CREATED', 'SCHEDULED', 'RESCHEDULED', 'SENDING', 'SENT', 'RETRY', 'FAILED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
ALTER TYPE "NotificationStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SERMON';
ALTER TYPE "NotificationType" ADD VALUE 'TEST';

-- AlterTable
ALTER TABLE "notification_translations" ADD COLUMN     "url" TEXT;

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "oneSignalId",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "audience" "NotificationAudience" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "recipients" INTEGER,
ADD COLUMN     "sermonId" UUID;

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notificationId" UUID NOT NULL,
    "event" "NotificationLogEvent" NOT NULL,
    "status" "NotificationStatus",
    "message" TEXT,
    "attempt" INTEGER,
    "data" JSONB,
    "adminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_logs_notificationId_createdAt_idx" ON "notification_logs"("notificationId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_logs_createdAt_idx" ON "notification_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_sermonId_idx" ON "notifications"("sermonId");

-- CreateIndex
CREATE INDEX "notifications_status_scheduledAt_idx" ON "notifications"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "sermons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Notifications : garde-fous d'intégrité (l'API les valide aussi)
-- ---------------------------------------------------------------------------
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_scheduled_check" CHECK ("status" <> 'SCHEDULED' OR "scheduledAt" IS NOT NULL),
  ADD CONSTRAINT "notifications_sent_check" CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL),
  ADD CONSTRAINT "notifications_attempts_check" CHECK ("attempts" >= 0);

-- ---------------------------------------------------------------------------
-- Sécurité Supabase : RLS sur la nouvelle table (voir docs/DATABASE.md)
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_logs" ENABLE ROW LEVEL SECURITY;
