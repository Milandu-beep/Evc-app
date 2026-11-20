# Architecture du stockage — Cloudflare R2

Version : 1.0 — Statut : **proposé, en attente de validation**
Référence : `PROJECT_CHARTER.md` §5 (Stockage) et §10 (Médiathèque).

## 1. Principes

1. **Les fichiers vivent uniquement dans R2.** Supabase ne stocke que des métadonnées.
2. **Le client ne parle jamais à R2 directement** : `Client → API → R2`. Les clés d'accès R2
   n'existent que côté serveur.
3. **Un fichier = une ligne `storage_files`**, référencée par les contenus (événement,
   actualité, média…). Un même fichier peut servir à plusieurs contenus sans duplication.
4. **Une clé d'objet est immuable.** Renommer ou ranger un fichier ne touche jamais R2 :
   le rangement (dossiers) et les noms d'affichage vivent en base.
5. **Aucune URL n'est stockée en base.** Elle est calculée à partir de `bucket` + `objectKey`
   et de la configuration (voir §6). Changer de domaine CDN ne demande aucune migration.
6. **Le fournisseur est abstrait** derrière une interface `StorageProvider` : changer de
   fournisseur ne touche que l'implémentation.

## 2. Buckets

| Bucket | Contenu | Accès |
|---|---|---|
| `evc-images` | Photos, affiches, bannières, logos | Public (via domaine CDN) |
| `evc-documents` | PDF | Public (via domaine CDN) |
| `evc-audio` | MP3 | Public (via domaine CDN) |

Pas de bucket vidéo en V1 : la charte limite les vidéos à YouTube (liens, pas de fichiers).
Un bucket `evc-videos` pourra être ajouté plus tard sans changer le modèle.

Les buckets sont publics en lecture car tout le contenu publié est public. La protection
d'un brouillon repose sur des clés **non devinables** (UUID), pas sur une authentification.
Si des fichiers réellement privés apparaissent un jour, ils iront dans un bucket privé avec
URLs signées à durée limitée.

Le listing des buckets n'est jamais exposé. Un bucket de développement et un de production
sont séparés (`evc-dev-images`, …) pour qu'un test n'écrase jamais la production.

## 3. Nommage des objets

```
{type}/{AAAA}/{MM}/{uuid}.{ext}      ex. images/2026/11/7c1e…b2.webp
```

- `uuid` = identifiant de la ligne `storage_files` (clé et base restent liées).
- Extension déduite du **type réel détecté** du fichier, jamais du nom envoyé.
- Le nom d'origine est conservé en base (`originalName`) pour l'affichage et le téléchargement,
  assaini (pas de chemin, caractères de contrôle supprimés, longueur limitée).
- Les « dossiers » de la médiathèque (Affiches, Prédications, Baptêmes…) ne sont **pas** des
  préfixes R2 : ce sont des lignes `media_folders` (arborescence en base).

## 4. Formats et limites

| Type | Formats acceptés | Taille max | Traitement |
|---|---|---|---|
| Image | JPEG, PNG, WebP | 10 Mo | Rotation EXIF appliquée puis métadonnées EXIF supprimées (vie privée), dimensions max 4000 px, lecture de `width`/`height` |
| PDF | `application/pdf` | 20 Mo | Aucun |
| Audio | MP3 (`audio/mpeg`) | 100 Mo | Lecture de la durée |

- **SVG refusé** (peut contenir du script). GIF, HEIC, vidéo : hors V1.
- Le type est **détecté par le contenu** (octets magiques), pas par l'en-tête
  `Content-Type` ni l'extension, qui sont falsifiables.
- Les limites sont dans `config/constants.js` ; Multer applique la limite pendant la
  réception, avant d'écrire quoi que ce soit.

## 5. Flux d'envoi

