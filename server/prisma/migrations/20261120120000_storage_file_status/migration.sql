-- CreateEnum
CREATE TYPE "StorageFileStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- AlterTable
ALTER TABLE "storage_files" ADD COLUMN     "status" "StorageFileStatus" NOT NULL DEFAULT 'UPLOADING',
ALTER COLUMN "url" DROP NOT NULL,
ALTER COLUMN "secureUrl" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "storage_files_status_createdAt_idx" ON "storage_files"("status", "createdAt");


-- Les fichiers existants (envoi terminé avant l'introduction du statut) sont utilisables.
UPDATE "storage_files" SET "status" = 'READY' WHERE "url" IS NOT NULL AND "deletedAt" IS NULL;
UPDATE "storage_files" SET "status" = 'DELETED' WHERE "deletedAt" IS NOT NULL;

-- Dédoublonnage : seuls les envois en cours ou terminés réservent une empreinte.
-- Un envoi FAILED ou DELETED ne bloque jamais un nouvel envoi du même fichier.
DROP INDEX "storage_files_checksum_active_key";
CREATE UNIQUE INDEX "storage_files_checksum_active_key"
  ON "storage_files" ("provider", "resourceType", "checksum")
  WHERE "deletedAt" IS NULL AND "status" IN ('UPLOADING', 'READY');
