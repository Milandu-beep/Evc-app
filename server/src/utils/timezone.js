// Calculs de jours « locaux » (fuseau de l'église, Africa/Kinshasa = UTC+1 sans heure d'été).
// Les dates sont toujours stockées en UTC ; ces fonctions ne servent qu'à décider où un jour commence et finit.

function parts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

// Décalage (ms) du fuseau par rapport à UTC à cet instant : positif à l'est de Greenwich.
function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

// Instant UTC correspondant à y-m-d 00:00:00 dans le fuseau.
function localMidnight(y, m, d, timeZone) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

export function startOfLocalDay(date, timeZone) {
  const { y, m, d } = parts(date, timeZone);
  return localMidnight(y, m, d, timeZone);
}

// Dernière milliseconde du jour local (23:59:59.999).
export function endOfLocalDay(date, timeZone) {
  return new Date(startOfLocalDay(date, timeZone).getTime() + 24 * 3600 * 1000 - 1);
}

// Début du mois local « AAAA-MM » ; offset = nombre de mois à ajouter (1 = mois suivant).
export function startOfLocalMonth(year, month, timeZone, offset = 0) {
  const total = year * 12 + (month - 1) + offset;
  return localMidnight(Math.floor(total / 12), (total % 12) + 1, 1, timeZone);
}

export const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Date locale « AAAA-MM-JJ » d'un instant (ex. le « jour courant » de l'église).
export function localDateString(date, timeZone) {
  const { y, m, d } = parts(date, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// « AAAA-MM-JJ » -> Date à minuit UTC : c'est ce que Prisma attend pour une colonne @db.Date.
export const dateOnlyToUtc = (str) => new Date(`${str}T00:00:00.000Z`);

// Fin (23:59:59.999) du jour local « AAAA-MM-JJ ».
export function endOfLocalDateString(str, timeZone) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(localMidnight(y, m, d, timeZone).getTime() + 24 * 3600 * 1000 - 1);
}
