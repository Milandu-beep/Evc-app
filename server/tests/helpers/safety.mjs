// Garde-fou des tests d'intégration : ils créent puis suppriment des données dans la base désignée par .env.
// À importer EN PREMIER dans chaque suite. Refuse de continuer si l'environnement est la production.
import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("ARRÊT : les tests d'intégration écrivent dans la base de données ; ils sont interdits avec NODE_ENV=production.");
  process.exit(1);
}
