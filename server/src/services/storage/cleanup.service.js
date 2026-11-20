import { prismaRaw } from "../../config/prisma.js";
import { CLEANUP, storageRoot } from "../../config/storage.js";
import logger from "../../utils/logger.js";
import * as auditService from "../audit.service.js";
import { destroyFile, getProvider } from "./storage.service.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Fichiers non référencés par aucun contenu (lignes supprimées logiquement comprises).
const unreferenced = {
  events: { none: {} },
  news: { none: {} },
  dailyMessages: { none: {} },
  churchSettings: { none: {} },
  media: { none: {} },
};

/**
 * Nettoyage des fichiers orphelins (docs/STORAGE_ARCHITECTURE.md §7).
 *  0. Envoi resté UPLOADING depuis plus d'1 h (interrompu) -> objet éventuel supprimé, statut FAILED ;
 *     ligne FAILED depuis plus de 7 jours -> supprimée.
 *  1. Fichier non rattaché depuis plus de 24 h  -> marqué (deletedAt).
 *  2. Fichier marqué depuis plus de 30 jours    -> supprimé chez le fournisseur puis en base.
 *  3. remote : objet chez le fournisseur sans ligne en base (créé il y a plus de 24 h) -> supprimé.
 * dryRun : ne modifie rien, retourne seulement ce qui serait fait.
 * Une erreur sur un fichier est loggée et n'arrête pas le reste.
 */
export async function cleanupOrphans({ dryRun = false, remote = false, now = new Date() } = {}) {
  const report = { stuckFailed: 0, failedPurged: 0, marked: 0, purged: 0, remoteDeleted: 0, errors: 0, dryRun };

  // 0. Envois interrompus et lignes en échec
  const stuck = await prismaRaw.storageFile.findMany({
    where: { status: "UPLOADING", createdAt: { lt: new Date(now - CLEANUP.stuckUploadMinutes * 60 * 1000) } },
  });
  for (const file of stuck) {
    report.stuckFailed += 1;
    if (dryRun) continue;
    try {
      // L'objet a pu être envoyé juste avant l'interruption : on tente de le supprimer.
      await getProvider(file.provider).destroy({ publicId: file.publicId, resourceType: file.resourceType });
      await prismaRaw.storageFile.update({ where: { id: file.id }, data: { status: "FAILED" } });
    } catch (err) {
      report.stuckFailed -= 1;
      report.errors += 1;
      logger.error(`Nettoyage : envoi interrompu ${file.id} non traité`, err.message);
    }
  }
  const failed = await prismaRaw.storageFile.findMany({
    where: { status: "FAILED", createdAt: { lt: new Date(now - CLEANUP.failedRetentionDays * DAY) } },
    select: { id: true },
  });
  report.failedPurged = failed.length;
  if (!dryRun && failed.length) {
    await prismaRaw.storageFile.deleteMany({ where: { id: { in: failed.map((f) => f.id) } } });
  }

  // 1. Marquage
  const toMark = await prismaRaw.storageFile.findMany({
    where: {
      status: "READY",
      deletedAt: null,
      createdAt: { lt: new Date(now - CLEANUP.orphanGraceHours * HOUR) },
      ...unreferenced,
    },
    select: { id: true },
  });
  report.marked = toMark.length;
  if (!dryRun && toMark.length) {
    await prismaRaw.storageFile.updateMany({
      where: { id: { in: toMark.map((f) => f.id) } },
      data: { status: "DELETED", deletedAt: now },
    });
  }

  // 2. Suppression définitive (un fichier remis en usage entre-temps n'est jamais supprimé)
  const toPurge = await prismaRaw.storageFile.findMany({
    where: { status: "DELETED", deletedAt: { lt: new Date(now - CLEANUP.retentionDays * DAY) }, ...unreferenced },
  });
  for (const file of toPurge) {
    if (dryRun) {
      report.purged += 1;
      continue;
    }
    try {
      await destroyFile(file);
      report.purged += 1;
      await auditService.record({
        action: "DELETE_FILE",
        entity: "storage_files",
        entityId: file.id,
        changes: { reason: "cleanup", publicId: file.publicId },
      });
    } catch (err) {
      report.errors += 1;
      logger.error(`Nettoyage : échec sur ${file.id}`, err.message);
    }
  }

  // 3. Objets sans ligne en base
  if (remote) {
    const provider = getProvider();
    const known = new Set((await prismaRaw.storageFile.findMany({ select: { publicId: true } })).map((f) => f.publicId));
    for (const resourceType of ["IMAGE", "VIDEO", "RAW"]) {
      let items;
      try {
        items = await provider.list({ prefix: `${storageRoot}/`, resourceType });
      } catch (err) {
        report.errors += 1;
        logger.error(`Nettoyage : listing ${resourceType} impossible`, err.message);
        continue;
      }
      for (const item of items) {
        if (known.has(item.publicId)) continue;
        if (item.createdAt > new Date(now - CLEANUP.orphanGraceHours * HOUR)) continue;
        if (dryRun) {
          report.remoteDeleted += 1;
          continue;
        }
        try {
          await provider.destroy({ publicId: item.publicId, resourceType });
          report.remoteDeleted += 1;
        } catch (err) {
          report.errors += 1;
          logger.error(`Nettoyage : suppression distante de ${item.publicId}`, err.message);
        }
      }
    }
  }

  return report;
}
