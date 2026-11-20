# Architecture du stockage

Version : 3.0 — Statut : **validé sur le principe ; en attente des accès Cloudinary**
Références : `PROJECT_CHARTER.md` §5 (Stockage) et §10 (Médiathèque).

## 1. Principes

1. **Un service unique, `StorageService`.** Les contrôleurs et les autres services ne savent
   pas où sont les fichiers : ils appellent `upload`, `delete`, `urlFor`.
2. **Un fournisseur interchangeable** derrière une interface `StorageProvider` :
   `CloudinaryProvider` en V1, `R2Provider` plus tard (non implémenté).
3. **Le client ne parle jamais directement au fournisseur** : `Client → API → Cloudinary`.
   Les secrets n'existent que côté serveur.
4. **Un fichier = une ligne `storage_files`**, référencée par les contenus (événement,
   actualité, média…). Un même fichier sert à plusieurs contenus sans duplication.
5. **Supabase ne stocke que des métadonnées**, jamais de fichiers. Aucune URL n'est stockée :
   elle est calculée à partir du fournisseur et de l'identifiant (voir §6). Changer de
   domaine ou de fournisseur ne demande pas de migration d'URLs.
6. **Les clés sont immuables et non devinables** ; le rangement (dossiers) et les noms
   d'affichage vivent en base.

Supabase Storage est abandonné : sa limite de 50 Mo par fichier n'est pas relevable sur
l'offre gratuite, et un seul fournisseur est plus simple à maintenir.

## 2. Types, formats et limites

Tout est stocké chez Cloudinary. Le `resource_type` Cloudinary dépend du type de fichier.

| Type | Formats | `resource_type` | Taille max | Traitement avant envoi |
|---|---|---|---|---|
| Image | JPEG, PNG, WebP | `image` | 10 Mo | Rotation EXIF appliquée puis métadonnées EXIF supprimées (vie privée, GPS), lecture de `width`/`height`. Originaux conservés, sans variante |
| Vidéo | MP4, WebM | `video` | 100 Mo | Durée et dimensions lues par Cloudinary |
| Audio | MP3 (`audio/mpeg`) | `video` (Cloudinary traite l'audio comme de la vidéo) | 100 Mo | Durée lue par Cloudinary |
| PDF | `application/pdf` | `raw` | 10 Mo | Aucun |
| Vidéo YouTube | lien | — | — | Pas de fichier (mode principal pour les longues vidéos) |

- **Limites = celles de l'offre gratuite Cloudinary** : 10 Mo (images), 100 Mo (vidéos et
  audio), 10 Mo (fichiers `raw`, donc PDF). Elles sont dans `config/constants.js` et se
  relèvent avec une offre payante. Les chiffres de l'offre gratuite peuvent évoluer :
  vérifier « Usage Limits » dans le tableau de bord.
- **Écart avec la charte §10** : la charte ne prévoyait que des vidéos YouTube ; l'envoi de
  vidéos MP4/WebM est une évolution demandée (charte v1.3).
- Les crédits gratuits (stockage, bande passante, transformations) sont **partagés** entre
  tous les types : surveiller la consommation, préférer YouTube pour les vidéos longues.
- **SVG refusé** (peut contenir du script). GIF, HEIC, WAV, OGG : hors V1.
- Le type est **détecté par le contenu** (octets magiques), jamais par `Content-Type` ni par
  l'extension, falsifiables.
- Multer applique la limite pendant la réception, avant tout envoi.
- Conversion WebP/AVIF et miniatures : assurées à la livraison par Cloudinary
  (`f_auto`, `w_…`), sans rien stocker de plus.
- **Piège PDF** : sur l'offre gratuite, la livraison des PDF est **bloquée par défaut**
  (erreur 401 à l'ouverture de l'URL). Il faut activer « PDF and ZIP files delivery » dans
  Settings → Security du tableau de bord Cloudinary (voir §12).

## 3. Arborescence (logique, indépendante du fournisseur)

Le dossier logique d'un fichier est choisi **à l'envoi** parmi une liste fermée
(`config/storage.js`).

```
EVC/
├── branding/      logos/   favicon/   pwa/                       images
├── events/        covers/  gallery/   documents/                 images, images, PDF
├── news/          covers/  gallery/                              images
├── sermons/       audio/   thumbnails/   documents/              MP3, images, PDF
├── gallery/       {AAAA}/  (2026, 2027…, créé automatiquement)   images, vidéos
├── profiles/      pastors/ admins/    users/                     images
└── temporary/                                                    tout type
```

- La racine vient de `STORAGE_ROOT` : `EVC` en production, `EVC-dev` en développement,
  pour ne jamais mélanger les fichiers de test et de production.
- Un dossier inconnu, ou un type non autorisé dans ce dossier (une vidéo dans
  `events/covers`, par exemple), est refusé (422).
