-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('SERVICE', 'CONFERENCE', 'SEMINAR', 'RETREAT', 'YOUTH', 'PRAYER', 'EVANGELISM', 'OTHER');

-- CreateEnum
CREATE TYPE "NewsStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "registeredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" "EventType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "news" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyOnPublish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishAt" TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "NewsStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "events_type_idx" ON "events"("type");

-- CreateIndex
CREATE INDEX "news_status_publishedAt_deletedAt_idx" ON "news"("status", "publishedAt", "deletedAt");

-- CreateIndex
CREATE INDEX "news_status_publishAt_idx" ON "news"("status", "publishAt");

-- CreateIndex
CREATE INDEX "news_isFeatured_idx" ON "news"("isFeatured");


-- ---------------------------------------------------------------------------
-- Événements : capacité, inscrits, couleur, icône
-- ---------------------------------------------------------------------------
ALTER TABLE "events"
  ADD CONSTRAINT "events_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0),
  ADD CONSTRAINT "events_registered_check" CHECK ("registeredCount" >= 0 AND ("capacity" IS NULL OR "registeredCount" <= "capacity")),
  ADD CONSTRAINT "events_color_check" CHECK ("color" IS NULL OR "color" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "events_icon_check" CHECK ("icon" IS NULL OR "icon" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ---------------------------------------------------------------------------
-- Actualités : mêmes garde-fous que les événements
-- ---------------------------------------------------------------------------
ALTER TABLE "news"
  ADD CONSTRAINT "news_scheduled_check" CHECK ("status" <> 'SCHEDULED' OR "publishAt" IS NOT NULL);
ALTER TABLE "news_translations"
  ADD CONSTRAINT "news_translations_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
