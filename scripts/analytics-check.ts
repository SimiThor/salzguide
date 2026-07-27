// Prüft die Einordnungs- und Kalender-Logik der Reichweitenmessung. Aufruf:
//   npm run analytics:check
//
// Es importiert die ECHTEN Funktionen aus src/lib (über den Alias-Hook), baut also nichts
// nach. Ein Nachbau würde genau die Abweichung verstecken, die er finden soll.
//
// Geprüft wird das, was ohne Datenbank prüfbar ist und wo ein Fehler still bleibt:
//
//   1. JEDE echte Route der App bekommt eine Einordnung, und zwar die erwartete. Findet das
//      Skript eine Route, die niemand hier eingetragen hat, meckert es — so bleibt „other"
//      klein und erklärbar, statt zum zweitgrössten Eintrag der Auswertung zu werden.
//   2. Maschinen werden aussortiert, Menschen nicht.
//   3. Wiener Mitternacht ist wirklich Mitternacht, auch an den zwei Umstellungstagen.
//   4. Die Balken der Zeitreihe sind lückenlos und passen zu Postgres' date_trunc.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyPath, classifyLocalePath, isBotUserAgent } from "../src/lib/analytics.ts";
import { KIND_LABELS, LEGACY_KINDS } from "../src/lib/analytics-labels.ts";
import { viennaDayStart, bucketRange, bucketStart, dayCount, shiftDay } from "../src/lib/vienna-day.ts";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, got: unknown, want: unknown) => {
  failed++;
  console.log(`  FEHLT ${name}\n        erwartet: ${JSON.stringify(want)}\n        bekommen: ${JSON.stringify(got)}`);
};
const eq = (name: string, got: unknown, want: unknown) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(name) : bad(name, got, want);

// ── 1. Pfad-Einordnung ──────────────────────────────────────────────────────
console.log("\n1. Pfad-Einordnung");

const PATHS: [string, { kind: string; target: string | null } | null][] = [
  ["/", { kind: "landing", target: null }],
  ["/de", { kind: "landing", target: null }],
  ["/ko/", { kind: "landing", target: null }],
  ["/de/explore", { kind: "explore", target: null }],
  ["/zh/explore?season=winter", { kind: "explore", target: null }],
  ["/de/spot/gaisberg", { kind: "spot", target: "gaisberg" }],
  ["/en/spot/hallstaetter-see/", { kind: "spot", target: "hallstaetter-see" }],
  ["/de/spot/gaisberg?ref=x#karte", { kind: "spot", target: "gaisberg" }],
  ["/de/events", { kind: "events", target: null }],
  ["/de/wasser", { kind: "water", target: null }],
  ["/de/gespeichert", { kind: "saved", target: null }],
  ["/de/profil", { kind: "profile", target: null }],
  ["/de/profil/daten", { kind: "profile", target: null }],
  // Die Bereiche, die bis 07/2026 allesamt als "other" in einem Topf lagen:
  ["/de/touren", { kind: "tours", target: null }],
  ["/de/touren/altstadt-runde", { kind: "tour", target: "altstadt-runde" }],
  ["/de/touren/bauen", { kind: "tours", target: null }],
  ["/de/touren/meine/1a2b", { kind: "tours", target: null }], // private Tour: kein Kürzel
  ["/de/pro", { kind: "pro", target: null }],
  ["/de/ueber-uns", { kind: "about", target: null }],
  ["/de/support", { kind: "support", target: null }],
  ["/de/rechtliches/datenschutz", { kind: "legal", target: null }],
  ["/de/demo", { kind: "demo", target: null }],
  // Betreiber-eigene Nutzung wird gar nicht gezählt:
  ["/de/admin", null],
  ["/de/admin/settings/analytics", null],
];
for (const [path, want] of PATHS) eq(path, classifyPath(path), want);

// Sprach-Präfix: alle neun, nicht nur de/en.
const LOCALES = ["de", "en", "it", "nl", "ko", "fr", "zh", "es", "pt"];
const missedLocale = LOCALES.filter((l) => classifyLocalePath(`/${l}/events`) !== l);
eq("alle neun Sprach-Präfixe erkannt", missedLocale, []);
eq("kein falsches Präfix", classifyLocalePath("/deutschland/x"), null);

// ── 1b. Keine echte Route darf unbemerkt in "other" fallen ──────────────────
console.log("\n1b. Abgleich mit den echten Routen der App");
const APP = "src/app/[locale]";
const routes: string[] = [];
(function walk(dir: string, url: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("(") || entry.startsWith("_")) walk(full, url);
      else walk(full, `${url}/${entry.startsWith("[") ? "musterwert" : entry}`);
    } else if (entry === "page.tsx") {
      routes.push(url || "/");
    }
  }
})(APP, "");

