// Lance toutes les suites d'intégration l'une après l'autre (elles partagent la même base : jamais en parallèle).
// Les suites affichent « OK … » / « KO … » à la fin et sortent avec le code 0 : ce lanceur compte les lignes
// et échoue (code 1) s'il y a au moins un « KO », un plantage, ou une suite sans résultat.
// Exclu volontairement : storage.cloudinary.test.mjs (envoie de vrais fichiers, consomme des crédits) -> npm run test:storage:cloudinary
import "./helpers/safety.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SUITES = [
  "auth", "storage.stub", "events", "news", "dailyMessages", "gallery", "people", "sermons", "notifications",
];
const only = process.argv.slice(2);
const suites = only.length ? SUITES.filter((s) => only.includes(s)) : SUITES;

const run = (suite) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`./${suite}.test.mjs`, import.meta.url))], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ suite, code, out }));
  });

let failed = 0;
for (const suite of suites) {
  const started = Date.now();
  const { code, out } = await run(suite);
  const lines = out.split(/\r?\n/);
  const ok = lines.filter((l) => l.startsWith("OK ")).length;
  const ko = lines.filter((l) => l.startsWith("KO ")).length;
  const bad = code !== 0 || ko > 0 || ok === 0;
  if (bad) failed += 1;
  console.log(`${bad ? "ÉCHEC" : "ok   "}  ${suite.padEnd(14)} ${ok} OK, ${ko} KO  (${Math.round((Date.now() - started) / 1000)} s)${code !== 0 ? `  [code ${code}]` : ""}`);
  if (bad) {
    for (const l of lines.filter((l) => l.startsWith("KO "))) console.log("   " + l.slice(0, 300));
    if (ok === 0 || code !== 0) console.log(lines.filter((l) => l.trim() && !/\[INFO\]/.test(l)).slice(-8).map((l) => "   " + l.slice(0, 300)).join("\n"));
  }
}
console.log(failed ? `\n${failed} suite(s) en échec` : "\nToutes les suites sont passées");
process.exit(failed ? 1 : 0);