- `gallery/{AAAA}` : l'année est validée (2000 à année en cours + 1).
- `temporary/` : destination provisoire quand le contenu n'existe pas encore. **Un fichier
  n'est jamais déplacé** (clés immuables) : rattaché à un contenu, il garde sa clé. Les
  fichiers non rattachés sont purgés par le nettoyage du §7.
- Les vidéos n'ont pas de dossier dédié dans cette arborescence : elles vont dans
  `gallery/{AAAA}`. Un dossier `sermons/videos` se rajoute en une ligne si besoin.

## 4. Identifiants des objets

```
publicId = {racine}/{dossier}/{uuid}            ex. EVC/events/covers/7c1e…b2        (image, vidéo, audio)
publicId = {racine}/{dossier}/{uuid}.{ext}      ex. EVC/events/documents/9a40…3f.pdf (raw : extension obligatoire)
```

- `uuid` = identifiant de la ligne `storage_files`.
- Extension déduite du type réel détecté, jamais du nom envoyé.
- Le nom d'origine est conservé en base (`originalName`), assaini (pas de chemin, pas de
  caractères de contrôle, longueur limitée), pour l'affichage et le téléchargement.
- Le dossier logique est aussi enregistré en base (`storage_files.folder`, ex.
  `events/covers`) pour filtrer et ranger sans interroger le fournisseur.
- Les dossiers de la médiathèque visibles par les administrateurs (`media_folders`, ex.
  Baptêmes, Séminaires) sont **distincts** de cette arborescence technique : ce sont des
  étiquettes en base, modifiables sans toucher aux fichiers.

## 5. Flux d'envoi

```
1. Authentification + rôle (Admin ou Super Admin) + limitation de débit
2. Validation de la demande : dossier logique autorisé pour ce type (§3)
   Réception (Multer → fichier temporaire dans src/uploads/, supprimé dans tous les cas)
3. Détection du type réel, contrôle du format et de la taille
4. Traitement (image : rotation + EXIF + dimensions)
5. Empreinte SHA-256
   └─ fichier actif identique (même empreinte) → réutilisation, pas de doublon
6. Envoi à Cloudinary avec le bon resource_type (§2)
7. Création de la ligne storage_files  (si la base échoue → suppression chez Cloudinary)
8. Audit (action CREATE, entité storage_files)
```

Il n'y a pas de transaction commune entre la base et le fournisseur : l'ordre « fournisseur
d'abord, base ensuite, nettoyage en cas d'échec » garantit qu'on ne référence jamais un
objet absent. L'inverse (objet sans ligne) est couvert par le nettoyage du §7.

## 6. URLs et CDN

`storageService.urlFor(file, options)` calcule l'URL HTTPS à la lecture :

```
https://res.cloudinary.com/{cloud}/{resource_type}/upload/{transformations}/{publicId}
```

- Images : transformations par défaut `f_auto,q_auto` ; `options.width` ajoute `w_{n}`.
- Vidéos : `f_auto,q_auto` et miniature générée en demandant une image (`.jpg`) du même
  `publicId`.
- Audio, PDF : URL directe, sans transformation.
- CDN mondial inclus. Tous les fichiers sont publics en lecture, car tout contenu publié
  est public ; la confidentialité d'un brouillon repose sur des identifiants non devinables.
  Un fichier réellement privé utiliserait `type: authenticated` et des URLs signées à durée
  limitée (non nécessaire en V1).
- Pour R2 plus tard : domaine personnalisé Cloudflare, calculé de la même manière par
  `R2Provider.urlFor`.

## 7. Suppression et nettoyage

- Supprimer un contenu **ne supprime pas** le fichier (il peut servir ailleurs).
- Un fichier est **orphelin** s'il n'est référencé par aucune table (`events`, `news`,
  `daily_messages`, `media`, `church_settings`).
- Nettoyage (`npm run storage:cleanup`, planifiable) :
  1. Orphelins de plus de **24 h** → marqués `deletedAt`.
  2. Fichiers marqués depuis plus de **30 jours** → supprimés chez Cloudinary (`destroy` avec
     le bon `resource_type` et invalidation du cache), puis de la base.
  3. Objets présents chez Cloudinary sans ligne en base (échec entre les étapes 6 et 7)
     → détectés par comparaison du listing et de la base, puis supprimés.
- Toute suppression passe par `StorageService` et est tracée dans `audit_logs`.
- Une erreur du fournisseur pendant le nettoyage est loggée et réessayée au passage
  suivant, jamais bloquante.

## 8. Modèle de données (changements à venir)

### Nouvelles tables

```
storage_files
  id (uuid) · provider (enum StorageProvider : CLOUDINARY, R2)
  resourceType (enum StorageResourceType : IMAGE, VIDEO, RAW)
  folder (dossier logique, ex. « events/covers », « gallery/2026 »)
  objectKey (publicId chez Cloudinary)
  originalName · mimeType · sizeBytes · checksumSha256 · etag?
  width? · height? · durationSeconds?
  uploadedById? → admins (SET NULL) · createdAt · deletedAt?
  unique (provider, resourceType, objectKey)
  index (checksumSha256)    index (folder)    index (deletedAt)

media_folders
  id (uuid) · name · parentId? → media_folders (arborescence)
  createdAt · updatedAt · deletedAt?
  unique (parentId, name)
```

