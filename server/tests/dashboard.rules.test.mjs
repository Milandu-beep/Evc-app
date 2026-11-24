// Tests unitaires des règles du tableau de bord (fonctions pures) : aucune base de données, aucune variable d'environnement,
// aucune dépendance npm. Lancer : npm run test:dashboard:rules
const { addDays, agendaWindow, dailyCoverage, missingDates, partition, buildAlerts, SEVERITIES } = await import(
  "../src/services/dashboard/dashboard.rules.js"
);

const res = [];
const t = async (name, fn) => { try { await fn(); res.push("OK  " + name); } catch (e) { res.push("KO  " + name + " -> " + String(e.message).slice(0, 240)); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const TZ = "Africa/Kinshasa"; // UTC+1, sans heure d'été

await t("addDays : jours, fin de mois, fin d'année, année bissextile, valeur négative", async () => {
  must(addDays("2026-11-24", 1) === "2026-11-25", "jour suivant");
  must(addDays("2026-11-30", 1) === "2026-12-01", "fin de mois");
  must(addDays("2026-12-31", 1) === "2027-01-01", "fin d'année");
  must(addDays("2028-02-28", 1) === "2028-02-29", "29 février");
  must(addDays("2026-03-01", -1) === "2026-02-28", "recul");
  must(addDays("2026-11-24", 0) === "2026-11-24", "zéro");
});

await t("agendaWindow : commence au jour de l'église (pas au jour UTC), dates consécutives, fin = 23:59:59.999 locale", async () => {
  // 23:30 UTC le 24 = 00:30 le 25 à Kinshasa : la fenêtre commence le 25.
  const w = agendaWindow(new Date("2026-11-24T23:30:00Z"), 3, TZ);
  must(w.from === "2026-11-25" && w.to === "2026-11-27" && w.days === 3, `${w.from} -> ${w.to}`);
  must(w.dates.join() === "2026-11-25,2026-11-26,2026-11-27", w.dates.join());
  must(w.end.toISOString() === "2026-11-27T22:59:59.999Z", "fin : " + w.end.toISOString());
  const one = agendaWindow(new Date("2026-11-24T10:00:00Z"), 1, TZ);
  must(one.from === "2026-11-24" && one.to === "2026-11-24" && one.dates.length === 1, "un seul jour");
  const utc = agendaWindow(new Date("2026-11-24T23:30:00Z"), 1, "UTC");
  must(utc.from === "2026-11-24" && utc.end.toISOString() === "2026-11-24T23:59:59.999Z", "fuseau UTC");
});

await t("dailyCoverage : publié ou programmé couvre la date ; brouillon, archivé ou absent ne la couvre pas", async () => {
  const dates = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"];
  const cov = dailyCoverage(dates, [
    { date: "2026-11-24", state: "PUBLISHED", id: "a" },
    { date: "2026-11-25", state: "SCHEDULED", id: "b" },
    { date: "2026-11-26", state: "DRAFT", id: "c" },
    { date: "2026-11-27", state: "ARCHIVED", id: "d" },
    { date: "2026-12-31", state: "PUBLISHED", id: "hors fenêtre" },
  ]);
  must(cov.length === 5 && cov.map((c) => c.date).join() === dates.join(), "un élément par date, dans l'ordre");
  must(cov.map((c) => c.covered).join() === "true,true,false,false,false", cov.map((c) => c.covered).join());
  must(cov[2].message.id === "c" && cov[4].message === null, "message présent même non couvrant ; null si absent");
  must(missingDates(cov).join() === "2026-11-26,2026-11-27,2026-11-28", missingDates(cov).join());
});

await t("partition : total = somme, ordre des états conservé, valeurs absentes = 0", async () => {
  const p = partition(["DRAFT", "PUBLISHED", "ARCHIVED"], [2, 5, 0]);
  must(p.total === 7 && Object.keys(p.byState).join() === "DRAFT,PUBLISHED,ARCHIVED" && p.byState.PUBLISHED === 5, JSON.stringify(p));
  const q = partition(["A", "B"], [3]);
  must(q.total === 3 && q.byState.B === 0, JSON.stringify(q));
});

await t("buildAlerts : rien à signaler -> liste vide", async () => {
  const a = buildAlerts({ today: "2026-11-24", missingDailyDates: [], failedNotifications: 0, lateNotifications: 0, scheduledNotifications: 0, providerEnabled: true, schedulerLate: {}, stuckUploads: 0 });
  must(Array.isArray(a) && a.length === 0, JSON.stringify(a));
});

await t("buildAlerts : messages du jour manquants -> critical si aujourd'hui, sinon warning ; dates fournies", async () => {
  const today = "2026-11-24";
  const crit = buildAlerts({ today, missingDailyDates: [today, "2026-11-26"], providerEnabled: true });
  must(crit.length === 1 && crit[0].code === "DAILY_MESSAGES_MISSING" && crit[0].severity === "critical" && crit[0].count === 2, JSON.stringify(crit));
  must(crit[0].data.dates.join() === "2026-11-24,2026-11-26", "dates");
  const warn = buildAlerts({ today, missingDailyDates: ["2026-11-26"], providerEnabled: true });
  must(warn[0].severity === "warning" && warn[0].count === 1, JSON.stringify(warn));
});

await t("buildAlerts : notifications — retard si fournisseur actif, « fournisseur désactivé » sinon (jamais les deux)", async () => {
  const on = buildAlerts({ today: "x", providerEnabled: true, lateNotifications: 2, scheduledNotifications: 9, failedNotifications: 1 });
  must(on.map((a) => a.code).sort().join() === "NOTIFICATIONS_FAILED,NOTIFICATIONS_LATE", on.map((a) => a.code).join());
  must(on.find((a) => a.code === "NOTIFICATIONS_LATE").count === 2, "retard");
  const off = buildAlerts({ today: "x", providerEnabled: false, lateNotifications: 2, scheduledNotifications: 9 });
  must(off.length === 1 && off[0].code === "NOTIFICATIONS_PROVIDER_DISABLED" && off[0].severity === "info" && off[0].count === 9, JSON.stringify(off));
  must(buildAlerts({ today: "x", providerEnabled: false, scheduledNotifications: 0 }).length === 0, "désactivé sans file d'attente : rien");
});

await t("buildAlerts : programmation en retard — somme et détail par module (modules absents = 0)", async () => {
  const a = buildAlerts({ today: "x", providerEnabled: true, schedulerLate: { news: 2, sermons: 1 } });
  must(a.length === 1 && a[0].code === "SCHEDULER_LATE" && a[0].count === 3, JSON.stringify(a));
  must(a[0].data.events === 0 && a[0].data.news === 2 && a[0].data.dailyMessages === 0 && a[0].data.sermons === 1, JSON.stringify(a[0].data));
});

await t("buildAlerts : tri par gravité (critical, warning, info) ; une alerte n'a pas de texte, seulement un code", async () => {
  const a = buildAlerts({
    today: "2026-11-24", missingDailyDates: ["2026-11-24"], failedNotifications: 1, providerEnabled: false,
    scheduledNotifications: 3, schedulerLate: { events: 1 }, stuckUploads: 4,
  });
  const order = a.map((x) => SEVERITIES.indexOf(x.severity));
  must(order.every((v, i) => i === 0 || order[i - 1] <= v), "tri : " + a.map((x) => x.severity).join());
  must(a[0].code === "DAILY_MESSAGES_MISSING" && a[a.length - 1].severity === "info", a.map((x) => x.code).join());
  must(a.length === 5 && a.every((x) => Object.keys(x).every((k) => ["code", "severity", "count", "data"].includes(k))), "forme des alertes");
  must(a.find((x) => x.code === "STORAGE_UPLOADS_STUCK").count === 4, "envois bloqués");
});

console.log(res.join("\n"));
