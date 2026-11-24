# Système de notifications

Architecture découplée : les modules de contenu **émettent des événements de domaine**, le système de notifications
**les écoute** et envoie les messages via un **fournisseur interchangeable**. Aucun module de contenu n'appelle jamais
OneSignal (ni aucun fournisseur) : un test automatique le vérifie en parcourant leur code.

```
Événements        event.published ─┐
Actualités        news.published ──┤        ┌────────────────────┐   planifiée    ┌─────────────┐   ┌──────────────┐
Messages du jour  daily-message.… ─┼──────▶ │ notification.      │ ─────────────▶ │ Expéditeur  │──▶│ Fournisseur  │
Prédications      sermon.published ┘        │ listeners          │  (table        │ (toutes les │   │ OneSignal    │
                                            └────────────────────┘  notifications)│  30 s)      │   │ Fake · None  │
Administrateur ── API /admin/notifications ──▶ NotificationService ──────────────▶└─────────────┘   └──────────────┘
```

## 1. Fournisseurs

Choisis par `NOTIFICATIONS_PROVIDER` (défaut : `onesignal` si les deux clés sont présentes, sinon `none`).

| Fournisseur | Rôle |
|---|---|
| `none` | **Désactivé** (défaut sans clés). Les notifications sont créées et planifiées, **mais rien n'est envoyé** ; elles restent en attente |
| `onesignal` | OneSignal (API REST). **Préparé, désactivé tant que `ONESIGNAL_APP_ID` et `ONESIGNAL_API_KEY` ne sont pas fournis** ; le serveur refuse de démarrer si on le demande sans clés |
| `fake` | Faux fournisseur en mémoire : tests automatisés et développement. **Interdit en production** (le serveur refuse de démarrer) |

Interface (`providers/provider.js`) : `name`, `enabled`, `send(message)` → `{ providerMessageId, recipients }` ou `ProviderError`
(`retryable` : incident passager à réessayer, ou refus définitif). L'envoi doit être idempotent par `notificationId`.

### Activer OneSignal

1. Créer une application OneSignal (push web). Relever l'**App ID** et la **clé API REST**.
2. Créer dans OneSignal les segments utilisés par les audiences (voir §4) si vous voulez les utiliser.
3. Dans `server/.env` : `ONESIGNAL_APP_ID=…` et `ONESIGNAL_API_KEY=…` (`PUBLIC_SITE_URL=https://…` pour que le toucher ouvre la bonne page).
4. Redémarrer, puis `POST /api/admin/notifications/test` pour vérifier la chaîne complète.

Rien d'autre à changer : les contrôleurs, les services de contenu et les tables sont indépendants du fournisseur.
**À l'activation**, les notifications restées en attente depuis plus de 24 h sont annulées (« expirées ») au lieu d'être envoyées en bloc.

## 2. Notifications automatiques

Un contenu publié avec le souhait de notification crée **une notification planifiée**, en français et en anglais (selon les
traductions du contenu), avec un lien propre à chaque langue.

