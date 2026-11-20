# Architecture du stockage

Version : 2.0 — Statut : **validé sur le principe (limites, nettoyage, originaux conservés)**
Références : `PROJECT_CHARTER.md` §5 (Stockage) et §10 (Médiathèque).

## 1. Principes

1. **Un service unique, `StorageService`.** Les contrôleurs et les autres services ne savent
   pas où sont les fichiers : ils appellent `upload`, `delete`, `urlFor`.
2. **Des fournisseurs interchangeables** derrière une interface :
   `CloudinaryProvider` (images), `SupabaseStorageProvider` (PDF, audio),
   `R2Provider` (futur, non implémenté en V1).
3. **Le client ne parle jamais directement à un fournisseur** : `Client → API → fournisseur`.
   Les secrets n'existent que côté serveur.
4. **Un fichier = une ligne `storage_files`**, référencée par les contenus (événement,
   actualité, média…). Un même fichier sert à plusieurs contenus sans duplication.
5. **La base ne stocke que des métadonnées.** Aucune URL n'est stockée : elle est calculée à
   partir du fournisseur et de l'identifiant (voir §6). Changer de domaine ou de fournisseur
   ne demande pas de migration d'URLs.
6. **Les clés sont immuables et non devinables** ; le rangement (dossiers) et les noms
   d'affichage vivent en base.

## 2. Répartition par type

| Type | Fournisseur | Conteneur | Pourquoi |
|---|---|---|---|
| Images (JPEG, PNG, WebP) | **Cloudinary** | dossier `evc/{AAAA}/{MM}/` | CDN, WebP/AVIF automatique, redimensionnement par l'URL (`w_1200,f_auto,q_auto`) : aucune variante à stocker |
| PDF | **Supabase Storage** | bucket public `documents` | Compte déjà en place, pas de carte bancaire |
| Audio MP3 | **Supabase Storage** | bucket public `audio` | idem |
| Vidéos | **YouTube** (lien) | — | Charte §10 : pas de fichier vidéo en V1 |

Le choix du fournisseur est une table de correspondance dans `config/storage.js`
(type de fichier → fournisseur). Passer les PDF et l'audio sur R2 plus tard = écrire
`R2Provider` et changer cette table ; les fichiers existants restent lisibles car chaque
ligne `storage_files` mémorise son fournisseur.

## 3. Formats et limites

| Type | Formats | Taille max | Traitement avant envoi |
|---|---|---|---|
| Image | JPEG, PNG, WebP | 10 Mo | Rotation EXIF appliquée puis métadonnées EXIF supprimées (vie privée, GPS), lecture de `width`/`height`. Originaux conservés, sans variante |
| PDF | `application/pdf` | 20 Mo | Aucun |
| Audio | MP3 (`audio/mpeg`) | 50 Mo | Lecture de la durée |

- Les 10 Mo des images correspondent à la limite d'envoi de l'offre gratuite Cloudinary ;
  les 50 Mo de l'audio à celle de Supabase Storage (offre gratuite). Une offre payante
  permet de les relever dans `config/constants.js`.
- **SVG refusé** (peut contenir du script). GIF, HEIC, vidéo : hors V1.
- Le type est **détecté par le contenu** (octets magiques), jamais par `Content-Type` ni par
  l'extension, falsifiables.
- Multer applique la limite pendant la réception, avant tout envoi vers un fournisseur.
- Conversion WebP/AVIF et miniatures : assurées à la livraison par Cloudinary
  (`f_auto`, `w_…`), sans rien stocker de plus.

## 4. Identifiants des objets

```
Cloudinary : publicId = evc/{AAAA}/{MM}/{uuid}          (sans extension)
Supabase   : chemin   = {AAAA}/{MM}/{uuid}.{ext}        dans le bucket documents ou audio
```

- `uuid` = identifiant de la ligne `storage_files`.
- Extension déduite du type réel détecté, jamais du nom envoyé.
- Le nom d'origine est conservé en base (`originalName`), assaini (pas de chemin, pas de
  caractères de contrôle, longueur limitée), pour l'affichage et le téléchargement.
- Les dossiers de la médiathèque (Affiches, Prédications, Baptêmes…) sont des lignes
  `media_folders`, **pas** des préfixes chez le fournisseur.

## 5. Flux d'envoi

```
1. Authentification + rôle (Admin ou Super Admin) + limitation de débit
2. Réception (Multer → fichier temporaire dans src/uploads/, supprimé dans tous les cas)
3. Détection du type réel, contrôle du format et de la taille
4. Traitement (image : rotation + EXIF + dimensions ; audio : durée)
5. Empreinte SHA-256
   └─ fichier actif identique (même empreinte) → réutilisation, pas de doublon
6. Choix du fournisseur (table du §2) et envoi
7. Création de la ligne storage_files  (si la base échoue → suppression chez le fournisseur)
8. Audit (action CREATE, entité storage_files)
```

Il n'y a pas de transaction commune entre la base et un fournisseur : l'ordre « fournisseur
d'abord, base ensuite, nettoyage en cas d'échec » garantit qu'on ne référence jamais un
objet absent. L'inverse (objet sans ligne) est couvert par le nettoyage du §8.

## 6. URLs et CDN

`storageService.urlFor(file, options)` calcule l'URL à la lecture :

- **Cloudinary** : `https://res.cloudinary.com/{cloud}/image/upload/{transformations}/{publicId}`.
  Par défaut `f_auto,q_auto` ; `options.width` ajoute `w_{n}`. CDN mondial inclus.
- **Supabase** : `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{chemin}`, envoyé avec
  `Cache-Control: max-age=31536000` (fichiers immuables).
- **R2 (futur)** : domaine personnalisé Cloudflare.

