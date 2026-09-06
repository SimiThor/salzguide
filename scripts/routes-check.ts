// Prüft, dass die 404-Erlaubnisliste (src/lib/public-routes.ts) die ECHTEN Routen der
// App vollständig abdeckt. Aufruf:
//   npm run routes:check
//
// Es importiert die ECHTE isPublicRoute() über den Alias-Hook, baut also nichts nach
// (gleiche Regel wie analytics-check: ein Nachbau prüft seinen Nachbau).
//
// Warum es das Skript braucht: Der Proxy schickt jeden Pfad, den die Liste nicht kennt,
// auf den 404-Handler. Eine Route, die beim Anlegen vergessen wurde, fällt zwar im Dev
// beim ersten Öffnen auf (In-App-404) – aber nur, wenn ein Mensch sie öffnet. Routen,
// die nur Maschinen abrufen (Route Handler, künftige opengraph-image-Dateien), würden
// still in Produktion 404 liefern. Dieses Skript macht das Vergessen zum harten Fehler.
//
// Geprüft wird außerdem, was sonst nirgends geprüft würde:
//   2. Der zweite matcher-Eintrag in src/proxy.ts (muss ein statisches Literal sein)
//      nennt exakt die Sprachliste aus i18n/locales.ts.
//   3. Kein public/-Ordner heißt wie eine Sprache: /de/foo.png liefe sonst durch den
//      Proxy in die 404 statt zur statischen Datei.
//   4. Der Logbuch-Link in den Alarm-Mails (lib/ops-mail.ts) zeigt auf eine Route, die
//      es gibt. Er stand seit dem ersten Tag auf /de/admin/system — eine Seite, die nie
//      existierte — und kein Werkzeug konnte es merken, weil Links in Mails kein tsc prüft.
//   5. Dasselbe für den Knopf aus der Freigabe-Mail der Wochenrecherche: Ziel und Weiche
//      (lib/event-review-mail.ts, app/api/admin/events-review).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_CODES } from "../src/i18n/locales.ts";
import { isPublicRoute } from "../src/lib/public-routes.ts";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};

// ── 1. Jede echte Route unter src/app/[locale] muss die Erlaubnisliste passieren ────
const APP = join(process.cwd(), "src", "app", "[locale]");
// Dateien, die eine eigene URL erzeugen (heute page/route; die Bild-Konventionen
// stehen schon hier, damit ein künftiges opengraph-image nicht still durchfällt).
const ROUTE_FILES =
  /^(page\.tsx|route\.ts|opengraph-image\.\w+|twitter-image\.\w+|icon\.\w+|apple-icon\.\w+)$/;

function collect(dir: string, urlPath: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "[...rest]") continue; // der Catch-all IST das Sicherheitsnetz
      // [param] -> Probewert: die Liste prüft Pfad-FORMEN, nicht Existenz.
      const segment = entry.startsWith("[") ? "probe" : entry;
      collect(full, `${urlPath}/${segment}`, out);
    } else if (ROUTE_FILES.test(entry)) {
      const suffix = /^(page\.tsx|route\.ts)$/.test(entry) ? "" : `/${entry.replace(/\..+$/, "")}`;
      out.push((urlPath || "/") + suffix);
    }
  }
}

const routes: string[] = [];
collect(APP, "", routes);
if (routes.length < 40) {
  bad("Routen-Inventar", `nur ${routes.length} Routen gefunden – stimmt der Pfad ${APP}?`);
}
for (const route of [...new Set(routes)].sort()) {
  if (isPublicRoute(route)) ok(`Route ${route}`);
  else bad(`Route ${route}`, "fehlt in PUBLIC_ROUTES (src/lib/public-routes.ts)");
}

// ── 2. matcher-Literal in src/proxy.ts == Sprachliste ───────────────────────────────
const proxySource = readFileSync(join(process.cwd(), "src", "proxy.ts"), "utf8");
const matcherLiteral = proxySource.match(/"\/\(([a-z|]+)\)\/:path\*"/);
if (!matcherLiteral) {
  bad("proxy.ts matcher", "zweiter matcher-Eintrag '/(<sprachen>)/:path*' nicht gefunden");
} else {
  const inMatcher = matcherLiteral[1].split("|").sort().join(",");
  const inConfig = [...LOCALE_CODES].sort().join(",");
  if (inMatcher === inConfig) ok(`proxy.ts matcher nennt alle ${LOCALE_CODES.length} Sprachen`);
  else
    bad(
      "proxy.ts matcher",
      `matcher [${inMatcher}] != locales.ts [${inConfig}] – neue Sprache auch im matcher ergänzen`,
    );
}

