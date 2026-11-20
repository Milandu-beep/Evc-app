# API EVC — Documentation

Base URL (développement) : `http://localhost:3000/api`

## Format des réponses

Succès :
```json
{ "success": true, "message": "OK", "data": { } }
```

Erreur :
```json
{ "success": false, "message": "Description", "errors": [ { "field": "email", "message": "Email invalide" } ] }
```
`errors` n'est présent que pour les erreurs de validation (422).

## Codes d'erreur courants

| Code | Signification |
|---|---|
| 400 | JSON invalide |
| 401 | Non authentifié, identifiants incorrects, token invalide ou expiré |
| 403 | Rôle insuffisant |
| 404 | Route introuvable |
| 422 | Données invalides |
| 429 | Trop de tentatives de connexion |
| 500 | Erreur interne |

## Identifiants

Tous les identifiants de ressources sont des **UUID** (chaînes). Un id mal formé donne une erreur 422.

## Authentification

Le token JWT est envoyé dans l'en-tête `Authorization: Bearer <token>`.
Durée de validité : `JWT_EXPIRES_IN` (7 jours par défaut).
Il n'y a pas d'inscription publique : les comptes sont créés par le Super Admin
(premier compte : `npm run seed`).

### POST `/auth/login`

Limité à 10 tentatives par 15 minutes et par IP.

Corps :
```json
{ "email": "admin@example.com", "password": "motdepasse" }
```

Réponse 200 :
```json
{
  "success": true,
  "message": "Connexion réussie",
  "data": {
    "token": "<jwt>",
    "admin": {
      "id": "3f2b8c1e-7a4d-4e0b-9c55-1d2e6f7a8b90", "email": "admin@example.com", "firstName": "Super", "lastName": "Admin",
      "role": "SUPER_ADMIN", "isActive": true,
      "createdAt": "2026-11-20T09:19:26.068Z", "updatedAt": "2026-11-20T09:19:26.068Z"
    }
  }
}
```

Chaque connexion réussie est enregistrée dans le journal d'audit.

Erreurs : 401 (« Email ou mot de passe incorrect », identique si l'email est inconnu
ou le compte désactivé), 422 (champs invalides), 429.

### GET `/auth/me`

Authentification requise. Retourne le profil de l'administrateur connecté (même objet
`admin` que ci-dessus). Erreurs : 401 (token absent, invalide, expiré, ou compte désactivé).

## Santé

### GET `/health`

Réponse 200 : `{ "status": "ok", "database": "up", "uptime": 12.3, "version": "1.0.0" }`.
Erreur 500 si la base est inaccessible.

## Stockage de fichiers

Voir `MEDIA_GUIDE.md` pour les types, tailles et dossiers. Authentification requise
(Admin ou Super Admin).

### POST `/storage/upload`

`multipart/form-data` : `file` (le fichier) et `folder` (dossier logique, ex. `events/covers`).
Limité à 100 envois par 15 minutes et par IP.

- **201** : fichier envoyé. **200** avec `"reused": true` si le même fichier existait déjà.
- Réponse : `id`, `status` (`READY`), `folder`, `originalFilename`, `mimeType`, `resourceType`, `bytes`, `width`,
  `height`, `duration`, `url` (HTTPS, optimisée), `thumbnailUrl` (images et vidéos), `createdAt`, `reused`.
- Erreurs : 413 trop volumineux · 415 format non autorisé · 422 dossier inconnu, type non
  autorisé dans ce dossier ou fichier absent · 409 envoi identique déjà en cours · 429 · 502 fournisseur indisponible · 503 stockage non configuré.

### DELETE `/storage/:id`

Supprime le fichier chez le fournisseur et en base. **409** s'il est encore utilisé par un contenu
(la réponse détaille les références) ou si son envoi est encore en cours ; **404** s'il n'existe pas ; **422** si l'id n'est pas un UUID.
Chaque envoi et chaque suppression sont tracés dans le journal d'audit (`UPLOAD_FILE`, `DELETE_FILE`).

## Événements

Deux familles de routes : l'**administration** (Admin et Super Admin) sous `/admin/events`, et la
**lecture publique** (sans authentification) sous `/events`.

### États

Statut stocké : `DRAFT` (brouillon), `SCHEDULED` (programmé), `PUBLISHED` (publié), `CANCELLED` (annulé),
`ARCHIVED` (archivé). Chaque événement expose aussi un **`state`** déduit :