const unclassified = routes.filter((r) => {
  if (r.startsWith("/admin")) return false; // absichtlich nicht gezählt
  return classifyPath(r)?.kind === "other";
});
if (unclassified.length === 0) {
  ok(`alle ${routes.length} Routen eingeordnet, keine in "other"`);
} else {
  bad("Routen ohne eigene Einordnung", unclassified, []);
  console.log('        -> in classifyPath() (src/lib/analytics.ts) ergänzen, sonst wächst "other".');
}

// Jede Seitenart, die entstehen KANN, braucht auch einen Namen fürs Dashboard. Sonst steht
// dort der Rohwert („tours" statt „Touren (Liste)"): kein Absturz, keine Logzeile, sieht nur
// nach Programmierfehler aus. Die Prüfung geht von den ECHTEN Routen aus, nicht von einer
// Liste, die jemand hier pflegen müsste.
const kinds = new Set(
  [
    ...routes,
    "/", "/spot/x", "/touren/x",
    // Eine Adresse, die es in der App NICHT gibt. Sie gehört dazu: Genau so entsteht
    // „other" im Betrieb (alte Links der WordPress-Seite, Tippfehler, Scanner), und ohne
    // sie hielte die Karteileichen-Prüfung unten die Beschriftung für überflüssig.
    "/wp-content/uploads/alt.jpg",
  ]
    .map((r) => classifyPath(r)?.kind)
    .filter((k): k is string => Boolean(k)),
);
eq(
  `alle ${kinds.size} Seitenarten haben eine deutsche Beschriftung`,
  [...kinds].filter((k) => !KIND_LABELS[k]),
  [],
);
// Und die Gegenrichtung. Reichweitendaten bleiben 14 Monate liegen, in der Tabelle stehen
// also auch Kennungen, die der heutige Code nicht mehr vergibt. Genau daran ist die erste
// Fassung vorbeigelaufen: `home` (46 Zeilen, in Altdaten der KARTEN-Aufruf) hatte keine
// Beschriftung und wäre im Dashboard als „home" erschienen — was jeder als Startseite liest.
// Gefunden hat es nicht dieses Skript, sondern ein Blick in die echten Daten nach dem
// Einspielen. Jetzt fängt es das Skript.
eq(
  `alle ${Object.keys(LEGACY_KINDS).length} Altdaten-Kennungen sind beschriftet`,
  Object.keys(LEGACY_KINDS).filter((k) => !KIND_LABELS[k]),
  [],
);
eq(
  "keine Beschriftung ohne Seitenart (Karteileiche)",
  Object.keys(KIND_LABELS).filter((k) => !kinds.has(k) && !LEGACY_KINDS[k]),
  [],
);

// ── 2. Maschinen aussortieren ───────────────────────────────────────────────
console.log("\n2. Bot-Erkennung");
const HUMAN = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
  // Die zwei, an denen eine zu gierige Liste scheitert: beides echte Browser.
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 DuckDuckGo/7 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.6.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.14.107",
  "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
];
const MACHINE = [
  "Mozilla/5.0 (Linux; Android 6.0.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1)",
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0",
  "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  "Mozilla/5.0 (compatible; Baiduspider-render/2.0)",
  "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/137.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36 Chrome-Lighthouse",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "curl/8.7.1",
  "python-requests/2.32.3",
  "Go-http-client/2.0",
  "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
  "", // kein User-Agent = kein Browser
];
eq("echte Browser durchgelassen", HUMAN.filter(isBotUserAgent), []);
eq("Maschinen aussortiert", MACHINE.filter((u) => !isBotUserAgent(u)), []);

// ── 3. Wiener Mitternacht ───────────────────────────────────────────────────
console.log("\n3. Wiener Kalendertage");
const localOf = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const wrongMidnight: string[] = [];
for (let i = 0; i < 800; i++) {
  const day = shiftDay("2026-01-01", i);
  const s = localOf.format(viennaDayStart(day));
  if (!s.startsWith(day) || !s.includes("00:00")) wrongMidnight.push(`${day} -> ${s}`);
}
eq("800 Tage: Mitternacht ist Mitternacht (inkl. beider Umstellungen)", wrongMidnight, []);
eq("Sommerzeit-Beginn", viennaDayStart("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z");
eq("Winterzeit-Beginn", viennaDayStart("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z");

// ── 4. Balken der Zeitreihe ─────────────────────────────────────────────────
console.log("\n4. Balken der Zeitreihe");
eq("Woche beginnt am Montag (wie date_trunc)", bucketStart("2026-07-15", "week"), "2026-07-13");
eq("Monat beginnt am Ersten", bucketStart("2026-07-15", "month"), "2026-07-01");
eq("Tagesbalken lückenlos über den Monatswechsel",
  bucketRange("2026-02-26", "2026-03-02", "day"),
  ["2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
eq("Monatsbalken über den Jahreswechsel",
  bucketRange("2025-11-15", "2026-02-03", "month"),
  ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
eq("30 Tage sind 30 Balken", bucketRange(shiftDay("2026-07-27", -29), "2026-07-27", "day").length, 30);
eq("Tageszählung schliesst beide Enden ein", dayCount("2026-07-01", "2026-07-31"), 31);

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(failed ? 1 : 0);
