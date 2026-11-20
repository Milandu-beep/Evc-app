# EVC APP - PROJECT CHARTER
Version : 1.9
Statut : Validé
Historique : 1.1 (2026-11-20) — roadmap révisée (Sprints 2.5 et 3 à 12) ; 1.2 (2026-11-20) — stockage : Cloudinary (images) + Supabase Storage (PDF, audio), Cloudflare R2 en évolution possible ; 1.3 (2026-11-20) — vidéos hébergées (MP4/WebM) via Cloudinary en plus des liens YouTube ; 1.4 (2026-11-20) — Cloudinary pour tous les fichiers (images, vidéos, PDF, audio), Supabase Storage abandonné ; 1.5 (2026-11-20) — roadmap : Événements en Sprint 4, authentification avancée en Sprint 5 ; 1.6 (2026-11-20) — roadmap en 15 étapes (Actualités, Messages du jour, Galerie, Prédications avant les notifications et le tableau de bord) ; 1.7 (2026-11-20) — Actualités (5) et Messages du jour (6) réalisés ; 1.8 (2026-11-20) — Galerie (7) réalisée ; 1.9 (2026-11-20) — Prédications (8) réalisées, avec la table générique People
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

Via un service unique (StorageService) et un fournisseur interchangeable :

- Cloudinary : tous les fichiers (images, vidéos, PDF, audio)
- Cloudflare R2 : évolution possible, sans modifier la logique métier

La base de données ne stocke que les métadonnées. Voir docs/STORAGE_ARCHITECTURE.md.

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
- Vidéos YouTube (liens)
- Vidéos MP4/WebM hébergées (Cloudinary)

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

1. Fondation et authentification ✅
2. Base de données ✅
3. Stockage (StorageService, Cloudinary) ✅
4. Événements ✅
5. Actualités ✅
6. Messages du jour ✅
7. Galerie ✅
8. Prédications ✅
9. Notifications OneSignal
10. Tableau de bord
11. Authentification avancée (refresh tokens, permissions fines)
12. Frontend administrateur
13. Site public
14. PWA
15. Déploiement (Vercel, Railway ou VPS, Supabase, Cloudinary)

La médiathèque de la première version est répartie entre la Galerie (7) et les Prédications (8).

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