# Base de données EVC

PostgreSQL (Supabase), via Prisma 7. Source de vérité : `server/prisma/schema.prisma`.

## Principes

- **Multilingue (charte §9)** : chaque contenu public = une table parente (données
  indépendantes de la langue) + une table `*_translations` avec une ligne par langue
  (`fr`, `en`), unique par `(parent, langue)`.
- **Statut éditorial** : `DRAFT`, `PUBLISHED`, `ARCHIVED`.
- **Identifiants** : tous les `id` sont des UUID natifs PostgreSQL (`gen_random_uuid()`), sauf
  `church_settings` (ligne unique, id = 1). Dans l'API, les ids sont donc des chaînes UUID.
- **Suppression logique** : `deletedAt` sur `admins`, `events`, `news`, `daily_messages`,
  `notifications`, `media`, `contact_messages`, `storage_files`, `media_folders`. Voir « Suppression logique » ci-dessous.
- **Fichiers** : jamais en base, seulement `storage_files`. `events`, `news` (`coverImageId`), `daily_messages`
  (`imageId`), `church_settings` (`logoId`) et `media` (`storageFileId`) y pointent, en `SET NULL`. Voir `STORAGE_ARCHITECTURE.md`.
- **Suppression** : les traductions suivent leur parent (`CASCADE`). Les liens vers
  `admins` et entre contenus sont `SET NULL` : supprimer un compte ne supprime pas le contenu.
- **Sécurité Supabase** : RLS activée sur toutes les tables, sans politique. L'API REST
  publique de Supabase n'a accès à rien ; seul le backend (rôle `postgres`) lit et écrit.
  **Toute nouvelle table doit recevoir `ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;`.**

## Tables

| Table | Rôle | Traductions |
|---|---|---|
| `admins` | Comptes Super Admin / Admin | — |
| `events` | Événements (dates, image, mise en avant) | `event_translations` : slug, titre, description, lieu |
| `news` | Actualités | `news_translations` : slug, titre, extrait, contenu |
| `daily_messages` | Message quotidien (une ligne par jour, `date` unique) | `daily_message_translations` : titre, contenu, référence biblique |
| `notifications` | Notifications OneSignal (statut, planification, lien facultatif vers événement / actualité / message) | `notification_translations` : titre, message |
| `media` | Médiathèque : `IMAGE`, `PDF`, `AUDIO`, `YOUTUBE` | `media_translations` : titre, description |
| `church_settings` | Paramètres de l'église (ligne unique, id = 1) : contact, réseaux | `church_setting_translations` : slogan, mission, adresse, repères |
| `service_schedules` | Horaires de culte (`dayOfWeek` enum `Weekday`, `HH:mm`) | `service_schedule_translations` : libellé |
| `contact_messages` | Messages du formulaire Contact | — |
| `audit_logs` | Journal d'audit (qui, quoi, quand, IP) | — |
| `storage_files` | Métadonnées de chaque fichier hébergé (Cloudinary) : `publicId`, `resourceType`, URLs du fournisseur, nom d'origine, type, taille, dimensions, durée, empreinte SHA-256, dossier logique | — |
| `media_folders` | Dossiers de la médiathèque (arborescence, étiquettes en base) | — |

## Suppression logique

- `import prisma from "../config/prisma.js"` : client **applicatif**. `delete()` / `deleteMany()`
  posent `deletedAt` ; les lectures, `update` et `count` ignorent les lignes supprimées.
- `import { prismaRaw } from ...` : client **brut**, voit tout. Réservé à la restauration
  (`update({ data: { deletedAt: null } })`), à la suppression définitive et à l'administration.
- Limite : les relations chargées par `include` / `select` ne sont pas filtrées.
- `admins.email` et les slugs restent réservés tant que la ligne existe (restaurez plutôt que recréer).
  La date d'un message quotidien est unique **parmi les lignes actives** (index partiel).

## Audit

`audit_logs` : action (`CREATE`, `UPDATE`, `DELETE`, `RESTORE`, `LOGIN`, `UPLOAD_FILE`, `DELETE_FILE`), table et id de la
ressource, résumé des changements (jamais de mot de passe), IP, user-agent.
`services/audit.service.js › record()` ne fait jamais échouer l'opération principale.
Actuellement branché sur le login ; les CRUD l'utiliseront dès leur création.

## Relations

```
admins 1─n events, news, daily_messages, notifications, media   (createdBy / uploadedBy, SET NULL)
events 1─n notifications     news 1─n notifications     daily_messages 1─n notifications   (SET NULL)
chaque parent 1─n sa table de traductions                                                   (CASCADE)
```

## Index et contraintes

- Uniques : `admins.email`, `daily_messages.date`, `(parent, language)` sur chaque table de
  traductions, `(language, slug)` sur événements et actualités.
- Index de lecture : `events(status, startsAt)`, `news(status, publishedAt)`,
  `daily_messages(status, date)`, `notifications(status, scheduledAt)`,
  `media(type, status, createdAt)`, `contact_messages(isRead, createdAt)`, clés étrangères.
- Index uniques partiels : `storage_files(provider, resourceType, checksum)` (dédoublonnage, fichiers actifs) et
  `media_folders(parent, nom)` (parmi les dossiers actifs).
- `CHECK` sur `service_schedules` : heures au format `HH:mm` valide.
- Index de lecture incluant `deletedAt` ; `audit_logs` indexé par `(entity, entityId)`, `(adminId, createdAt)`, `createdAt`.

## Migrations

| Migration | Contenu |
|---|---|
| `20261120091524_init_admins` | Table `admins`, enum `Role` |
| `20261120092905_data_model` | 15 tables, enums, index, contraintes `CHECK`, RLS |
| `20261120100000_db_hardening` | UUID, `deletedAt`, enum `Weekday`, table `audit_logs`, index partiel de la date des messages, RLS |
| `20261120110000_storage_files` | `storage_files`, `media_folders`, clés étrangères vers les fichiers (retrait de `coverImage` texte et des colonnes de fichier de `media`), enums `StorageProvider`, `StorageResourceType`, `MediaType.VIDEO`, actions d'audit de fichier, index partiels (empreinte, nom de dossier), RLS |

## Commandes

```
npx prisma validate          # valider le schéma
npx prisma migrate status    # état des migrations
npx prisma migrate dev       # créer / appliquer une migration (développement)
npx prisma migrate deploy    # appliquer en production
npx prisma generate          # régénérer le client
npx prisma studio            # explorer les données
```