Les buckets Supabase sont publics en lecture, car tout contenu publié est public. La
confidentialité d'un brouillon repose sur des identifiants non devinables. Un fichier
réellement privé irait dans un bucket privé avec URL signée à durée limitée.

## 7. Modèle de données (changements à venir)

### Nouvelles tables

```
storage_files
  id (uuid) · provider (enum StorageProvider : CLOUDINARY, SUPABASE, R2)
  bucket? (Supabase : documents|audio ; vide pour Cloudinary) · objectKey (publicId ou chemin)
  originalName · mimeType · sizeBytes · checksumSha256 · etag?
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
| `media` | `storagePath`, `url`, `mimeType`, `sizeBytes` | `storageFileId?` → `storage_files` (vide pour YOUTUBE), `folderId?` → `media_folders` ; `youtubeId` et `url` (lien YouTube uniquement) conservés selon le type |
| `events` | `coverImage` (texte) | `coverImageId?` → `storage_files` |
| `news` | `coverImage` (texte) | `coverImageId?` → `storage_files` |
| `daily_messages` | — | `imageId?` → `storage_files` |
| `church_settings` | — | `logoId?` → `storage_files` |

Toutes les relations vers `storage_files` sont `SET NULL` : supprimer un fichier ne supprime
jamais un contenu. Les tables concernées sont vides, la migration est sans risque.
`R2` est dans l'enum dès maintenant (aucun code derrière) pour éviter une migration plus tard.

## 8. Suppression et nettoyage

- Supprimer un contenu **ne supprime pas** le fichier (il peut servir ailleurs).
- Un fichier est **orphelin** s'il n'est référencé par aucune table (`events`, `news`,
  `daily_messages`, `media`, `church_settings`).
- Nettoyage (`npm run storage:cleanup`, planifiable) :
  1. Orphelins de plus de **24 h** → marqués `deletedAt`.
  2. Fichiers marqués depuis plus de **30 jours** → supprimés chez le fournisseur
     (Cloudinary : `destroy` avec invalidation du cache), puis de la base.
  3. Objets présents chez le fournisseur sans ligne en base (échec entre les étapes 6 et 7)
     → détectés par comparaison du listing et de la base, puis supprimés.
- Toute suppression passe par `StorageService` et est tracée dans `audit_logs`.
- Une erreur d'un fournisseur pendant le nettoyage est loggée et réessayée au passage
  suivant, jamais bloquante.

## 9. Sécurité

- Seuls Admin et Super Admin envoient ; seul le Super Admin lance un nettoyage manuel.
- Secrets uniquement en variables d'environnement, jamais dans le dépôt ni envoyés au client.
- **Attention** : `SUPABASE_SERVICE_ROLE_KEY` donne un accès total au projet Supabase
  (elle contourne la RLS). Elle ne doit exister que sur le serveur, jamais dans le
  frontend (`admin/`, `client/`). Seul `StorageService` l'utilise, et uniquement pour le
  stockage.
- Détection de type par le contenu, limites de taille, SVG refusé, EXIF supprimé.
- Limitation de débit sur les envois (en plus de celle du login).
- Noms d'origine assainis, jamais utilisés dans les identifiants d'objets.
- Chaque envoi, rattachement et suppression est écrit dans `audit_logs`.

## 10. Structure du code

```
src/
  config/storage.js               fournisseur par type, limites, formats autorisés
  services/storage/
    storage.service.js            orchestration : flux §5, urlFor, suppression, nettoyage
    providers/provider.js         interface : put / delete / list / urlFor
    providers/cloudinary.provider.js
    providers/supabase.provider.js
    image.processor.js            rotation, EXIF, dimensions (sharp)
    file-type.js                  détection par contenu
  middleware/upload.js            Multer + limites
  utils/checksum.js
```

Dépendances à ajouter : `cloudinary`, `@supabase/supabase-js`, `sharp`, `file-type`,
`music-metadata` (durée audio). `multer` est déjà installé.

## 11. Variables d'environnement

```
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

SUPABASE_URL=                    # https://<projet>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=       # serveur uniquement
SUPABASE_BUCKET_DOCUMENTS=documents
SUPABASE_BUCKET_AUDIO=audio
```

## 12. Livrable du Sprint 3

- Migration : `storage_files`, `media_folders`, clés étrangères, retrait des anciennes
  colonnes, RLS sur les nouvelles tables.
- `StorageService` et les deux fournisseurs, middleware d'envoi, nettoyage.
- Routes techniques `POST /api/storage/upload` et `DELETE /api/storage/:id`
  (Admin / Super Admin), sans logique métier d'événement ou d'actualité.
- Tests réels : envoi de chaque type, refus d'un faux format, refus d'un fichier trop gros,
  dédoublonnage, échec base → nettoyage chez le fournisseur, nettoyage des orphelins.
- Documentation (`API.md`, `DATABASE.md`).

## 13. Prérequis à fournir (par vous)

**Cloudinary** (gratuit, sans carte bancaire)
1. Créer un compte sur cloudinary.com.
2. Dans le tableau de bord, relever `Cloud name`, `API Key` et `API Secret`
   (Settings → API Keys).

**Supabase Storage** (projet existant)
1. Dans Storage, créer deux buckets **publics** : `documents` et `audio`.
2. Relever l'URL du projet et la clé `service_role` (Settings → API Keys).

Les valeurs vont dans `server/.env` ; ne les envoyez pas dans la conversation.

## 14. Évolution vers Cloudflare R2

Écrire `R2Provider` (API compatible S3), l'ajouter à la table du §2, déplacer au besoin
les fichiers existants par un script (le champ `provider` indique d'où chacun vient).
Aucun contrôleur ni table métier ne change.
