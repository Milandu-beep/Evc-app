# EVC APP - PROJECT CHARTER
Version : 1.0
Statut : Validé
Projet : Plateforme officielle de l'Église Vie Céleste (EVC)

---

# 1. Vision

Développer une plateforme numérique moderne, performante et évolutive permettant à l'Église Vie Céleste de communiquer efficacement avec les fidèles, diffuser la Parole de Dieu et administrer toutes ses activités depuis une seule interface.

---

# 2. Identité

## Nom

Église Vie Céleste (EVC)

## Slogan

**Vivre sur la terre comme au ciel**

## Mission

**Former des chrétiens CONSACRÉS à Dieu, ÉPANOUIS en Jésus-Christ et INFLUENTS par le Saint-Esprit.**

---

# 3. Objectifs

La plateforme doit permettre :

- de présenter l'église
- de publier les actualités
- de publier les événements
- de diffuser des messages quotidiens
- d'envoyer des notifications
- de gérer une médiathèque
- d'être installable comme une application (PWA)

---

# 4. Utilisateurs

## Super Admin

Accès complet.

Peut gérer :

- les administrateurs
- les paramètres
- toutes les fonctionnalités

## Admin

Peut gérer :

- événements
- actualités
- médiathèque
- notifications
- messages quotidiens

---

# 5. Technologies

## Frontend

- HTML5
- CSS3
- JavaScript ES6

## Backend

- Node.js
- Express.js

## Base de données

- PostgreSQL (Supabase)

## ORM

- Prisma

## Authentification

JWT

## Notifications

OneSignal

## Stockage

Supabase Storage

---

# 6. Architecture

evc-app/

- admin/
- client/
- server/
- docs/
- assets/

---

# 7. Architecture Backend

Architecture MVC.

src/

- config/
- controllers/
- middleware/
- routes/
- services/
- utils/
- validators/
- uploads/

---

# 8. Fonctionnalités V1

## Site public

- Accueil
- À propos
- Mission
- Horaires
- Actualités
- Événements
- Médiathèque
- Contact

## Administration

- Authentification
- Dashboard
- Gestion des événements
- Gestion des actualités
- Gestion des messages
- Gestion des notifications
- Paramètres
- Gestion des administrateurs

---

# 9. Langues

- Français
- English

Toutes les chaînes devront être préparées pour l'internationalisation.

---

# 10. Médiathèque

Formats supportés :

- Images
- PDF
- MP3
- Vidéos YouTube

---

# 11. Horaires

Mardi

17h30 - 19h30

Vendredi

17h30 - 19h30

Dimanche

08h30 - 11h00

---

# 12. Coordonnées

Adresse

147 Kigoma

Commune de Kinshasa

Référence :

Croisement des avenues Kigoma et Wangata

Non loin de la Rawbank Huillerie

Email

eglisevieceleste2018@gmail.com

Réseaux sociaux

Facebook

YouTube

TikTok

Nom :

Église Vie Céleste

---

# 13. Règles de développement

Toujours développer étape par étape.

Chaque sprint doit être terminé avant de commencer le suivant.

Chaque fonctionnalité doit être :

- développée
- testée
- validée

Aucun code temporaire.

Aucun doublon.

Aucune dette technique volontaire.

---

# 14. Convention Git

main

Version stable.

develop

Développement.

feature/*

Nouvelle fonctionnalité.

fix/*

Correction.

---

# 15. Déploiement

Frontend

Vercel

Backend

Railway (ou VPS)

Base

Supabase

---

# 16. Roadmap

Sprint 1

- Backend
- Authentification
- Base de données

Sprint 2

- Dashboard

Sprint 3

- Événements

Sprint 4

- Actualités

Sprint 5

- Messages quotidiens

Sprint 6

- Notifications

Sprint 7

- Médiathèque

Sprint 8

- PWA

Sprint 9

- Déploiement

---

# 17. Règles Claude Code

Claude Code doit :

- respecter ce document
- ne jamais modifier l'architecture
- ne jamais changer la stack
- toujours expliquer les fichiers créés
- attendre la validation avant de passer au sprint suivant

---

# 18. Définition de terminé

Une fonctionnalité est terminée uniquement si :

- le code compile
- les tests sont réussis
- le responsive est validé
- la documentation est mise à jour
- le commit Git est effectué

---

Fin du document.