`resourceType` est nécessaire à Cloudinary pour retrouver, supprimer et construire l'URL
d'un objet. Il n'y a plus de colonne `bucket` (plus de buckets).

### Tables existantes modifiées

| Table | Avant | Après |
|---|---|---|
| `media` | `storagePath`, `url`, `mimeType`, `sizeBytes` | `storageFileId?` → `storage_files` (vide pour YOUTUBE), `folderId?` → `media_folders` ; `youtubeId` et `url` (lien YouTube uniquement) conservés selon le type |
| `events` | `coverImage` (texte) | `coverImageId?` → `storage_files` |
| `news` | `coverImage` (texte) | `coverImageId?` → `storage_files` |
| `daily_messages` | — | `imageId?` → `storage_files` |
| `church_settings` | — | `logoId?` → `storage_files` |

L'enum `MediaType` gagne la valeur `VIDEO` (fichier vidéo hébergé), à côté de `YOUTUBE` (lien).
Les lignes `media` elles-mêmes sont créées au Sprint 8 (Médiathèque) ; le Sprint 3 ne prépare
que le schéma.

Toutes les relations vers `storage_files` sont `SET NULL` : supprimer un fichier ne supprime
jamais un contenu. Les tables concernées sont vides, la migration est sans risque.
`R2` est dans l'enum dès maintenant (aucun code derrière) pour éviter une migration plus tard.

## 9. Sécurité

- Seuls Admin et Super Admin envoient ; seul le Super Admin lance un nettoyage manuel.
- `CLOUDINARY_API_SECRET` uniquement en variable d'environnement serveur, jamais dans le
  dépôt, `admin/` ni `client/`.
- Détection de type par le contenu, limites de taille, SVG refusé, EXIF supprimé.
- Limitation de débit sur les envois (en plus de celle du login).
- Noms d'origine assainis, jamais utilisés dans les identifiants d'objets.
- Chaque envoi, rattachement et suppression est écrit dans `audit_logs`.
- Dans Cloudinary (Settings → Security), laisser désactivée toute option d'envoi non signé
  (« unsigned upload ») : seul le backend envoie.

## 10. Structure du code

```
src/
  config/storage.js               dossiers autorisés par type, limites, formats, resource_type
  services/storage/
    storage.service.js            orchestration : flux §5, urlFor, suppression, nettoyage
    providers/provider.js         interface : put / delete / list / urlFor
    providers/cloudinary.provider.js
    image.processor.js            rotation, EXIF, dimensions (sharp)
    file-type.js                  détection par contenu
  middleware/upload.js            Multer + limites
  utils/checksum.js
```

Dépendances à ajouter : `cloudinary`, `sharp`, `file-type`. `multer` est déjà installé.
Plus de dépendance à `@supabase/supabase-js` pour le stockage.

## 11. Variables d'environnement

```
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
STORAGE_ROOT=EVC-dev             # EVC en production
```

## 12. Prérequis à fournir (par vous)

**Cloudinary** (gratuit, sans carte bancaire)
1. Créer un compte sur cloudinary.com.
2. Dans le tableau de bord, relever `Cloud name`, `API Key` et `API Secret`
   (Settings → API Keys) et les mettre dans `server/.env`.
3. **Settings → Security** : activer **« PDF and ZIP files delivery »** (sinon les PDF
   renvoient une erreur 401).

Plus aucun bucket Supabase à créer.

## 13. Livrable du Sprint 3

- Migration : `storage_files`, `media_folders`, clés étrangères, enum `VIDEO`, retrait des
  anciennes colonnes, RLS sur les nouvelles tables.
- `StorageService` et `CloudinaryProvider`, middleware d'envoi, nettoyage.
- Routes techniques `POST /api/storage/upload` (champs `file` et `folder`) et
  `DELETE /api/storage/:id` (Admin / Super Admin), sans logique métier d'événement ou
  d'actualité.
- Tests réels sur Cloudinary : envoi de chaque type (image, vidéo, audio, PDF) avec ouverture
  de l'URL résultante, refus d'un dossier ou d'un type non autorisé, refus d'un faux format,
  refus d'un fichier trop gros, dédoublonnage, échec base → nettoyage Cloudinary, nettoyage
  des orphelins.
- Documentation (`API.md`, `DATABASE.md`).

## 14. Évolution vers Cloudflare R2

Écrire `R2Provider` (API compatible S3), le brancher dans `StorageService`, déplacer au
besoin les fichiers existants par un script (le champ `provider` indique d'où chacun vient).
Aucun contrôleur ni table métier ne change.
