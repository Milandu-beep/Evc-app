-- CreateEnum
CREATE TYPE "DailyMessageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "daily_message_translations" DROP COLUMN "bibleReference",
ADD COLUMN     "estimatedReadingTime" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "notificationBody" TEXT,
ADD COLUMN     "notificationTitle" TEXT,
ADD COLUMN     "theme" TEXT,
ADD COLUMN     "verseReference" TEXT,
ADD COLUMN     "verseText" TEXT;

-- AlterTable
ALTER TABLE "daily_messages" ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "sendNotification" BOOLEAN NOT NULL DEFAULT false,
DROP COLUMN "status",
ADD COLUMN     "status" "DailyMessageStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "daily_message_translations_language_theme_idx" ON "daily_message_translations"("language", "theme");

-- CreateIndex
CREATE INDEX "daily_messages_status_date_deletedAt_idx" ON "daily_messages"("status", "date", "deletedAt");

-- CreateIndex
CREATE INDEX "daily_messages_status_publishAt_idx" ON "daily_messages"("status", "publishAt");


-- ---------------------------------------------------------------------------
-- Messages du jour : garde-fous d'intégrité (l'API les valide aussi)
-- ---------------------------------------------------------------------------
ALTER TABLE "daily_messages"
  ADD CONSTRAINT "daily_messages_scheduled_check" CHECK ("status" <> 'SCHEDULED' OR "publishAt" IS NOT NULL);
ALTER TABLE "daily_message_translations"
  ADD CONSTRAINT "daily_message_translations_reading_check" CHECK ("estimatedReadingTime" >= 1);