```
1. Authentification + rôle (Admin ou Super Admin) + limitation de débit
2. Réception (Multer → fichier temporaire dans src/uploads/, nettoyé dans tous les cas)
3. Détection du type réel, contrôle format et taille
4. Traitement (image : rotation, EXIF, dimensions ; audio : durée)
5. Empreinte SHA-256
   └─ si un fichier actif a la même empreinte et le même bucket → réutilisation (pas de doublon)
6. Envoi vers R2 (clé générée), récupération de l'ETag
7. Création de la ligne storage_files  (si la base échoue → l'objet R2 est supprimé)
8. Audit (action CREATE, entité storage_files)
```

La base et R2 n'ont pas de transaction commune : l'ordre « R2 d'abord, base ensuite, nettoyage
en cas d'échec » garantit qu'on ne référence jamais un objet absent. Le cas inverse (objet
sans ligne) est couvert par le nettoyage des orphelins (§8).

## 6. URLs publiques et CDN

- Chaque bucket est relié à un **domaine personnalisé Cloudflare** (ex. `cdn.<domaine>`),
  ce qui active le cache CDN. Le domaine `r2.dev` est réservé au développement (limité,
  sans cache).
- URL = `R2_PUBLIC_URL_<TYPE>` + `/` + `objectKey`, calculée par `storageService.urlFor(file)`.
- Fichiers immuables (clé unique par fichier) : en-tête
  `Cache-Control: public, max-age=31536000, immutable`.
- Les téléchargements forcent un nom propre via `Content-Disposition` avec `originalName`.

## 7. Modèle de données (changements à venir)

### Nouvelles tables

```
storage_files
  id (uuid) · provider (enum StorageProvider) · bucket · objectKey
  originalName · mimeType · sizeBytes · checksumSha256 · etag
  width? · height? · durationSeconds?
  uploadedById? → admins (SET NULL) · createdAt · deletedAt?
  unique (provider, bucket, objectKey)    index (checksumSha256)    index (deletedAt)

media_folders
  id (uuid) · name · parentId? → media_folders (arborescence)
  createdAt · updatedAt · deletedAt?
  unique (parentId, name)
```

### Tables existantes modifiées

| Table | Avant | Après |
|---|---|---|
| `media` | `storagePath`, `url`, `mimeType`, `sizeBytes` | `storageFileId?` → `storage_files` (vide pour YOUTUBE), `folderId?` → `media_folders` ; `youtubeId` conservé |
| `events` | `coverImage` (texte) | `coverImageId?` → `storage_files` |
| `news` | `coverImage` (texte) | `coverImageId?` → `storage_files` |
| `daily_messages` | — | `imageId?` → `storage_files` |
| `church_settings` | — | `logoId?` → `storage_files` |

Toutes les relations vers `storage_files` sont `SET NULL` : supprimer un fichier ne supprime
jamais un contenu. Les tables concernées sont vides, la migration est sans risque.

### Écarts par rapport à la proposition initiale

| Proposé | Décision | Raison |
|---|---|---|
| `public_url`, `cdn_url` en base | **Calculés**, non stockés | Évite une migration de données si le domaine change |
| `storage_provider` : R2, S3, Azure, Google | Enum `R2`, `S3` | Une valeur se rajoute en une ligne de migration quand un 3e fournisseur devient réel |
| `uploaded_at` | `createdAt` | Convention du projet |
| `media_folders` nommés en fr/en | Un seul `name` | Dossiers internes à l'admin, saisis par les administrateurs |
| `duration` sur toutes les tables | Sur `storage_files` seulement | Une seule source de vérité |

## 8. Suppression et nettoyage

- Supprimer un contenu **ne supprime pas** le fichier (il peut servir ailleurs).
- Un fichier est **orphelin** s'il n'est référencé par aucune table (`events`, `news`,
  `daily_messages`, `media`, `church_settings`).
- Tâche de nettoyage (planifiée, ou commande `npm run storage:cleanup`) :
  1. Les orphelins de plus de **24 h** sont marqués `deletedAt` (délai laissé à un envoi
     en cours de rattachement).
  2. Les fichiers marqués depuis plus de **30 jours** sont supprimés de R2, puis de la base.
  3. Les objets R2 sans ligne en base (échec entre les étapes 6 et 7) sont détectés par
     comparaison du listing R2 et de la base, puis supprimés.
