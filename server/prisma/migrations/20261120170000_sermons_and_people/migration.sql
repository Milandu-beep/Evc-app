-- CreateEnum
CREATE TYPE "PersonCategory" AS ENUM ('PASTOR', 'TEAM', 'SPEAKER', 'LEADER', 'OTHER');

-- CreateEnum
CREATE TYPE "SpeakerRole" AS ENUM ('PREACHER', 'GUEST_PREACHER', 'TRANSLATOR', 'WORSHIP_LEADER', 'MODERATOR', 'PRAYER', 'OTHER');

-- CreateEnum
CREATE TYPE "SermonStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categories" "PersonCategory"[] DEFAULT ARRAY[]::"PersonCategory"[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "photoId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "personId" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT,
    "bio" TEXT,

    CONSTRAINT "person_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermon_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "coverImageId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sermon_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermon_series_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seriesId" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "sermon_series_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "SermonStatus" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "seriesId" UUID,
    "seriesPosition" INTEGER,
    "coverImageId" UUID,
    "audioFileId" UUID,
    "videoFileId" UUID,
    "youtubeId" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnPublish" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "playCount" INTEGER NOT NULL DEFAULT 0,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sermons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermon_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sermonId" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "theme" TEXT,
    "verseReferences" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "sermon_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermon_speakers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sermonId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "SpeakerRole" NOT NULL DEFAULT 'PREACHER',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sermon_speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermon_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sermonId" UUID NOT NULL,
    "storageFileId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sermon_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sermon_document_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "sermon_document_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "people_slug_key" ON "people"("slug");

-- CreateIndex
CREATE INDEX "people_status_deletedAt_idx" ON "people"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "people_sortOrder_idx" ON "people"("sortOrder");

-- CreateIndex
CREATE INDEX "people_photoId_idx" ON "people"("photoId");

-- CreateIndex
CREATE INDEX "people_createdById_idx" ON "people"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "person_translations_personId_language_key" ON "person_translations"("personId", "language");

-- CreateIndex
CREATE INDEX "sermon_series_status_deletedAt_idx" ON "sermon_series"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "sermon_series_sortOrder_idx" ON "sermon_series"("sortOrder");

-- CreateIndex
CREATE INDEX "sermon_series_isFeatured_idx" ON "sermon_series"("isFeatured");

-- CreateIndex
CREATE INDEX "sermon_series_coverImageId_idx" ON "sermon_series"("coverImageId");

-- CreateIndex
CREATE INDEX "sermon_series_createdById_idx" ON "sermon_series"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_series_translations_seriesId_language_key" ON "sermon_series_translations"("seriesId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_series_translations_language_slug_key" ON "sermon_series_translations"("language", "slug");

-- CreateIndex
CREATE INDEX "sermons_status_date_deletedAt_idx" ON "sermons"("status", "date", "deletedAt");

-- CreateIndex
CREATE INDEX "sermons_status_publishAt_idx" ON "sermons"("status", "publishAt");

-- CreateIndex
CREATE INDEX "sermons_seriesId_seriesPosition_idx" ON "sermons"("seriesId", "seriesPosition");

-- CreateIndex
CREATE INDEX "sermons_isFeatured_idx" ON "sermons"("isFeatured");

-- CreateIndex
CREATE INDEX "sermons_playCount_idx" ON "sermons"("playCount");

-- CreateIndex
CREATE INDEX "sermons_coverImageId_idx" ON "sermons"("coverImageId");

-- CreateIndex
CREATE INDEX "sermons_audioFileId_idx" ON "sermons"("audioFileId");

-- CreateIndex
CREATE INDEX "sermons_videoFileId_idx" ON "sermons"("videoFileId");

-- CreateIndex
CREATE INDEX "sermons_createdById_idx" ON "sermons"("createdById");

-- CreateIndex
CREATE INDEX "sermon_translations_language_theme_idx" ON "sermon_translations"("language", "theme");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_translations_sermonId_language_key" ON "sermon_translations"("sermonId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_translations_language_slug_key" ON "sermon_translations"("language", "slug");

-- CreateIndex
CREATE INDEX "sermon_speakers_sermonId_position_idx" ON "sermon_speakers"("sermonId", "position");

-- CreateIndex
CREATE INDEX "sermon_speakers_personId_idx" ON "sermon_speakers"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_speakers_sermonId_personId_role_key" ON "sermon_speakers"("sermonId", "personId", "role");

-- CreateIndex
CREATE INDEX "sermon_documents_sermonId_position_idx" ON "sermon_documents"("sermonId", "position");

-- CreateIndex
CREATE INDEX "sermon_documents_storageFileId_idx" ON "sermon_documents"("storageFileId");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_documents_sermonId_storageFileId_key" ON "sermon_documents"("sermonId", "storageFileId");

-- CreateIndex
CREATE UNIQUE INDEX "sermon_document_translations_documentId_language_key" ON "sermon_document_translations"("documentId", "language");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_translations" ADD CONSTRAINT "person_translations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_series" ADD CONSTRAINT "sermon_series_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_series" ADD CONSTRAINT "sermon_series_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_series_translations" ADD CONSTRAINT "sermon_series_translations_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "sermon_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermons" ADD CONSTRAINT "sermons_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "sermon_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermons" ADD CONSTRAINT "sermons_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermons" ADD CONSTRAINT "sermons_audioFileId_fkey" FOREIGN KEY ("audioFileId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermons" ADD CONSTRAINT "sermons_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermons" ADD CONSTRAINT "sermons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_translations" ADD CONSTRAINT "sermon_translations_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "sermons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_speakers" ADD CONSTRAINT "sermon_speakers_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "sermons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_speakers" ADD CONSTRAINT "sermon_speakers_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_documents" ADD CONSTRAINT "sermon_documents_sermonId_fkey" FOREIGN KEY ("sermonId") REFERENCES "sermons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_documents" ADD CONSTRAINT "sermon_documents_storageFileId_fkey" FOREIGN KEY ("storageFileId") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sermon_document_translations" ADD CONSTRAINT "sermon_document_translations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "sermon_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Index et garde-fous (créés à la main : Prisma ne sait pas les exprimer ; l'API les valide aussi)
-- ---------------------------------------------------------------------------
-- Recherche par tags et par catégories : index GIN
CREATE INDEX "sermons_tags_gin_idx" ON "sermons" USING GIN ("tags");
CREATE INDEX "people_categories_gin_idx" ON "people" USING GIN ("categories");

ALTER TABLE "sermons"
  ADD CONSTRAINT "sermons_scheduled_check" CHECK ("status" <> 'SCHEDULED' OR "publishAt" IS NOT NULL),
  ADD CONSTRAINT "sermons_one_video_check" CHECK ("videoFileId" IS NULL OR "youtubeId" IS NULL),
  ADD CONSTRAINT "sermons_youtube_check" CHECK ("youtubeId" IS NULL OR "youtubeId" ~ '^[A-Za-z0-9_-]{11}$'),
  ADD CONSTRAINT "sermons_counters_check" CHECK ("viewCount" >= 0 AND "playCount" >= 0 AND "downloadCount" >= 0),
  ADD CONSTRAINT "sermons_series_position_check" CHECK ("seriesPosition" IS NULL OR "seriesPosition" >= 1),
  ADD CONSTRAINT "sermons_tags_check" CHECK (cardinality("tags") <= 20);

ALTER TABLE "sermon_translations"
  ADD CONSTRAINT "sermon_translations_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "sermon_translations_verses_check" CHECK (cardinality("verseReferences") <= 10);

ALTER TABLE "sermon_series_translations"
  ADD CONSTRAINT "sermon_series_translations_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "people"
  ADD CONSTRAINT "people_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ---------------------------------------------------------------------------
-- Sécurité Supabase : RLS sur les nouvelles tables (voir docs/DATABASE.md)
-- ---------------------------------------------------------------------------
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "person_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermon_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermon_series_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermon_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermon_speakers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermon_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sermon_document_translations" ENABLE ROW LEVEL SECURITY;
