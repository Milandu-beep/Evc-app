# Tableau de bord (Sprint 10)

Le tableau de bord est la page d'accueil de l'administration. Côté serveur, il expose **en lecture seule** une vue d'ensemble
calculée à partir des données existantes : aucune table, aucune migration, aucune écriture (pas même dans le journal d'audit).
L'interface graphique viendra avec le frontend administrateur (Sprint 12) ; ce document décrit le contrat de l'API.

Rôles : **Admin et Super Admin**. Quelques informations sont réservées au Super Admin (voir §2 et §5).

```
GET /api/admin/dashboard            → vue d'ensemble : indicateurs, alertes, agenda
GET /api/admin/dashboard/activity   → activité récente (journal d'audit), paginée et filtrable
```

## 1. Principes

- **Mêmes règles que les listes d'administration** : les compteurs par état réutilisent les filtres de chaque module
  (`event.state.js`, `content/lifecycle.js`). Un compteur « publié » du tableau de bord donne donc exactement le même nombre que
  `GET /admin/<module>?state=PUBLISHED`. Aucune règle n'est réécrite.
- **Lignes supprimées exclues** (suppression logique) de tous les compteurs.
- **Jours de l'église** : « aujourd'hui » et les dates de l'agenda suivent `APP_TIMEZONE` (Africa/Kinshasa par défaut).
- **Internationalisation** : le serveur renvoie des **codes** (états, alertes), jamais de phrases ; les titres de contenus sont donnés
  dans la langue demandée (`lang` ou `Accept-Language`, français à défaut).
- **Aucun secret** : ni clé de fournisseur, ni adresse IP, ni navigateur des administrateurs.

## 2. Indicateurs (`summary`)

| Clé | Contenu |
|---|---|
| `events` | `total`, `byState` (`DRAFT`, `SCHEDULED`, `PUBLISHED`, `ENDED`, `CANCELLED`, `ARCHIVED`), `publishedRecently` |
| `news` | `total`, `byState` (`DRAFT`, `SCHEDULED`, `PUBLISHED`, `ARCHIVED`), `publishedRecently` |
| `dailyMessages` | comme `news` |
| `sermons` | comme `news`, plus `stats` (`views`, `plays`, `downloads` : sommes) et `top` (les 5 prédications publiées les plus vues : `id`, `title`, `date`, `views`, `plays`, `downloads`) |
| `sermonSeries` | `total`, `byState` (`DRAFT`, `PUBLISHED`, `ARCHIVED`) |
| `gallery` | `albums` (`total`, `byState` comme les séries), `items` (`total`, `photos`, `videos`) |
| `people` | `total`, `byState` (comme les séries) |
| `notifications` | `total`, `byStatus` (`DRAFT`, `SCHEDULED`, `SENDING`, `SENT`, `FAILED`, `CANCELLED`), `sentRecently`, `provider` (`{ provider, enabled }`) |
| `storage` | fichiers prêts (`READY`) : `files`, `bytes`, `byResourceType` (`IMAGE`, `VIDEO`, `RAW` → `{ files, bytes }`) |
| `admins` | **Super Admin uniquement** : `total`, `active` |

`publishedRecently` / `sentRecently` : contenus publiés (`publishedAt`) / notifications envoyées (`sentAt`) au cours des
**30 derniers jours** (`recentDays` dans la réponse). `total` est la somme de `byState` (les états forment une partition).

## 3. Alertes (`alerts`)

Liste des points à traiter, **seulement ceux qui existent** (compte > 0), triés par gravité (`critical`, `warning`, `info`).
Chaque alerte : `{ code, severity, count, data? }`.

| Code | Gravité | Condition |
|---|---|---|
| `DAILY_MESSAGES_MISSING` | `critical` si aujourd'hui est concerné, sinon `warning` | Sur les **7 prochains jours** (aujourd'hui compris), dates sans message du jour publié ou programmé. `data.dates` : les dates `AAAA-MM-JJ` |
| `NOTIFICATIONS_FAILED` | `warning` | Notifications en échec (`FAILED`) : à relancer ou supprimer |
| `NOTIFICATIONS_LATE` | `warning` | Fournisseur actif, notifications planifiées en retard de plus de **5 min** (expéditeur arrêté ?) |
| `NOTIFICATIONS_PROVIDER_DISABLED` | `info` | Fournisseur désactivé (aucune clé OneSignal) alors que des notifications sont planifiées : elles ne partiront pas |
| `SCHEDULER_LATE` | `warning` | Contenus programmés dont l'heure de publication est dépassée de plus de **5 min** sans bascule (tâche de fond arrêtée ou `SCHEDULER_ENABLED=false`). Ils sont déjà visibles au public (la lecture ne dépend pas de la tâche) mais leurs notifications ne sont pas créées. `data` : nombre par module (`events`, `news`, `dailyMessages`, `sermons`) |
| `STORAGE_UPLOADS_STUCK` | `info` | Envois de fichiers restés « en cours » plus de 60 min (`CLEANUP.stuckUploadMinutes`) ; `npm run storage:cleanup` les traite |

