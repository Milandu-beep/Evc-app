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
      "id": 1, "email": "admin@example.com", "firstName": "Super", "lastName": "Admin",
      "role": "SUPER_ADMIN", "isActive": true,
      "createdAt": "2026-11-20T09:19:26.068Z", "updatedAt": "2026-11-20T09:19:26.068Z"
    }
  }
}
```

Erreurs : 401 (« Email ou mot de passe incorrect », identique si l'email est inconnu
ou le compte désactivé), 422 (champs invalides), 429.

### GET `/auth/me`

Authentification requise. Retourne le profil de l'administrateur connecté (même objet
`admin` que ci-dessus). Erreurs : 401 (token absent, invalide, expiré, ou compte désactivé).

## Santé

### GET `/health`

Réponse 200 : `{ "status": "ok", "database": "up", "uptime": 12.3, "version": "1.0.0" }`.
Erreur 500 si la base est inaccessible.