- Toute suppression passe par `storageService` et est tracée dans `audit_logs`.
- Une erreur R2 pendant le nettoyage est loggée et réessayée au passage suivant, jamais
  bloquante.

## 9. Sécurité

- Seuls Admin et Super Admin envoient ; seul le Super Admin lance un nettoyage manuel.
- Clés R2 limitées à un jeton d'API **par bucket** (lecture/écriture/suppression, pas de
  gestion de compte), uniquement en variables d'environnement, jamais dans le dépôt.
- Détection de type par le contenu, limites de taille, pas de SVG, EXIF supprimé.
- Limitation de débit sur les envois (en plus de celle du login).
- Noms de fichiers d'origine assainis et jamais utilisés dans la clé.
- CORS des buckets limité aux domaines de l'application (lecture uniquement, `GET`/`HEAD`).
- Chaque envoi, rattachement et suppression est écrit dans `audit_logs`.

## 10. Structure du code

```
src/
  config/storage.js              buckets, limites, formats autorisés
  services/storage/
    storage.service.js           orchestration (flux §5, suppression, nettoyage)
    providers/r2.provider.js     implémentation S3-compatible (@aws-sdk/client-s3)
    providers/provider.js        interface : put / delete / exists / list
    image.processor.js           rotation, EXIF, dimensions (sharp)
    file-type.js                 détection par contenu
  middleware/upload.js           Multer + limites
  utils/checksum.js
```

Dépendances à ajouter : `@aws-sdk/client-s3`, `sharp`, `file-type`, `music-metadata`
(durée audio). `multer` est déjà installé.

## 11. Variables d'environnement

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_IMAGES=
R2_BUCKET_DOCUMENTS=
R2_BUCKET_AUDIO=
R2_PUBLIC_URL_IMAGES=       # https://cdn.exemple.org  (ou URL r2.dev en développement)
R2_PUBLIC_URL_DOCUMENTS=
R2_PUBLIC_URL_AUDIO=
```

## 12. Livrable du Sprint 3

- Migration : `storage_files`, `media_folders`, nouvelles clés étrangères, retrait des
  anciennes colonnes, RLS sur les nouvelles tables.
- Services de stockage (envoi, suppression, URLs, nettoyage) et middleware d'envoi.
- Routes techniques `POST /api/storage/upload`, `DELETE /api/storage/:id` (Admin / Super Admin),
  sans logique métier d'événement ou d'actualité.
- Tests sur un bucket de développement réel : envoi de chaque type, refus d'un faux format,
  refus d'un fichier trop gros, dédoublonnage, échec base → nettoyage R2, nettoyage des
  orphelins.
- Documentation (`API.md`, `DATABASE.md`).

## 13. Prérequis côté Cloudflare (à faire par vous)

1. Compte Cloudflare avec **R2 activé** (une carte bancaire est demandée ; l'offre gratuite
   couvre 10 Go et un volume de requêtes large, sans frais de sortie).
2. Créer les buckets de développement : `evc-dev-images`, `evc-dev-documents`, `evc-dev-audio`.
3. Créer un jeton d'API R2 (lecture et écriture sur ces buckets) et noter l'identifiant de
   compte, la clé d'accès et la clé secrète.
4. Activer l'accès public via `r2.dev` sur ces buckets (développement uniquement).
5. Plus tard, pour la production : un nom de domaine à rattacher à Cloudflare.

## 14. Points à valider

1. Limites : images 10 Mo, PDF 20 Mo, audio 100 Mo — correctes ?
2. Images : conversion en WebP et variantes (miniature, moyenne) à l'envoi, ou originaux
   conservés tels quels en V1 ? (Je recommande **originaux nettoyés en V1**, variantes en
   évolution : la table et les clés n'ont pas besoin de changer.)
3. Délais de nettoyage : 24 h (orphelins) puis 30 jours (suppression R2) — convient ?
4. Un nom de domaine existe-t-il déjà pour le CDN de production ?
