# Base de données EVC

PostgreSQL (Supabase), via Prisma 7. Source de vérité : `server/prisma/schema.prisma`.

## Principes

- **Multilingue (charte §9)** : chaque contenu public = une table parente (données
  indépendantes de la langue) + une table `*_translations` avec une ligne par langue
  (`fr`, `en`), unique par `(parent, langue)`.
- **Statut éditorial** : `DRAFT`, `PUBLISHED`, `ARCHIVED`.
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
| `service_schedules` | Horaires de culte (`dayOfWeek` 0-6, `HH:mm`) | `service_schedule_translations` : libellé |
| `contact_messages` | Messages du formulaire Contact | — |

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
- `CHECK` sur `service_schedules` : jour entre 0 et 6, heures au format `HH:mm` valide.

## Migrations

| Migration | Contenu |
|---|---|
| `20261120091524_init_admins` | Table `admins`, enum `Role` |
| `20261120092905_data_model` | 15 tables, enums, index, contraintes `CHECK`, RLS |

## Commandes

```
npx prisma validate          # valider le schéma
npx prisma migrate status    # état des migrations
npx prisma migrate dev       # créer / appliquer une migration (développement)
npx prisma migrate deploy    # appliquer en production
npx prisma generate          # régénérer le client
npx prisma studio            # explorer les données
```
