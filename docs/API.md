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