## 4. Agenda (`agenda`)

Fenêtre de `days` jours (paramètre `days`, **1 à 31**, défaut **7**), d'aujourd'hui (jour de l'église) au dernier jour inclus.
La réponse donne `days`, `from` et `to` (dates `AAAA-MM-JJ`).

| Clé | Contenu (20 au plus, sauf mention) |
|---|---|
| `events` | Événements publiés ou programmés, **non terminés**, qui commencent avant la fin de la fenêtre (en cours compris), par date de début : `id`, `title`, `location`, `state`, `startsAt`, `endsAt`, `isFeatured` |
| `publications` | Publications programmées dans la fenêtre (événements, actualités, messages du jour, prédications), par heure : `module`, `id`, `title`, `publishAt` (50 au plus) |
| `notifications` | Notifications planifiées jusqu'à la fin de la fenêtre (y compris en retard), par heure d'envoi : `id`, `type`, `audience`, `title`, `scheduledAt` |
| `dailyMessages` | **Un élément par jour** de la fenêtre : `date`, `covered` (publié ou programmé), et le message s'il existe (`id`, `state`, `title`, sinon `null`) |

## 5. Activité récente

`GET /api/admin/dashboard/activity` : le journal d'audit, du plus récent au plus ancien.

| Paramètre | Description |
|---|---|
| `page`, `limit` | Pagination (`limit` : 1 à 100, défaut 20) |
| `entity` | `admins`, `events`, `news`, `daily_messages`, `gallery_albums`, `gallery_items`, `people`, `sermons`, `sermon_series`, `sermon_documents`, `notifications`, `storage_files` |
| `action` | `CREATE`, `UPDATE`, `DELETE`, `RESTORE`, `LOGIN`, `UPLOAD_FILE`, `DELETE_FILE`, `STATUS_CHANGE` |
| `adminId` | Actions d'un administrateur (UUID) |
| `from`, `to` | Période (ISO 8601) |

Élément : `id`, `action`, `entity`, `entityId`, `admin` (`{ id, firstName, lastName }`, ou `null` pour une action automatique comme la
publication programmée), `changes` (résumé sans texte ni mot de passe, tel qu'enregistré par les modules), `createdAt`.
**Jamais** l'adresse IP ni le navigateur.

La gestion des administrateurs est réservée au Super Admin : pour un Admin, les lignes de l'entité `admins` (connexions, comptes) sont
**exclues**, et `entity=admins` est refusé (**403**).

## 6. Performances

Une requête au tableau de bord exécute une soixantaine de lectures courtes (comptages surtout), en parallèle, toutes couvertes par les index existants
(`status`, `publishAt`, `deletedAt`, `createdAt`…) : aucune migration n'est nécessaire. Rien n'est mis en cache côté serveur
(`Cache-Control: no-store`) : l'administration voit toujours l'état réel.

## 7. Tests

`npm run test:dashboard` (vraie base, comme les autres suites) : sécurité et rôles, validation, cohérence des compteurs avec les listes
d'administration, exclusion des lignes supprimées, alertes (messages du jour manquants, notifications en échec, programmation en retard,
envois bloqués), agenda (fenêtre, tri, couverture des messages du jour), activité (filtres, pagination, masquage pour un Admin, aucun champ
sensible) et absence d'écriture.

## 8. Évolutions

- Messages de contact non lus : à ajouter lorsque le formulaire de contact existera (Site public).
- Inscriptions aux événements (`registeredCount`) : à ajouter avec le module d'inscription.
- Statistiques d'ouverture des notifications : dépendent du fournisseur (voir `NOTIFICATIONS.md` §9).
