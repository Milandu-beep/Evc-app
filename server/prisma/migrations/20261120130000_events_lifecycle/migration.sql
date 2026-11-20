-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'CANCELLED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'STATUS_CHANGE';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "notifyOnPublish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "registrationRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationUrl" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "EventStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "events_status_startsAt_deletedAt_idx" ON "events"("status", "startsAt", "deletedAt");

-- CreateIndex
CREATE INDEX "events_status_publishAt_idx" ON "events"("status", "publishAt");


-- ---------------------------------------------------------------------------
-- Règles d'intégrité des événements (défense en profondeur : l'API les valide aussi)
-- ---------------------------------------------------------------------------
ALTER TABLE "events"
  ADD CONSTRAINT "events_dates_check" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt"),
  ADD CONSTRAINT "events_scheduled_check" CHECK ("status" <> 'SCHEDULED' OR "publishAt" IS NOT NULL),
  ADD CONSTRAINT "events_registration_url_check" CHECK ("registrationUrl" IS NULL OR "registrationUrl" ~* '^https?://');

ALTER TABLE "event_translations"
  ADD CONSTRAINT "event_translations_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