| Événement de domaine | Condition | Texte (FR / EN) | Lien | Envoi |
|---|---|---|---|---|
| `event.published` | `notifyOnPublish`, événement visible et **non terminé** | « Nouvel événement » / « New event » — titre · lieu | `/events/<slug>` | tout de suite |
| `news.published` | `notifyOnPublish` | « Actualité » / « News » — titre | `/news/<slug>` | tout de suite |
| `daily-message.published` | `sendNotification`, date du jour ou future | `notificationTitle` / `notificationBody` du message, à défaut « Message du jour » — titre · verset | `/daily-messages/<date>` | **le jour du message à `DAILY_MESSAGE_NOTIFY_TIME`** (07:00, heure de l'église) ; publié le jour même après cette heure : tout de suite ; **jamais** pour une date passée |
| `sermon.published` | `notifyOnPublish` | « Nouvelle prédication » / « New sermon » — titre · prédicateur | `/sermons/<slug>` | tout de suite |

- **Une seule notification par contenu et par événement** (`dedupeKey`, par exemple `event.published:<id>`) : dépublier puis
  republier ne renvoie rien. Pour renvoyer volontairement : relance manuelle (§5).
- Un contenu publié par **publication programmée** déclenche la même chaîne (la tâche de fond émet le même événement).
- Au moment de l'envoi, si le **contenu n'est plus publié** (dépublié, supprimé, annulé), la notification est **annulée** avec le motif.
- Les chemins sont relatifs (`/events/…`) ; avec `PUBLIC_SITE_URL`, le lien ouvert au toucher est absolu.

## 3. Cycle de vie et historique

```
DRAFT ──schedule/send──▶ SCHEDULED ──(échéance)──▶ SENDING ──▶ SENT
  │                         │  ▲                       │
  │                         │  └──── RETRY (+1 min, +5 min) ◀─ incident passager
  └──cancel──▶ CANCELLED ◀──┘                          └──▶ FAILED (3 tentatives, ou refus définitif)
                                  FAILED / CANCELLED ──retry──▶ SCHEDULED
```

Chaque changement écrit une ligne **append-only** dans `notification_logs` : `CREATED`, `SCHEDULED`, `RESCHEDULED` (ancienne et nouvelle
date), `SENDING` (n° de tentative), `RETRY` (motif, prochaine tentative), `SENT` (identifiant chez le fournisseur, destinataires),
`FAILED` (motif), `CANCELLED` (motif). Chaque ligne indique l'**administrateur** à l'origine ou « automatique ». Disponible dans le détail
(`history`) et par `GET /admin/notifications/:id/history`. Les actions d'administration sont aussi dans `audit_logs` (jamais les textes).

## 4. Langues et audiences

- **FR / EN** : chaque notification a une ligne par langue (titre ≤ 80, message ≤ 240, lien). Le français est obligatoire. L'appareil reçoit la
  langue qui lui correspond ; OneSignal exige une version anglaise : à défaut, le français est repris.
- **Audiences** (`audience`) : `ALL` (tous), `ADMINS`, `MEMBERS`, `VISITORS`. Chez OneSignal elles correspondent à des **segments**
  (`ONESIGNAL_SEGMENT_ALL` défaut « Total Subscriptions », `_ADMINS` « Admins », `_MEMBERS` « Members », `_VISITORS` « Visitors »), à créer dans le
  tableau de bord et à alimenter par des étiquettes côté application. **Tant qu'il n'existe pas de comptes membres, seule `ALL` est utile** ; les
  autres sont acceptées et transmises pour préparer l'évolution. Les notifications automatiques vont à `ALL`, la notification de test à `ADMINS`.

## 5. Fiabilité

- **Réservation atomique** (`FOR UPDATE SKIP LOCKED`) : plusieurs instances du serveur ne s'envoient jamais la même notification.
- **Reprises** : incident passager (réseau, 429, 5xx) → nouvelle tentative après 1 min puis 5 min ; 3 tentatives au plus. Refus définitif (clé invalide,
  requête refusée) → `FAILED` tout de suite. Relance manuelle : `POST …/retry`.
- **Interruption** : un envoi resté « en cours » plus de 10 min (arrêt du serveur) est repris ; l'`idempotency_key` (identifiant de la notification) évite
  le doublon chez OneSignal. Tentatives épuisées → `FAILED`.
- **Expiration** : une notification en retard de plus de 24 h (`NOTIFICATION_MAX_AGE_HOURS`) n'est plus envoyée (annulée « expirée »).
- Les erreurs ne contiennent jamais la clé API.

## 6. Notification de test

`POST /api/admin/notifications/test` envoie **tout de suite**, à l'audience `ADMINS`, un message FR + EN (ou un texte personnalisé dans la langue choisie),
sans passer par la file d'attente, avec historique complet. Réponses : 201 (envoyée), **503** si le fournisseur est désactivé, **502** si le
fournisseur refuse (la tentative reste visible dans la liste, statut `FAILED`).

## 7. Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `NOTIFICATIONS_PROVIDER` | `onesignal`, `fake` ou `none` | `onesignal` si les clés existent, sinon `none` |
| `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` | Identifiants OneSignal (la clé reste sur le serveur) | — |
| `ONESIGNAL_SEGMENT_ALL/ADMINS/MEMBERS/VISITORS` | Segments des audiences | voir §4 |
| `ONESIGNAL_BASE_URL` | Adresse de l'API | `https://api.onesignal.com` |
| `PUBLIC_SITE_URL` | Préfixe des liens ouverts au toucher | vide (pas de lien absolu) |
| `DAILY_MESSAGE_NOTIFY_TIME` | Heure d'envoi du message du jour (`HH:MM`, heure de l'église) | `07:00` |
| `NOTIFICATION_MAX_AGE_HOURS` | Âge au-delà duquel une notification en retard est abandonnée | `24` |
| `SCHEDULER_ENABLED` | `false` désactive aussi l'expéditeur (avec la publication programmée) | actif |

## 8. Tests

`npm run test:notifications` (31 tests, vraie base Supabase, **FakeProvider** : aucun appel à OneSignal). Couvre : validation, cycle de vie complet,
planification et replanification, envoi, langues et audiences, reprises et échecs, annulation, réservation atomique à 3 expéditeurs simultanés,
reprise après interruption sans doublon, expiration, les quatre événements de domaine (dont la publication programmée), contenu retiré, notification de test,
suppression/restauration, filtres, historique, audit, contraintes de base, configuration (variables d'environnement) et `OneSignalProvider` avec un `fetch`
simulé (charge utile, segments, idempotence, erreurs retentables ou définitives). La table des notifications doit être vide au départ.

## 9. Limites connues et évolutions

- **Pas de ciblage individuel** : les appareils s'abonnent via le SDK OneSignal dans l'application (PWA, sprint dédié) ; le backend envoie à des segments.
- **Segments MEMBERS / VISITORS / ADMINS** : dépendent d'un système de comptes et d'étiquettes côté application (Sprint « authentification avancée »).
- **Pas de statistiques d'ouverture** : seul le nombre de destinataires renvoyé par OneSignal est conservé.
- Le fournisseur OneSignal n'a pas été exécuté contre l'API réelle (clés non fournies) : sa charge utile et sa gestion d'erreurs sont vérifiées par des tests avec un `fetch` simulé,
  à confirmer par la notification de test dès que les clés seront renseignées.
