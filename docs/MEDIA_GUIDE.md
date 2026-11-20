# Guide des médias EVC

Pour les développeurs et les administrateurs. Architecture détaillée : `STORAGE_ARCHITECTURE.md`.

## 1. Types autorisés et tailles

| Type | Formats | Taille max | Détail |
|---|---|---|---|
| Image | JPEG, PNG, WebP | 10 Mo | Orientation corrigée, métadonnées (GPS, appareil) supprimées |
| Vidéo | MP4, WebM | 100 Mo | Miniature générée automatiquement |
| Audio | MP3 | 100 Mo | — |
| PDF | PDF | 10 Mo | — |

Refusés : SVG (risque de script), GIF, HEIC, WAV, OGG, exécutables et tout autre format.
Le type est reconnu **par le contenu** : renommer un fichier ne change rien.
Pour une vidéo longue (prédication), préférez un lien **YouTube** : il ne consomme pas le quota.

## 2. Dossiers

Chaque envoi précise un dossier. Un type non autorisé dans ce dossier est refusé (422).

| Dossier | Types | Usage |
|---|---|---|
| `branding/logos` · `branding/favicon` · `branding/pwa` | image | Identité visuelle, icônes de l'application |
| `events/covers` | image | Affiche d'un événement |
| `events/gallery` | image | Photos d'un événement |
| `events/documents` | PDF | Programme, document d'un événement |
| `news/covers` · `news/gallery` | image | Actualités |
| `sermons/audio` | MP3 | Prédications |
| `sermons/thumbnails` | image | Vignettes de prédications |
| `sermons/documents` | PDF | Notes, plans de prédication |
| `gallery` | image, vidéo | Galerie générale (classée par date d'envoi) |
| `profiles/pastors` · `profiles/admins` · `profiles/users` | image | Photos de profil |
| `temporary` | tous | Destination provisoire (voir §6) |

Chez Cloudinary, un fichier est rangé sous
`{racine}/{dossier}/{AAAA}/{MM}/{JJ}/{uuid}` ; la racine est `EVC` en production et
`EVC-dev` en développement. Exemple :
`EVC/events/covers/2026/11/20/c9e44e7d-31c6-47c2-b6a7-9b53f6b0e2f1`.
Le nom d'origine n'y figure jamais : l'uuid rend tout conflit impossible.

## 3. Envoi et suppression (API)

Connexion obligatoire (Admin ou Super Admin) : en-tête `Authorization: Bearer <token>`.

```
POST /api/storage/upload     multipart/form-data : file, folder
DELETE /api/storage/:id
```

Exemple :
```
curl -X POST http://localhost:3000/api/storage/upload \
  -H "Authorization: Bearer <token>" \
  -F "folder=events/covers" -F "file=@affiche.jpg"
```

Réponse 201 (extrait) :
```json
{ "success": true, "message": "Fichier envoyé", "data": {
  "id": "…", "folder": "events/covers", "originalFilename": "affiche.jpg",
  "mimeType": "image/jpeg", "resourceType": "IMAGE", "bytes": 184233, "width": 1600, "height": 900,
  "url": "https://res.cloudinary.com/…/image/upload/f_auto,q_auto/EVC/events/covers/…",
  "thumbnailUrl": "https://res.cloudinary.com/…/c_limit,w_400/…", "reused": false } }
```

- Si exactement le même fichier existe déjà, la réponse est **200** avec `"reused": true` :
  rien n'est renvoyé au fournisseur, l'identifiant existant est retourné.
- Le nom d'origine (ex. `Guide Baptême.pdf`) est conservé dans `originalFilename`.
- La suppression est refusée (**409**) tant que le fichier est utilisé par un événement,
  une actualité, un message, un média ou les paramètres, même si ce contenu a été supprimé
  (il reste restaurable). Détachez-le d'abord.

Codes : 401 non connecté · 403 rôle insuffisant · 413 trop volumineux · 415 format non
autorisé ou image corrompue · 422 dossier/type invalide ou fichier absent · 429 trop d'envois ·
502 fournisseur indisponible · 503 stockage non configuré.

## 4. Afficher un fichier

Utilisez toujours `url` (ou `StorageService.urlFor`) et jamais une adresse écrite à la main.

| Besoin | Moyen |
|---|---|
| Image optimisée | `url` : WebP/AVIF automatique (`f_auto`) et compression adaptée (`q_auto`) |
| Image à une largeur donnée | `urlFor(file, { width: 800 })` : sans agrandissement |
| Vignette d'image ou de vidéo | `thumbnailUrl` / `urlFor(file, { thumbnail: true })` (400 px) |
| Vidéo | `url` : format et qualité automatiques |
| Audio, PDF | `url` : lien direct |

Les `url` / `secureUrl` enregistrées en base sont les adresses brutes du fournisseur, gardées
pour mémoire ; l'API n'expose que des URL HTTPS calculées.

## 5. Bonnes pratiques

- **Images** : envoyez des originaux de bonne qualité (≈ 1600 à 2500 px de large suffisent) ;
  la compression et les tailles sont gérées à l'affichage. Ne les redimensionnez pas à la main.
- **Affiches** : format 16:9 (1600×900) ou 4:5 pour les affiches portrait, texte lisible
  au centre (les vignettes peuvent être recadrées).
- **PDF** : compressez avant l'envoi (10 Mo maximum) ; nom clair, il s'affichera tel quel.
- **Audio** : MP3 128 kbps suffit pour la parole (≈ 1 Mo par minute).
- **Vidéos** : 1080p maximum, MP4 (H.264) ; pour plus de 100 Mo, utilisez YouTube.
- **Doublons** : inutile de vérifier si un fichier existe déjà, il est reconnu à l'envoi.
- **Quota** : les crédits gratuits Cloudinary sont partagés (stockage, bande passante,
  transformations). Surveillez « Usage » dans le tableau de bord, surtout avec des vidéos.
- **Secrets** : `CLOUDINARY_API_SECRET` reste dans `server/.env`, jamais dans le dépôt ni
  dans `admin/` ou `client/`.

## 6. Cycle de vie et nettoyage

- Supprimer un contenu **ne supprime pas** son fichier (il peut servir ailleurs).
- Un fichier qui n'est utilisé nulle part est **orphelin** : marqué après 24 h, supprimé
  définitivement (chez le fournisseur puis en base) après 30 jours.
- Les fichiers ne sont jamais déplacés : un fichier envoyé dans `temporary` et rattaché
  ensuite à un contenu garde sa clé.

```
npm run storage:cleanup                  # marque et supprime les orphelins
npm run storage:cleanup -- --dry-run     # affiche ce qui serait fait, sans rien modifier
npm run storage:cleanup -- --remote      # supprime aussi les objets du fournisseur sans ligne en base
```

À planifier une fois par jour en production.

## 7. Journal d'audit

Chaque envoi écrit `UPLOAD_FILE` et chaque suppression `DELETE_FILE` dans `audit_logs`
(administrateur, IP, dossier, nom d'origine, type, taille, et `reused` pour un envoi
dédoublonné). Le nettoyage automatique écrit aussi `DELETE_FILE` avec `reason: "cleanup"`.

## 8. Configuration Cloudinary (rappel)

Dans le tableau de bord Cloudinary :
1. Settings → API Keys : relever `Cloud name`, `API Key`, `API Secret` (dans `server/.env`).
2. Settings → Security : activer **« PDF and ZIP files delivery »**, sinon les PDF
   renvoient une erreur 401.
3. Laisser désactivés les envois non signés (« unsigned upload ») : seul le backend envoie.