// ── 3. Kein public/-Ordner mit Sprach-Namen ────────────────────────────────────────
const publicEntries = readdirSync(join(process.cwd(), "public"));
const collisions = publicEntries.filter((e) => (LOCALE_CODES as readonly string[]).includes(e));
if (collisions.length === 0) ok("public/ hat keinen Ordner, der wie eine Sprache heißt");
else
  bad(
    "public/-Kollision",
    `public/${collisions.join(", public/")} würde vom Proxy als 404 abgefangen statt ausgeliefert`,
  );

// ── 4. Jeder Seiten-Link in den Alarm-Mails zeigt auf eine echte Route ──────────────
// matchAll, nicht match: Kommt je ein zweiter Link in die Mail, wäre der sonst blind.
const mailSource = readFileSync(join(process.cwd(), "src", "lib", "ops-mail.ts"), "utf8");
const mailLinks = [...mailSource.matchAll(/\$\{siteUrl\(\)\}\/de(\/[^`]*)`/g)];
if (mailLinks.length === 0) {
  bad("ops-mail.ts Logbuch-Link", "Muster `${siteUrl()}/de/…` nicht gefunden – Link umgebaut? Dann diese Prüfung mitziehen.");
} else {
  for (const m of mailLinks) {
    if (isPublicRoute(m[1])) ok(`ops-mail.ts Link ${m[1]} ist eine echte Routen-Form`);
    else
      bad(
        `ops-mail.ts Link ${m[1]}`,
        "zeigt auf keine bekannte Routen-Form (public-routes.ts) – jeder Klick aus einer Alarm-Mail liefe in die 404",
      );
  }
}

// ── 5. Das Ziel des Mail-Knopfs „Events prüfen" ist eine echte Route ───────────────
// Der Knopf in der Freigabe-Mail zeigt auf /api/admin/events-review, und die Route leitet
// dorthin weiter. Ein Tippfehler oder eine umbenannte Admin-Seite fiele sonst erst auf,
// wenn jemand montags in eine 404 klickt (siehe Punkt 4, derselbe Fehler in neu).
const reviewSource = readFileSync(
  join(process.cwd(), "src", "lib", "event-review-mail.ts"),
  "utf8",
);
const reviewTarget = reviewSource.match(/EVENTS_REVIEW_TARGET = "([^"]+)"/);
const reviewEntry = reviewSource.match(/EVENTS_REVIEW_ENTRY = "([^"]+)"/);
if (!reviewTarget || !reviewEntry) {
  bad(
    "event-review-mail.ts",
    "EVENTS_REVIEW_TARGET/-ENTRY nicht gefunden – umbenannt? Dann diese Prüfung mitziehen.",
  );
} else {
  const path = reviewTarget[1].split("?")[0];
  if (isPublicRoute(path)) ok(`Freigabe-Mail führt auf ${reviewTarget[1]}`);
  else
    bad(
      `Freigabe-Mail Ziel ${path}`,
      "zeigt auf keine bekannte Routen-Form (public-routes.ts) – der Knopf aus der Mail liefe in die 404",
    );

  // Und die Weiche selbst muss es geben. Sie liegt unter /api und damit ausserhalb der
  // Erlaubnisliste (der Proxy fasst /api nicht an), also prüft nur die Datei ihre Existenz.
  const handler = join(process.cwd(), "src", "app", reviewEntry[1].slice(1), "route.ts");
  try {
    statSync(handler);
    ok(`Freigabe-Mail Weiche ${reviewEntry[1]} existiert`);
  } catch {
    bad(`Freigabe-Mail Weiche ${reviewEntry[1]}`, `es gibt keine Datei ${handler}`);
  }
}

console.log("");
if (failed > 0) {
  console.log(`routes:check: ${failed} Problem(e).`);
  process.exit(1);
}
console.log(`routes:check: sauber (${new Set(routes).size} Routen, matcher synchron, public/ frei).`);
