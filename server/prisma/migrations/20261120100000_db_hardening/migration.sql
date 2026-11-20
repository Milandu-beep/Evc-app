-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN');

-- DropForeignKey
ALTER TABLE "daily_message_translations" DROP CONSTRAINT "daily_message_translations_dailyMessageId_fkey";

-- DropForeignKey
ALTER TABLE "daily_messages" DROP CONSTRAINT "daily_messages_createdById_fkey";

-- DropForeignKey
ALTER TABLE "event_translations" DROP CONSTRAINT "event_translations_eventId_fkey";

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_createdById_fkey";

-- DropForeignKey
ALTER TABLE "media" DROP CONSTRAINT "media_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "media_translations" DROP CONSTRAINT "media_translations_mediaId_fkey";

-- DropForeignKey
ALTER TABLE "news" DROP CONSTRAINT "news_createdById_fkey";

-- DropForeignKey
ALTER TABLE "news_translations" DROP CONSTRAINT "news_translations_newsId_fkey";

-- DropForeignKey
ALTER TABLE "notification_translations" DROP CONSTRAINT "notification_translations_notificationId_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_createdById_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_dailyMessageId_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_eventId_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_newsId_fkey";

-- DropForeignKey
ALTER TABLE "service_schedule_translations" DROP CONSTRAINT "service_schedule_translations_scheduleId_fkey";

-- DropIndex
DROP INDEX "contact_messages_isRead_createdAt_idx";

-- DropIndex
DROP INDEX "daily_messages_date_key";

-- DropIndex
DROP INDEX "daily_messages_status_date_idx";

-- DropIndex
DROP INDEX "events_status_startsAt_idx";

-- DropIndex
DROP INDEX "media_type_status_createdAt_idx";

-- DropIndex
DROP INDEX "news_status_publishedAt_idx";

-- DropIndex
DROP INDEX "notifications_status_scheduledAt_idx";

-- AlterTable
ALTER TABLE "admins" DROP CONSTRAINT "admins_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "church_setting_translations" DROP CONSTRAINT "church_setting_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "church_setting_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "contact_messages" DROP CONSTRAINT "contact_messages_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "daily_message_translations" DROP CONSTRAINT "daily_message_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "dailyMessageId",
ADD COLUMN     "dailyMessageId" UUID NOT NULL,
ADD CONSTRAINT "daily_message_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "daily_messages" DROP CONSTRAINT "daily_messages_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID,
ADD CONSTRAINT "daily_messages_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "event_translations" DROP CONSTRAINT "event_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "eventId",
ADD COLUMN     "eventId" UUID NOT NULL,
ADD CONSTRAINT "event_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "events" DROP CONSTRAINT "events_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID,
ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "media" DROP CONSTRAINT "media_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "uploadedById",
ADD COLUMN     "uploadedById" UUID,
ADD CONSTRAINT "media_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "media_translations" DROP CONSTRAINT "media_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "mediaId",
ADD COLUMN     "mediaId" UUID NOT NULL,
ADD CONSTRAINT "media_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "news" DROP CONSTRAINT "news_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID,
ADD CONSTRAINT "news_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "news_translations" DROP CONSTRAINT "news_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "newsId",
ADD COLUMN     "newsId" UUID NOT NULL,
ADD CONSTRAINT "news_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "notification_translations" DROP CONSTRAINT "notification_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "notificationId",
ADD COLUMN     "notificationId" UUID NOT NULL,
ADD CONSTRAINT "notification_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_pkey",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "eventId",
ADD COLUMN     "eventId" UUID,
DROP COLUMN "newsId",
ADD COLUMN     "newsId" UUID,
DROP COLUMN "dailyMessageId",
ADD COLUMN     "dailyMessageId" UUID,
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID,
ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "service_schedule_translations" DROP CONSTRAINT "service_schedule_translations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "scheduleId",
ADD COLUMN     "scheduleId" UUID NOT NULL,
ADD CONSTRAINT "service_schedule_translations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "service_schedules" DROP CONSTRAINT "service_schedules_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "dayOfWeek",
ADD COLUMN     "dayOfWeek" "Weekday" NOT NULL,
ADD CONSTRAINT "service_schedules_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "adminId" UUID,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_adminId_createdAt_idx" ON "audit_logs"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "contact_messages_isRead_createdAt_deletedAt_idx" ON "contact_messages"("isRead", "createdAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_message_translations_dailyMessageId_language_key" ON "daily_message_translations"("dailyMessageId", "language");

-- CreateIndex
CREATE INDEX "daily_messages_date_idx" ON "daily_messages"("date");

-- CreateIndex
CREATE INDEX "daily_messages_status_date_deletedAt_idx" ON "daily_messages"("status", "date", "deletedAt");

-- CreateIndex
CREATE INDEX "daily_messages_createdById_idx" ON "daily_messages"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "event_translations_eventId_language_key" ON "event_translations"("eventId", "language");

-- CreateIndex
CREATE INDEX "events_status_startsAt_deletedAt_idx" ON "events"("status", "startsAt", "deletedAt");

-- CreateIndex
CREATE INDEX "events_createdById_idx" ON "events"("createdById");

-- CreateIndex
CREATE INDEX "media_type_status_createdAt_deletedAt_idx" ON "media"("type", "status", "createdAt", "deletedAt");

-- CreateIndex
CREATE INDEX "media_uploadedById_idx" ON "media"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "media_translations_mediaId_language_key" ON "media_translations"("mediaId", "language");

-- CreateIndex
CREATE INDEX "news_status_publishedAt_deletedAt_idx" ON "news"("status", "publishedAt", "deletedAt");

-- CreateIndex
CREATE INDEX "news_createdById_idx" ON "news"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "news_translations_newsId_language_key" ON "news_translations"("newsId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "notification_translations_notificationId_language_key" ON "notification_translations"("notificationId", "language");

-- CreateIndex
CREATE INDEX "notifications_status_scheduledAt_deletedAt_idx" ON "notifications"("status", "scheduledAt", "deletedAt");

-- CreateIndex
CREATE INDEX "notifications_createdById_idx" ON "notifications"("createdById");

-- CreateIndex
CREATE INDEX "notifications_eventId_idx" ON "notifications"("eventId");

-- CreateIndex
CREATE INDEX "notifications_newsId_idx" ON "notifications"("newsId");

-- CreateIndex
CREATE INDEX "notifications_dailyMessageId_idx" ON "notifications"("dailyMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "service_schedule_translations_scheduleId_language_key" ON "service_schedule_translations"("scheduleId", "language");

-- CreateIndex
CREATE INDEX "service_schedules_dayOfWeek_startTime_idx" ON "service_schedules"("dayOfWeek", "startTime");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_translations" ADD CONSTRAINT "news_translations_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "news"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_messages" ADD CONSTRAINT "daily_messages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_message_translations" ADD CONSTRAINT "daily_message_translations_dailyMessageId_fkey" FOREIGN KEY ("dailyMessageId") REFERENCES "daily_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "news"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dailyMessageId_fkey" FOREIGN KEY ("dailyMessageId") REFERENCES "daily_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_translations" ADD CONSTRAINT "notification_translations_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_translations" ADD CONSTRAINT "media_translations_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_schedule_translations" ADD CONSTRAINT "service_schedule_translations_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "service_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Suppression logique : une date de message quotidien n'est unique que parmi
-- les lignes non supprimées (on peut recréer le message d'un jour supprimé).
-- Index partiel : non exprimable dans schema.prisma.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "daily_messages_date_active_key" ON "daily_messages"("date") WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Sécurité Supabase : RLS sur la nouvelle table (voir docs/DATABASE.md)
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
