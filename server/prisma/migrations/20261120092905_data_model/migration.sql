-- CreateEnum
CREATE TYPE "Language" AS ENUM ('fr', 'en');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'PDF', 'AUDIO', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('GENERAL', 'EVENT', 'NEWS', 'DAILY_MESSAGE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "coverImage" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_translations" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,

    CONSTRAINT "event_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news" (
    "id" SERIAL NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "coverImage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_translations" (
    "id" SERIAL NOT NULL,
    "newsId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,

    CONSTRAINT "news_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_messages" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_message_translations" (
    "id" SERIAL NOT NULL,
    "dailyMessageId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "bibleReference" TEXT,

    CONSTRAINT "daily_message_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "status" "NotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "oneSignalId" TEXT,
    "errorMessage" TEXT,
    "eventId" INTEGER,
    "newsId" INTEGER,
    "dailyMessageId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_translations" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "notification_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" SERIAL NOT NULL,
    "type" "MediaType" NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "storagePath" TEXT,
    "url" TEXT,
    "youtubeId" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_translations" (
    "id" SERIAL NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "media_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "church_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'Église Vie Céleste',
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "facebookUrl" TEXT,
    "youtubeUrl" TEXT,
    "tiktokUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "church_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "church_setting_translations" (
    "id" SERIAL NOT NULL,
    "settingId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "slogan" TEXT,
    "mission" TEXT,
    "address" TEXT,
    "addressReference" TEXT,

    CONSTRAINT "church_setting_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_schedules" (
    "id" SERIAL NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_schedule_translations" (
    "id" SERIAL NOT NULL,
    "scheduleId" INTEGER NOT NULL,
    "language" "Language" NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "service_schedule_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_status_startsAt_idx" ON "events"("status", "startsAt");

-- CreateIndex
CREATE INDEX "events_isFeatured_idx" ON "events"("isFeatured");

-- CreateIndex
CREATE INDEX "events_createdById_idx" ON "events"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "event_translations_eventId_language_key" ON "event_translations"("eventId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "event_translations_language_slug_key" ON "event_translations"("language", "slug");

-- CreateIndex
CREATE INDEX "news_status_publishedAt_idx" ON "news"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "news_createdById_idx" ON "news"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "news_translations_newsId_language_key" ON "news_translations"("newsId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "news_translations_language_slug_key" ON "news_translations"("language", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "daily_messages_date_key" ON "daily_messages"("date");

-- CreateIndex
CREATE INDEX "daily_messages_status_date_idx" ON "daily_messages"("status", "date");

-- CreateIndex
CREATE INDEX "daily_messages_createdById_idx" ON "daily_messages"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "daily_message_translations_dailyMessageId_language_key" ON "daily_message_translations"("dailyMessageId", "language");

-- CreateIndex
CREATE INDEX "notifications_status_scheduledAt_idx" ON "notifications"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "notifications_createdById_idx" ON "notifications"("createdById");

-- CreateIndex
CREATE INDEX "notifications_eventId_idx" ON "notifications"("eventId");

-- CreateIndex
CREATE INDEX "notifications_newsId_idx" ON "notifications"("newsId");

-- CreateIndex
CREATE INDEX "notifications_dailyMessageId_idx" ON "notifications"("dailyMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_translations_notificationId_language_key" ON "notification_translations"("notificationId", "language");

-- CreateIndex
CREATE INDEX "media_type_status_createdAt_idx" ON "media"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "media_uploadedById_idx" ON "media"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "media_translations_mediaId_language_key" ON "media_translations"("mediaId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "church_setting_translations_settingId_language_key" ON "church_setting_translations"("settingId", "language");

-- CreateIndex
CREATE INDEX "service_schedules_dayOfWeek_startTime_idx" ON "service_schedules"("dayOfWeek", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "service_schedule_translations_scheduleId_language_key" ON "service_schedule_translations"("scheduleId", "language");

-- CreateIndex
CREATE INDEX "contact_messages_isRead_createdAt_idx" ON "contact_messages"("isRead", "createdAt");

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
ALTER TABLE "church_setting_translations" ADD CONSTRAINT "church_setting_translations_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "church_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_schedule_translations" ADD CONSTRAINT "service_schedule_translations_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "service_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Contraintes de validité des horaires de culte
-- ---------------------------------------------------------------------------
ALTER TABLE "service_schedules"
  ADD CONSTRAINT "service_schedules_day_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  ADD CONSTRAINT "service_schedules_time_check"
    CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ---------------------------------------------------------------------------
-- Sécurité Supabase : active la RLS sur toutes les tables, sans politique.
-- L'API REST publique de Supabase (clé anon) n'a alors accès à rien.
-- Le backend se connecte avec le rôle postgres (Prisma), qui contourne la RLS.
-- Toute nouvelle table devra recevoir la même instruction.
-- ---------------------------------------------------------------------------
ALTER TABLE "admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_message_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "church_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "church_setting_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_schedule_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_messages" ENABLE ROW LEVEL SECURITY;
