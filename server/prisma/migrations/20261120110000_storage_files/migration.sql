-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('CLOUDINARY', 'R2');

-- CreateEnum
CREATE TYPE "StorageResourceType" AS ENUM ('IMAGE', 'VIDEO', 'RAW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'UPLOAD_FILE';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_FILE';

-- AlterEnum
ALTER TYPE "MediaType" ADD VALUE 'VIDEO';

-- AlterTable
ALTER TABLE "church_settings" ADD COLUMN     "logoId" UUID;

-- AlterTable
ALTER TABLE "daily_messages" ADD COLUMN     "imageId" UUID;

-- AlterTable
ALTER TABLE "events" DROP COLUMN "coverImage",
ADD COLUMN     "coverImageId" UUID;

-- AlterTable
ALTER TABLE "media" DROP COLUMN "mimeType",
DROP COLUMN "sizeBytes",
DROP COLUMN "storagePath",
ADD COLUMN     "folderId" UUID,
ADD COLUMN     "storageFileId" UUID;

-- AlterTable
ALTER TABLE "news" DROP COLUMN "coverImage",
ADD COLUMN     "coverImageId" UUID;

-- CreateTable
CREATE TABLE "storage_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "StorageProvider" NOT NULL,
    "publicId" TEXT NOT NULL,
    "resourceType" "StorageResourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "checksum" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "storage_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_folders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_files_checksum_idx" ON "storage_files"("checksum");

-- CreateIndex
CREATE INDEX "storage_files_folder_idx" ON "storage_files"("folder");

-- CreateIndex
CREATE INDEX "storage_files_deletedAt_idx" ON "storage_files"("deletedAt");

-- CreateIndex
CREATE INDEX "storage_files_createdById_idx" ON "storage_files"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "storage_files_provider_resourceType_publicId_key" ON "storage_files"("provider", "resourceType", "publicId");

-- CreateIndex
CREATE INDEX "media_folders_parentId_name_idx" ON "media_folders"("parentId", "name");

-- CreateIndex
CREATE INDEX "media_folders_parentId_idx" ON "media_folders"("parentId");

-- CreateIndex
CREATE INDEX "daily_messages_imageId_idx" ON "daily_messages"("imageId");

-- CreateIndex
CREATE INDEX "events_coverImageId_idx" ON "events"("coverImageId");

-- CreateIndex
CREATE INDEX "media_storageFileId_idx" ON "media"("storageFileId");

-- CreateIndex
CREATE INDEX "media_folderId_idx" ON "media"("folderId");

-- CreateIndex
CREATE INDEX "news_coverImageId_idx" ON "news"("coverImageId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news" ADD CONSTRAINT "news_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_messages" ADD CONSTRAINT "daily_messages_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_storageFileId_fkey" FOREIGN KEY ("storageFileId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "church_settings" ADD CONSTRAINT "church_settings_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "storage_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "media_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Dossiers de médiathèque : nom unique par parent parmi les lignes actives
-- (les racines, parentId NULL, sont regroupées grâce au COALESCE).
-- Index partiel : non exprimable dans schema.prisma.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "media_folders_parent_name_active_key"
  ON "media_folders" (COALESCE("parentId", '00000000-0000-0000-0000-000000000000'::uuid), "name")
  WHERE "deletedAt" IS NULL;

-- Un même fichier n'est enregistré qu'une fois par empreinte parmi les fichiers actifs
-- (dédoublonnage), chez un même fournisseur et pour un même type de ressource.
CREATE UNIQUE INDEX "storage_files_checksum_active_key"
  ON "storage_files" ("provider", "resourceType", "checksum")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_bytes_check" CHECK ("bytes" >= 0);

-- ---------------------------------------------------------------------------
-- Sécurité Supabase : RLS sur les nouvelles tables (voir docs/DATABASE.md)
-- ---------------------------------------------------------------------------
ALTER TABLE "storage_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_folders" ENABLE ROW LEVEL SECURITY;
