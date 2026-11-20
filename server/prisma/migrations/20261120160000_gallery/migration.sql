-- CreateEnum
CREATE TYPE "GalleryItemType" AS ENUM ('PHOTO', 'VIDEO');

-- CreateTable
CREATE TABLE "gallery_albums" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "coverImageId" UUID,
    "linkedEventId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gallery_albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_album_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "albumId" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "gallery_album_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "albumId" UUID NOT NULL,
    "storageFileId" UUID NOT NULL,
    "type" "GalleryItemType" NOT NULL,
    "position" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_item_translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "itemId" UUID NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "altText" TEXT,

    CONSTRAINT "gallery_item_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gallery_albums_status_date_deletedAt_idx" ON "gallery_albums"("status", "date", "deletedAt");

-- CreateIndex
CREATE INDEX "gallery_albums_isFeatured_idx" ON "gallery_albums"("isFeatured");

-- CreateIndex
CREATE INDEX "gallery_albums_sortOrder_idx" ON "gallery_albums"("sortOrder");

-- CreateIndex
CREATE INDEX "gallery_albums_linkedEventId_idx" ON "gallery_albums"("linkedEventId");

-- CreateIndex
CREATE INDEX "gallery_albums_coverImageId_idx" ON "gallery_albums"("coverImageId");

-- CreateIndex
CREATE INDEX "gallery_albums_createdById_idx" ON "gallery_albums"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "gallery_album_translations_albumId_language_key" ON "gallery_album_translations"("albumId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "gallery_album_translations_language_slug_key" ON "gallery_album_translations"("language", "slug");

-- CreateIndex
CREATE INDEX "gallery_items_albumId_position_deletedAt_idx" ON "gallery_items"("albumId", "position", "deletedAt");

-- CreateIndex
CREATE INDEX "gallery_items_storageFileId_idx" ON "gallery_items"("storageFileId");

-- CreateIndex
CREATE INDEX "gallery_items_type_idx" ON "gallery_items"("type");

-- CreateIndex
CREATE INDEX "gallery_items_createdById_idx" ON "gallery_items"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "gallery_item_translations_itemId_language_key" ON "gallery_item_translations"("itemId", "language");

-- AddForeignKey
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_linkedEventId_fkey" FOREIGN KEY ("linkedEventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_albums" ADD CONSTRAINT "gallery_albums_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_album_translations" ADD CONSTRAINT "gallery_album_translations_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "gallery_albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "gallery_albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_storageFileId_fkey" FOREIGN KEY ("storageFileId") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_item_translations" ADD CONSTRAINT "gallery_item_translations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "gallery_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Galerie : index et garde-fous (l'API les valide aussi)
-- ---------------------------------------------------------------------------
-- Recherche par tags (« contient tous les tags », « contient au moins un tag ») : index GIN
CREATE INDEX "gallery_items_tags_gin_idx" ON "gallery_items" USING GIN ("tags");

-- Un même fichier ne figure qu'une fois dans un album (parmi les médias actifs)
CREATE UNIQUE INDEX "gallery_items_album_file_active_key" ON "gallery_items" ("albumId", "storageFileId") WHERE "deletedAt" IS NULL;

ALTER TABLE "gallery_items"
  ADD CONSTRAINT "gallery_items_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "gallery_items_tags_check" CHECK (cardinality("tags") <= 20);

ALTER TABLE "gallery_album_translations"
  ADD CONSTRAINT "gallery_album_translations_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ---------------------------------------------------------------------------
-- Sécurité Supabase : RLS sur les nouvelles tables (voir docs/DATABASE.md)
-- ---------------------------------------------------------------------------
ALTER TABLE "gallery_albums" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gallery_album_translations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gallery_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gallery_item_translations" ENABLE ROW LEVEL SECURITY;