| `state` | Signification |
|---|---|
| `DRAFT` · `SCHEDULED` · `CANCELLED` · `ARCHIVED` | Identique au statut |
| `PUBLISHED` | Publié (ou programmé dont l'heure est venue) et pas encore terminé |
| `ENDED` | Terminé : publié et `endsAt` dépassé. **Sans `endsAt`, terminé à 23 h 59 (heure de Kinshasa, `APP_TIMEZONE`) du jour de début.** Jamais stocké |

Un événement **annulé** reste visible publiquement avec l'état `CANCELLED` (les fidèles doivent le savoir).

### Transitions (POST `/admin/events/:id/<action>`)

| Action | Depuis | Vers | Corps |
|---|---|---|---|
| `publish` | DRAFT, SCHEDULED, CANCELLED | PUBLISHED | — |
| `schedule` | DRAFT, SCHEDULED | SCHEDULED | `{ "publishAt": "2026-12-01T08:00:00Z" }` (≥ 1 min dans le futur, avant la fin de l'événement) |
| `unpublish` | PUBLISHED, SCHEDULED, CANCELLED | DRAFT | — |
| `cancel` | PUBLISHED | CANCELLED | `{ "reason": "…" }` (facultatif, conservé dans l'audit) |
| `archive` | DRAFT, SCHEDULED, PUBLISHED, CANCELLED | ARCHIVED | — |
| `unarchive` | ARCHIVED | DRAFT | — |

Une transition impossible renvoie **409**. Publier ou programmer exige un titre et une description en français.
Deux transitions simultanées sur un même événement : une seule réussit, l'autre reçoit 409.

### Publication programmée

L'événement devient visible **exactement à `publishAt`**, sans attendre : la lecture publique tient compte de
l'heure. Une tâche de fond (toutes les minutes, désactivable par `SCHEDULER_ENABLED=false`) fait passer le statut à
`PUBLISHED`, écrit l'audit (`reason: "scheduled"`) et émet l'événement interne `event.published` (voir « Préparation
OneSignal »). Elle est atomique : en cas de plusieurs instances, chaque événement n'est basculé qu'une fois.

### Administration

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/events` | Liste filtrée et paginée |
| POST | `/admin/events` | Création (brouillon) |
| GET | `/admin/events/:id` | Détail complet, toutes langues (corbeille comprise) |
| PATCH | `/admin/events/:id` | Modification partielle (champs et traductions) |
| DELETE | `/admin/events/:id` | Suppression logique (seulement DRAFT, SCHEDULED ou ARCHIVED) |
| POST | `/admin/events/:id/restore` | Restauration depuis la corbeille (un programmé revient en brouillon) |
| POST | `/admin/events/:id/{publish,schedule,unpublish,cancel,archive,unarchive}` | Transitions |

**Champs d'un événement** (en plus des dates et traductions) :

| Champ | Description |
|---|---|
| `type` | `SERVICE`, `CONFERENCE`, `SEMINAR`, `RETREAT`, `YOUTH`, `PRAYER`, `EVANGELISM`, `OTHER` (défaut) |
| `capacity` | Nombre de places (≥ 1), `null` = illimitée. Ne peut pas être inférieure au nombre d'inscrits |
| `registeredCount` | Nombre d'inscrits, **lecture seule** : tenu à jour par le futur module d'inscription. Les réponses donnent aussi `spotsLeft` (`null` si illimitée) et `isFull` |
| `color` | Couleur `#RRGGBB` (enregistrée en minuscules), pour le calendrier |
| `icon` | Nom d'icône en minuscules et tirets (ex. `church`, `music-note`), pour le calendrier |

**Création** (`POST /admin/events`) :
```json
{
  "startsAt": "2026-12-24T17:30:00Z",
  "endsAt": "2026-12-24T20:00:00Z",
  "type": "SERVICE",
  "capacity": 200,
  "color": "#d4a017",
  "icon": "church",
  "isFeatured": true,
  "coverImageId": "<uuid d'un fichier storage_files prêt, de type image>",
  "registrationRequired": true,
  "registrationUrl": "https://forms.example.org/noel",
  "notifyOnPublish": true,
  "translations": {
    "fr": { "title": "Soirée de Noël", "description": "…", "location": "147 Kigoma" },
    "en": { "title": "Christmas Night", "description": "…", "location": "147 Kigoma" }
  }
}
```
- `translations.fr` est obligatoire ; `en` est facultatif (si présent, `title` et `description` le sont aussi).
- `slug` (identifiant d'URL) est **généré** depuis le titre (`soiree-de-noel`, suffixe `-2` en cas de doublon) ; on peut
  le fournir (`a-z`, `0-9`, `-`) : un doublon donne alors 409. Il **ne change pas** quand le titre change (URL stables),
  sauf demande explicite.
- `title` 3–150 caractères, `description` ≤ 10 000, `location` ≤ 200 (texte brut : le frontend doit l'échapper).
- Réponse : 201 avec l'événement complet (`status`, `state`, dates, `coverImage` avec `url` et `thumbnailUrl`,
  `translations` par langue…).

**Modification** (`PATCH`) : tous les champs sont facultatifs. `"translations": { "en": null }` supprime l'anglais
(le français ne peut pas être supprimé). Un événement archivé n'est pas modifiable (409). Les modifications de statut
passent par les actions ci-dessus, jamais par `PATCH`.

**Liste** (`GET /admin/events`), paramètres facultatifs :

| Paramètre | Valeurs |
|---|---|
| `page`, `limit` | défaut 1 et 20 ; `limit` ≤ 100 |
| `q` | recherche (insensible à la casse) dans titre, description, lieu et slug, toutes langues |
| `state` | `DRAFT`, `SCHEDULED`, `PUBLISHED`, `ENDED`, `CANCELLED`, `ARCHIVED` |
| `type` | un des types ci-dessus |
| `featured`, `registrationRequired` | `true` / `false` |
| `from`, `to` | bornes sur `startsAt` (ISO 8601) |
| `deleted` | `true` : corbeille uniquement |
| `sort`, `order` | `startsAt` (défaut), `createdAt`, `updatedAt` ; `asc` / `desc` (défaut) |

Réponse : `{ "success": true, "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`.

### Lecture publique

| Méthode | Route | Description |
|---|---|---|
| GET | `/events` | Événements publiés (et annulés après publication) |
| GET | `/events/calendar` | Événements d'une période, format calendrier |
| GET | `/events/:slug` | Détail par identifiant d'URL (`calendar` est un identifiant réservé) |

Paramètres de `/events` : `type`, `lang` (`fr`/`en`), `when` (`upcoming` par défaut, `past`, `all`), `q`, `featured`, `page`,
`limit` (défaut 12, ≤ 100). Tri : à venir du plus proche au plus lointain ; passés du plus récent au plus ancien.

- **Langue** : `?lang=` sinon en-tête `Accept-Language`, sinon français. Sans traduction dans la langue demandée,
  le français est servi (le champ `language` indique la langue réellement servie).
- `/events/:slug` cherche le slug **dans la langue demandée** ; `alternates` donne le slug de chaque traduction
  (pour un sélecteur de langue).
- Réponse publique : `id`, `slug`, `language`, `title`, `description`, `location`, `state`, `startsAt`, `endsAt`,
  `isFeatured`, `registrationRequired`, `registrationUrl`, `coverImage`, `alternates`. Aucun champ interne
  (statut, `publishAt`, auteur, `notifyOnPublish`, dates de gestion).
- En-tête `Cache-Control: public, max-age=60`. Limite : 1000 requêtes par 15 minutes et par IP.

### Calendrier (`GET /events/calendar`)

Pour afficher une grille mensuelle. Une période obligatoire, au choix :
- `month=2026-12` : le mois **local** de l'église (du 1er 00 h au 1er suivant 00 h, heure de Kinshasa) ;
- `from=…&to=…` (ISO 8601, `to` exclu, 366 jours maximum).

Autres paramètres : `type`, `lang`. Réponse : `{ from, to, count, truncated, items }` (500 entrées au plus ;
`truncated: true` si la période en contient davantage). Chaque entrée est légère : `id`, `slug`, `title`, `location`,
`state`, `type`, `color`, `icon`, `startsAt`, `endsAt`, **`end`** (fin effective : `endsAt`, ou 23 h 59 locale du jour de
début), `isFeatured`, `registrationRequired`, `isFull`. Sont inclus les événements qui **chevauchent** la période (un
événement du 27 février au 2 mars apparaît en mars), publiés ou annulés ; jamais les brouillons. Cache : 60 s.

### Préparation OneSignal

Le module n'envoie aucune notification (Sprint dédié). Il émet sur un bus interne (`utils/domainEvents.js`) :
`event.published` `{ eventId, notifyOnPublish, reason: "manual" | "scheduled", adminId? }` et `event.cancelled`
`{ eventId, adminId }`. Le futur module de notifications s'y abonne sans modifier les événements ;
`notifyOnPublish` porte le souhait de l'administrateur. La table `notifications` pointe déjà vers `events`.

### Audit

`CREATE`, `UPDATE` (champs modifiés avec ancienne et nouvelle valeur ; pour les textes, **uniquement les noms des champs**,
jamais leur contenu), `STATUS_CHANGE` (`action`, `from`, `to`, `publishAt`, `reason`), `DELETE`, `RESTORE`.
Les bascules automatiques de la publication programmée sont écrites sans administrateur (`adminId` vide, `reason: "scheduled"`).

## Actualités

Même fonctionnement que les événements (traductions FR/EN, image de couverture, publication programmée, audit,
recherche, pagination, lecture publique localisée), sans annulation ni état « terminé ».

### États et transitions

Statuts : `DRAFT`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED` (`state` : identique ; une actualité programmée dont l'heure est
venue est `PUBLISHED`).

| Action (POST `/admin/news/:id/<action>`) | Depuis | Vers | Corps |
|---|---|---|---|
| `publish` | DRAFT, SCHEDULED | PUBLISHED | — |
| `schedule` | DRAFT, SCHEDULED | SCHEDULED | `{ "publishAt": "…" }` (≥ 1 min dans le futur) |
| `unpublish` | PUBLISHED, SCHEDULED | DRAFT | — |
| `archive` | DRAFT, SCHEDULED, PUBLISHED | ARCHIVED | — |
| `unarchive` | ARCHIVED | DRAFT | — |

Transition impossible : 409. Publier exige titre et contenu en français. Mêmes règles que les événements pour la
publication programmée (visible à l'heure dite, tâche de fond atomique), la suppression (interdite si publiée : dépublier
ou archiver d'abord), la corbeille et la restauration (une actualité programmée revient en brouillon).

### Administration

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/news` | Liste filtrée et paginée |
| POST | `/admin/news` | Création (brouillon) |
| GET | `/admin/news/:id` | Détail complet, toutes langues |
| PATCH | `/admin/news/:id` | Modification partielle (`translations.en: null` supprime l'anglais) |
| DELETE | `/admin/news/:id` | Suppression logique (DRAFT, SCHEDULED ou ARCHIVED) |
| POST | `/admin/news/:id/restore` | Restauration |
| POST | `/admin/news/:id/{publish,schedule,unpublish,archive,unarchive}` | Transitions |

**Création** :
```json
{
  "isFeatured": false,
  "coverImageId": "<uuid d'un fichier image prêt>",
  "notifyOnPublish": true,
  "translations": {
    "fr": { "title": "Nouvelle église à Kinshasa", "excerpt": "Résumé facultatif.", "content": "Texte complet…" },
    "en": { "title": "New church in Kinshasa", "content": "Full text…" }
  }
}
```
`title` 3–200 caractères, `excerpt` ≤ 500 (facultatif), `content` 1–50 000 (texte brut : le frontend doit l'échapper).
Le slug se génère et se conserve comme pour les événements. **Liste** : `page`, `limit`, `q` (titre, extrait, contenu, slug),
`state`, `featured`, `from`/`to` (date de création), `deleted`, `sort` (`createdAt`, `updatedAt`, `publishedAt`), `order`.

### Lecture publique

| Méthode | Route | Description |
|---|---|---|
| GET | `/news` | Actualités publiées, les plus récentes d'abord |
| GET | `/news/:slug` | Détail par identifiant d'URL, texte complet |

Paramètres de `/news` : `lang`, `q`, `featured`, `from`/`to` (date de publication), `page`, `limit` (défaut 12).
La liste renvoie `excerpt` (celui de l'administrateur, sinon le début du contenu coupé à un mot, 200 caractères au plus) et
**pas** le `content`. Réponse : `id`, `slug`, `language`, `title`, `excerpt`, `publishedAt`, `isFeatured`, `coverImage`,
`alternates` (+ `content` en détail). Mêmes règles de langue, de cache et de limitation que les événements.

Événement interne émis : `news.published` `{ newsId, notifyOnPublish, reason: "manual" | "scheduled", adminId? }`.
Audit : `CREATE`, `UPDATE` (noms de champs, jamais les textes), `STATUS_CHANGE`, `DELETE`, `RESTORE` (entité `news`).

## Messages du jour

Un message par **date** (jour local de l'église, `APP_TIMEZONE`, Kinshasa par défaut), avec traductions FR/EN,
image Cloudinary, publication programmée, audit, suppression logique et lecture publique. Même architecture que les
événements et les actualités.

### Champs

| Champ | Description |
|---|---|
| `date` | `AAAA-MM-JJ`, jour de calendrier réel. **Une seule ligne active par date** (409 sinon, voir ci-dessous) |
| `imageId` | UUID d'un fichier image prêt (dossier de stockage `daily-messages`), `null` pour l'effacer |
| `sendNotification` | Souhait d'une notification push (défaut `false`) |
| `translations.<fr\|en>.title` | 3–150 caractères |
| `…content` | 1–10 000 caractères (texte brut : le frontend doit l'échapper) |
| `…verseReference` | ≤ 100, ex. `Jean 3:16` |
| `…verseText` | ≤ 1 000, texte du verset |
| `…theme` | ≤ 60, ex. `Espérance` |
| `…notificationTitle` | ≤ 80, titre de la notification (à défaut : le titre) |
| `…notificationBody` | ≤ 240, texte de la notification (à défaut : un extrait du contenu) |
| `…estimatedReadingTime` | **Lecture seule**, calculé : minutes, au moins 1, à 200 mots/minute sur `content` + `verseText`. Recalculé à chaque changement de ces textes ; toute valeur envoyée est ignorée |

Une date occupée par un message **archivé** reste occupée ; une date de message **supprimé** (corbeille) est libre,
mais la restauration échoue (409) si un autre message l'a reprise entre-temps.

### États et transitions

Statuts : `DRAFT`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED` (mêmes transitions que les actualités). Chaque message expose en
plus `phase` : `UPCOMING` (date future), `CURRENT` (aujourd'hui) ou `PAST`.

**Publié ne veut pas dire affiché** : un message n'est visible du public qu'à partir de **sa date**, même publié ou
programmé bien avant. On peut donc préparer et publier la semaine à l'avance.

| Action (POST `/admin/daily-messages/:id/<action>`) | Depuis | Vers | Corps |
|---|---|---|---|
| `publish` | DRAFT, SCHEDULED | PUBLISHED | — |
| `schedule` | DRAFT, SCHEDULED | SCHEDULED | `{ "publishAt": "…" }` (≥ 1 min dans le futur, au plus tard le jour du message) |
| `unpublish` | PUBLISHED, SCHEDULED | DRAFT | — |
| `archive` | DRAFT, SCHEDULED, PUBLISHED | ARCHIVED | — |
| `unarchive` | ARCHIVED | DRAFT | — |

409 si la transition est impossible. Publier exige titre et contenu en français. Suppression refusée si publié
(dépublier ou archiver d'abord) ; la restauration d'un message programmé le remet en brouillon.

### Administration

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/daily-messages` | Liste filtrée et paginée |
| POST | `/admin/daily-messages` | Création (brouillon) |
| GET | `/admin/daily-messages/:id` | Détail complet, toutes langues |
| PATCH | `/admin/daily-messages/:id` | Modification partielle (`translations.en: null` supprime l'anglais ; `null` efface un champ facultatif) |
| DELETE | `/admin/daily-messages/:id` | Suppression logique (DRAFT, SCHEDULED, ARCHIVED) |
| POST | `/admin/daily-messages/:id/restore` | Restauration |
| POST | `/admin/daily-messages/:id/{publish,schedule,unpublish,archive,unarchive}` | Transitions |

**Création** :
```json
{
  "date": "2026-12-25",
  "imageId": "<uuid d'un fichier image prêt>",
  "sendNotification": true,
  "translations": {
    "fr": {
      "title": "Rester ferme", "content": "…",
      "verseReference": "Jean 3:16", "verseText": "Car Dieu a tant aimé le monde…", "theme": "Espérance",
      "notificationTitle": "Message du jour", "notificationBody": "Une parole pour aujourd'hui"
    },
    "en": { "title": "Stand firm", "content": "…", "theme": "Hope" }
  }
}
```
**Liste** : `page`, `limit` (≤ 100, défaut 20), `q` (titre, contenu, référence, verset, thème), `state`, `theme` (égalité,
insensible à la casse), `from`/`to` (dates `AAAA-MM-JJ`), `deleted`, `sort` (`date` par défaut, `createdAt`, `updatedAt`), `order`.

### Lecture publique

| Méthode | Route | Description |
|---|---|---|
| GET | `/daily-messages/today` | **Message du jour**, avec repli automatique |
| GET | `/daily-messages/:date` | Message d'une date passée ou courante (`AAAA-MM-JJ`) |
| GET | `/daily-messages` | Archive paginée, du plus récent au plus ancien |

**Repli (`/today`).** S'il n'existe pas de message publié pour la date du jour, l'API renvoie **automatiquement le dernier
message publié** (le plus récent par date, dans le passé) avec `"isFallback": true`. Le frontend peut alors afficher, par
exemple, « Message du 12 décembre ». Réponse :
```json
{ "success": true, "data": {
  "id": "…", "date": "2026-12-12", "requestedDate": "2026-12-14", "isFallback": true,
  "language": "fr", "title": "…", "content": "…", "verseReference": "Psaume 23:1", "verseText": "…",
  "theme": "Paix", "estimatedReadingTime": 2, "image": { "url": "…", "thumbnailUrl": "…" },
  "availableLanguages": ["fr", "en"] } }
```
- `isFallback: false` quand le message est bien celui du jour ; `date` et `requestedDate` sont alors identiques.
- Les brouillons, archivés, supprimés et messages à date future sont ignorés pour le repli.
- **404** seulement s'il n'existe encore aucun message publié.
- `/daily-messages/:date` ne fait **jamais** de repli : 404 si la date est future, inconnue ou non publiée.

La liste publique renvoie un `excerpt` (début du contenu) mais pas `content` ni `verseText`. Paramètres : `lang`, `q`, `theme`,
`from`, `to`, `page`, `limit` (défaut 12). Langue : `?lang=` sinon `Accept-Language`, sinon français, avec repli sur le français.
Aucun champ interne n'est exposé (statut, notification, programmation, auteur). `Cache-Control: public, max-age=60`.

### Préparation OneSignal

Aucune notification n'est envoyée par ce module. Il émet `daily-message.published`
`{ dailyMessageId, sendNotification, date, reason: "manual" | "scheduled", adminId? }` à la publication. **Le module de
notifications devra attendre la `date` du message** avant d'envoyer (un message peut être publié des jours à l'avance),
puis utiliser `notificationTitle` / `notificationBody` de la langue de l'abonné.

### Audit

`CREATE`, `UPDATE` (champs et dates modifiés ; pour les textes, **seulement les noms des champs**), `STATUS_CHANGE`
(`action`, `from`, `to`, `publishAt`), `DELETE`, `RESTORE` — entité `daily_messages`. La bascule automatique de la
publication programmée est écrite sans administrateur (`reason: "scheduled"`).

## Galerie

Albums contenant des photos et des vidéos hébergées (Cloudinary), avec tags pour la recherche transversale.
Administration sous `/admin/gallery` (Admin et Super Admin) ; lecture publique sous `/gallery`.

### Modèle

**Album** : titre et description FR/EN (le français est obligatoire), `slug` (généré, stable, unique par langue), `date`
(`AAAA-MM-JJ`, défaut : aujourd'hui), `isFeatured`, `sortOrder` (ordre d'affichage manuel, croissant ; un nouvel album est
placé à la fin), `coverImageId` (image prête ; sans couverture, le **premier média** sert de couverture), `linkedEventId`
(événement lié, facultatif). Statuts : `DRAFT`, `PUBLISHED`, `ARCHIVED`.

**Média** : un fichier déjà stocké, avec `type` (`PHOTO` ou `VIDEO`, déduit du fichier), `position` (ordre dans l'album),
`tags`, et par langue : `title`, `description`, `altText` (tous facultatifs). La **durée** d'une vidéo (`duration`, en
secondes), les dimensions et la miniature viennent du fichier. Un même fichier ne figure **qu'une fois par album**.

**Tags** : normalisés à l'enregistrement (minuscules, sans accents, chiffres et tirets : `Baptême 2026` → `bapteme-2026`),
sans doublon, 20 au plus par média, 40 caractères au plus. Ils servent de filtres : les libellés d'affichage sont à la
charge du frontend.

### Albums (administration)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/gallery/albums` | Liste (`page`, `limit`, `q`, `status`, `featured`, `eventId`, `from`, `to`, `deleted`, `sort`, `order`) |
| POST | `/admin/gallery/albums` | Création (brouillon) |
| GET / PATCH | `/admin/gallery/albums/:id` | Détail / modification partielle (`null` efface la couverture ou l'événement lié ; `translations.en: null` supprime l'anglais) |
| DELETE | `/admin/gallery/albums/:id` | Suppression logique (brouillon ou archivé) |
| POST | `/admin/gallery/albums/:id/restore` | Restauration |
| POST | `/admin/gallery/albums/:id/{publish,unpublish,archive,unarchive}` | Transitions (409 si impossible) |
| PUT | `/admin/gallery/albums/order` | Ordre manuel : `{ "ids": [...] }` |

- **Publier** exige un titre français et **au moins un média** (422 sinon).
- Supprimer un album ne touche pas ses médias : ils réapparaissent avec lui à la restauration.
- **Ordre** : `ids` doit contenir **exactement** les albums non supprimés ; sinon 409 (« liste périmée »), pour ne jamais écraser
  l'ajout d'un album fait entre-temps. Même principe pour l'ordre des médias.

### Médias (administration)

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/admin/gallery/albums/:id/items` | Médias de l'album (`page`, `limit` ≤ 200, `deleted=true` pour la corbeille) |
| POST | `/admin/gallery/albums/:id/import` | **Import multiple** : `multipart/form-data`, champ `files` (20 fichiers au plus) + `tags` facultatif (séparés par des virgules) |
| POST | `/admin/gallery/albums/:id/items` | Rattache des fichiers déjà envoyés : `{ "storageFileIds": [...], "tags": [...] }` (50 au plus) |
| PUT | `/admin/gallery/albums/:id/items/order` | **Réorganisation** : `{ "itemIds": [...] }` (liste exacte, sinon 409) |
| POST | `/admin/gallery/items/move` | **Déplacement** vers un autre album : `{ "itemIds": [...], "toAlbumId": "…" }` |
| PATCH | `/admin/gallery/items/:id` | Tags (remplacés) et textes par langue (`null` efface) |
| DELETE | `/admin/gallery/items/:id` | Suppression logique |
| POST | `/admin/gallery/items/:id/restore` | Restauration (à la fin de l'album) |
| GET | `/admin/gallery/tags` | Tags utilisés, avec leur nombre d'usages |

- **Import multiple** : chaque fichier passe par le StorageService (type vérifié par le contenu, EXIF supprimé, dédoublonnage,
  audit). Photos et vidéos seulement (voir `MEDIA_GUIDE.md`). Un fichier refusé n'arrête pas les autres : la réponse est un
  **rapport** `{ created, skipped, failed }` — `skipped` : déjà dans l'album ; `failed` : nom, statut HTTP et raison.
  Statut : 201 si au moins un média est créé, 422 si tout est refusé.
- **Déplacement** : les médias sont ajoutés **à la fin** de l'album cible dans l'ordre demandé ; tags et textes suivent. Un
  fichier déjà présent dans la cible est signalé (`skipped`) et laissé en place. Un album archivé ne peut ni recevoir ni
  perdre de média (409).
- Un fichier utilisé par la galerie ne peut pas être supprimé du stockage (409 avec le détail des usages) ni nettoyé comme orphelin.

### Lecture publique

| Méthode | Route | Description |
|---|---|---|
| GET | `/gallery/home` | Albums **mis en avant** (ordre manuel) et albums **récents** (`limit` 1–24, défaut 6) |
| GET | `/gallery/albums` | Albums publiés. Filtres : `q`, `tags`, `match`, `eventId`, `featured`, `from`, `to`, `lang`, `sort` (`recent` par défaut, ou `manual`), `page`, `limit` |
| GET | `/gallery/albums/:slug` | Un album et ses médias (paginés : `page`, `limit` ≤ 200, défaut 60 ; filtres `tags`, `match`, `type`) |
| GET | `/gallery/items` | **Recherche transversale** de médias : `q`, `tags`, `match`, `type` (`PHOTO`/`VIDEO`), `albumId`, `eventId`, `lang`, `page`, `limit` |
| GET | `/gallery/tags` | Tags des albums publiés, avec leur nombre d'usages (pour construire un filtre) |
| GET | `/events/:slug/albums` | **Albums liés à un événement** (consultation depuis la page de l'événement) |

- **Tags** : `tags=bapteme,jeunesse` ; `match=all` (défaut : tous les tags) ou `match=any` (au moins un). La saisie est
  normalisée comme à l'enregistrement.
- **Recherche `q`** : titre, description, texte alternatif et tag. Sur `/gallery/albums`, un album ressort aussi si l'un de ses
  **médias** correspond.
- **Événement lié** : un album porte `linkedEvent { id, slug, title, startsAt }` seulement si l'événement est lui-même visible
  du public. `/events/:slug/albums` répond 404 pour un événement non public.
- **Texte alternatif** : `altText`, sinon le titre du média, sinon le titre de l'album (jamais vide).
- Réponse d'un album : `id`, `slug`, `language`, `title`, `description`, `date`, `isFeatured`, `cover`, `itemCount`, `linkedEvent`,
  `availableLanguages`, `alternates`. Un média : `id`, `type`, `position`, `title`, `description`, `altText`, `tags`, `url`
  (optimisée), `thumbnailUrl`, `width`, `height`, `duration`. Aucun champ interne (statut, auteur, suppression).
- Langue : `?lang=` sinon `Accept-Language`, sinon français, avec repli sur le français. `Cache-Control: public, max-age=60`.

### Audit

Entités `gallery_albums` et `gallery_items` : `CREATE` (un enregistrement par import ou rattachement : nombre, identifiants,
tags), `UPDATE` (champs, tags ; **jamais les textes** ; déplacement et réorganisation compris), `STATUS_CHANGE`, `DELETE`,
`RESTORE`. Chaque fichier envoyé par l'import écrit aussi `UPLOAD_FILE`.

## Personnes (table générique)

Une seule table pour toutes les personnes de l'église : page des pasteurs, équipe, responsables, intervenants. Le **nom** n'est pas
traduit ; le **titre** (« Pasteur principal ») et la **biographie** le sont (FR/EN, tous deux facultatifs, aucune langue obligatoire).
Une personne a une ou plusieurs **catégories** : `PASTOR`, `TEAM`, `SPEAKER`, `LEADER`, `OTHER`. Les autres modules (prédications
aujourd'hui, événements ou équipe demain) s'y réfèrent par leur identifiant. Aucune coordonnée privée n'est stockée.

| Méthode | Route | Rôle |
|---|---|---|
| GET / POST | `/admin/people` | Liste (`q`, `status`, `category`, `deleted`, `sort`, `order`, `page`, `limit`) / création |
| GET / PATCH | `/admin/people/:id` | Détail / modification partielle (`photoId: null` efface la photo ; `translations.en: null` retire une langue) |
| DELETE · POST | `/admin/people/:id` · `/:id/restore` | Suppression logique (brouillon ou archivée) / restauration |
| POST | `/admin/people/:id/{publish,unpublish,archive,unarchive}` | Visibilité de la **fiche** publique |
| GET | `/people` · `/people/:slug` | Lecture publique : `q`, `category`, `lang`, `page`, `limit` ; le détail ajoute `sermonCount` |

Corps : `firstName`, `lastName` (1–80 caractères), `categories`, `sortOrder` (ordre d'affichage, puis nom), `photoId` (dossier `people`),
`slug` (généré depuis le nom, `-2` en cas de doublon, stable ensuite), `translations.<fr|en>.{ title (≤ 120), bio (≤ 5000) }`.

- **Fiche publique ≠ présence sur une prédication** : une personne dont la fiche n'est pas publiée reste **nommée** comme intervenante
  d'une prédication publiée, mais sans lien (`slug: null`) ni photo.
- Une personne qui intervient dans une prédication **ne peut pas être supprimée** (409 : retirez-la d'abord de chacune).
- Audit : entité `people` (les biographies n'y figurent jamais).

## Prédications

Audio MP3, vidéo hébergée **ou** lien YouTube, documents PDF, versets, thèmes, tags, séries, intervenants avec rôle, compteurs,
publication programmée. Mêmes briques que les événements et actualités : traductions FR/EN (slug par langue), image Cloudinary,
suppression logique, audit, lecture publique localisée. Administration sous `/admin/sermons` et `/admin/sermon-series` ; lecture
publique sous `/sermons` et `/sermon-series`.

### Champs d'une prédication

| Champ | Description |
|---|---|
| `date` | `AAAA-MM-JJ` (obligatoire) : date de la prédication |
| `seriesId`, `seriesPosition` | Série (facultative) et numéro dans la série (≥ 1, exige une série ; retirer la série l'efface) |
| `audioFileId` | MP3 déjà envoyé (dossier `sermons/audio`) |
| `videoFileId` **ou** `youtubeUrl` | Vidéo hébergée **ou** lien YouTube (`youtu.be/…`, `youtube.com/watch?v=…`, `/embed/`, `/shorts/`, `/live/`) ; **jamais les deux** (422). L'identifiant à 11 caractères est extrait et le lien est réécrit proprement |
| `coverImageId` | Couverture. Sans elle : miniature YouTube, puis vidéo hébergée, puis couverture de la série |
| `tags` | Normalisés (`Persévérance 2026` → `perseverance-2026`), 20 au plus |
| `isFeatured`, `notifyOnPublish` | Mise en avant ; souhait de notification (préparation OneSignal) |
| `preacherId` **ou** `speakers` | Intervenants (voir plus bas) |
| `translations.<fr\|en>` | `title` (3–150, FR obligatoire), `description` (≤ 3000), `theme` (≤ 60), `verseReferences` (tableau, 10 références de 80 caractères au plus ; lignes vides et doublons retirés) |

La **durée** (`durationSeconds`) vient du fichier audio, sinon de la vidéo hébergée. Les **compteurs** (`stats.views`, `stats.plays`,
`stats.downloads`) sont en lecture seule : l'administration ne peut pas les modifier.

### Intervenants et rôles

Le modèle accepte **plusieurs personnes avec chacune un rôle** (`SpeakerRole` : `PREACHER`, `GUEST_PREACHER`, `TRANSLATOR`,
`WORSHIP_LEADER`, `MODERATOR`, `PRAYER`, `OTHER`), dans l'ordre fourni ; une même personne peut cumuler des rôles différents, jamais deux fois le même.
L'interface actuelle n'utilise qu'un prédicateur : `preacherId` est un **raccourci** (équivaut à `speakers: [{ personId, role: "PREACHER" }]` ;
`preacherId: null` retire tous les intervenants). `speakers` remplace la liste complète (10 au plus) ; envoyer les deux est refusé (422).
En lecture publique, `speakers` donne tous les rôles et `preacher` le premier `PREACHER` (raccourci pour l'interface).

### États et transitions (comme les actualités)

`DRAFT`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED`. Actions `POST /admin/sermons/:id/<action>` : `publish`, `schedule` (`{ "publishAt": "…" }`,
≥ 1 min dans le futur), `unpublish`, `archive`, `unarchive` ; 409 si impossible. **Publier ou programmer exige un titre français et au moins
un média** (audio, vidéo ou YouTube). Visible à l'heure exacte de `publishAt` ; une tâche de fond bascule ensuite le statut (atomique).
Suppression logique refusée si publiée. Événement de domaine **`sermon.published`** `{ sermonId, notifyOnPublish, reason: "manual" | "scheduled", adminId? }`
pour les futures notifications.

### Administration

| Méthode | Route | Rôle |
|---|---|---|
| GET / POST | `/admin/sermons` | Liste / création |
| GET / PATCH / DELETE | `/admin/sermons/:id` | Détail / modification / suppression logique |
| POST | `/admin/sermons/:id/{publish,schedule,unpublish,archive,unarchive,restore}` | Transitions et restauration |
| POST | `/admin/sermons/:id/documents` | Ajoute des PDF : `{ "documents": [{ "storageFileId", "translations": { "fr": { "title" } } }] }` (20 au plus ; sans titre français, le nom du fichier sert de titre ; doublons ignorés ; non-PDF refusés — rapport `{ created, skipped, failed }`) |
| PATCH · DELETE | `/admin/sermons/documents/:docId` | Titres par langue / retire le lien (le fichier reste au stockage) |
| PUT | `/admin/sermons/:id/documents/order` | Ordre : `{ "documentIds": [...] }` (liste exacte, sinon 409) |
| GET | `/admin/sermons/tags` | Tags utilisés et leur nombre d'usages |
| GET / POST / PATCH / DELETE … | `/admin/sermon-series[/:id[/…]]` | Séries : mêmes opérations (`publish`, `unpublish`, `archive`, `unarchive`, `restore`) ; suppression refusée (409) si la série contient des prédications |

**Filtres communs** (administration et public) : `q` (titre, description, thème, slug, tag, **nom d'intervenant**, titre de série, **verset**),
`tags` + `match` (`all` par défaut ou `any`), `theme` (égalité, insensible à la casse), `verse` (contient, ex. `jean 3` trouve « Jean 3:16 »),
`seriesId`, `speakerId` + `role`, `featured`, `hasAudio`, `hasVideo` (hébergée ou YouTube), `from` / `to`, `page`, `limit` (≤ 100).
Administration en plus : `state`, `deleted`, `sort` (`date` défaut, `createdAt`, `updatedAt`, `playCount`, `viewCount`, `downloadCount`), `order`.

### Lecture publique

| Méthode | Route | Description |
|---|---|---|
| GET | `/sermons` | Liste. Filtres ci-dessus + `series` (slug) + `lang` ; `sort` : `recent` (défaut), `oldest`, `popular` (écoutes) |
| GET | `/sermons/:slug` | Détail (slug dans la langue demandée) |
| GET | `/sermons/tags` | Tags des prédications publiées, avec compteurs |
| POST | `/sermons/:id/{views,plays,downloads}` | **Compteurs** |
| GET | `/sermon-series` · `/sermon-series/:slug` | Séries publiées (`sermonCount`) ; le détail liste leurs prédications dans l'ordre de la série (numéro, puis date) |

- **Liste** : `excerpt` (début de la description) mais pas `description`. **Détail** : `description`, `audio` (`url`, `duration`, `bytes`),
  `video` (hébergée : `url`, `thumbnailUrl`, `duration`) ou `youtube` (`id`, `watchUrl`, `embedUrl`, `thumbnailUrl`), `documents`
  (`title` localisé, `url`, `bytes`), `speakers`, `preacher`, `series`, `tags`, `verseReferences`, `stats`. Aucun champ interne.
- Une **série non publiée** est masquée sur ses prédications (`series: null`) et sa couverture n'est pas utilisée.
- Langue : `?lang=` sinon `Accept-Language`, sinon français, avec repli sur le français. `Cache-Control: public, max-age=60` (sauf les compteurs).

### Compteurs

`POST /sermons/:id/views` (page consultée), `/plays` (lecture audio ou vidéo), `/downloads` (téléchargement audio ou document). À appeler
par le frontend aux moments voulus : un `GET` ne compte rien (il est mis en cache). Réponse `{ counted, stats }`.
- Un visiteur (adresse IP) n'est compté **qu'une fois par type et par période de 30 minutes** (`counted: false` ensuite, sans erreur).
- L'incrément est **atomique** en base (aucune perte en cas de requêtes simultanées) ; les prédications non publiées, supprimées ou
  inconnues répondent 404. Limite : 120 requêtes par minute et par IP.
- **Limites connues** : l'anti-doublon est en **mémoire** (une seule instance du serveur ; au redémarrage il repart de zéro) ; derrière un
  proxy ou un équilibreur il faudra configurer `trust proxy` pour que l'adresse IP soit celle du visiteur et non celle du proxy.

### Audit

Entités `sermons`, `sermon_documents`, `sermon_series`, `people` : `CREATE`, `UPDATE` (champs, tags, intervenants avant/après ; **jamais les textes**),
`STATUS_CHANGE`, `DELETE`, `RESTORE`. La bascule programmée est écrite sans administrateur (`reason: "scheduled"`).
