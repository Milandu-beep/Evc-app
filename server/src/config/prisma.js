import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import env from "./env.js";

// Prisma 7 : le client se connecte via un driver adapter.
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

// Client brut : voit TOUT, y compris les lignes supprimées logiquement.
// À réserver à la restauration, à la suppression définitive et aux tâches d'administration.
export const prismaRaw = new PrismaClient({ adapter, log: ["warn", "error"] });

// Modèles à suppression logique (colonne deletedAt).
const SOFT_DELETE_MODELS = new Set([
  "Admin",
  "Event",
  "News",
  "DailyMessage",
  "Notification",
  "Media",
  "ContactMessage",
  "StorageFile",
  "MediaFolder",
  "GalleryAlbum",
  "GalleryItem",
]);

const withActive = (args = {}) => ({ ...args, where: { ...args.where, deletedAt: null } });

// Client applicatif : les lignes supprimées sont invisibles et delete() devient un
// marquage deletedAt. Limite connue : les relations chargées via include/select ne sont
// pas filtrées (les traductions n'ont pas de suppression logique, leur parent oui).
const prisma = prismaRaw.$extends({
  name: "soft-delete",
  query: {
    $allModels: {
      findMany: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      findFirst: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      findFirstOrThrow: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      findUnique: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      findUniqueOrThrow: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      count: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      aggregate: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      groupBy: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      update: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      updateMany: ({ model, args, query }) =>
        query(SOFT_DELETE_MODELS.has(model) ? withActive(args) : args),
      delete: ({ model, args, query }) =>
        SOFT_DELETE_MODELS.has(model)
          ? prismaRaw[model[0].toLowerCase() + model.slice(1)].update({
              where: { ...args.where, deletedAt: null },
              data: { deletedAt: new Date() },
            })
          : query(args),
      deleteMany: ({ model, args, query }) =>
        SOFT_DELETE_MODELS.has(model)
          ? prismaRaw[model[0].toLowerCase() + model.slice(1)].updateMany({
              where: { ...args.where, deletedAt: null },
              data: { deletedAt: new Date() },
            })
          : query(args),
    },
  },
});

export default prisma;
