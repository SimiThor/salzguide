// Prüft die Weiterleitungen von der alten WordPress-Seite. Aufruf:
//   npm run redirects:check                  Regeln + Bestand der alten Seite
//   npm run redirects:check -- --sitemap     Adressliste frisch von der alten Seite holen
//   npm run redirects:check -- --live https://salzguide.vercel.app   wirklich abrufen
//
// WARUM ES DIESE PRÜFUNG GIBT: Eine falsche Weiterleitung meldet sich nicht. Sie liefert
// brav eine Antwort, nur die falsche, und man merkt es Wochen später an einer Kurve in der
// Search Console. Die drei Fehler, die hier gefunden werden sollen, sehen alle harmlos aus:
// eine Regel, die von einer allgemeineren verdeckt wird und nie greift; ein Ziel, das es
// gar nicht gibt (301 auf eine 404 ist schlechter als gar keine Weiterleitung); und eine
// alte Adresse, an die niemand gedacht hat.
//
// DIE REGELN WERDEN NICHT NACHGEBAUT, SONDERN IMPORTIERT — und ausgewertet mit dem
// path-to-regexp, das in Next selbst steckt. Ein eigener Muster-Abgleich wäre eine zweite
// Auslegung derselben Zeichenkette, und die interessante Frage ist ja gerade, was NEXT
// daraus macht, nicht was ich meine.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { legacyRedirects } from "../src/lib/legacy-redirects.ts";
import { LOCALE_CODES } from "../src/i18n/locales.ts";

// @ts-expect-error - Nexts mitgeliefertes path-to-regexp hat keine Typdeklaration.
import ptrModule from "next/dist/compiled/path-to-regexp/index.js";
const ptr = ptrModule as {
  match: (p: string, o?: object) => (path: string) => false | { params: Record<string, string> };
  compile: (p: string) => (params: Record<string, string>) => string;
};

const OLD_BASE = "https://www.salzguide.com";
const URL_CACHE = join(".wp-cache", "old-urls.json");
const APP_DIR = join("src", "app", "[locale]");

const args = process.argv.slice(2);
const wantSitemap = args.includes("--sitemap");
const liveBase = args[args.indexOf("--live") + 1]?.startsWith("http")
  ? args[args.indexOf("--live") + 1]
  : null;

// Alte Adressen, für die eine 404 die RICHTIGE Antwort ist. Jede mit Grund, sonst wächst
// die Liste still zu einer Ausrede für alles, was gerade nicht passt.
const ABSICHTLICH_404: { muster: RegExp; grund: string }[] = [
  { muster: /^\/elementor-hf\//, grund: "Kopf-/Fusszeilen-Vorlage, nie eine echte Seite" },
  { muster: /^\/en\/elementor-hf\//, grund: "dasselbe auf Englisch" },
  { muster: /-template\/?$/, grund: "Vorlage-Beitrag, steht in keiner Sitemap" },
  { muster: /^\/alle\/video-maker-test\/?$/, grund: "Test-Beitrag" },
  { muster: /^\/feed\/?$/, grund: "RSS-Feed gehört nicht auf eine HTML-Seite geleitet" },
];

// Alte Adressen, die auf der neuen Seite GENAUSO heissen. Sie brauchen keine Regel, und
// eine Regel wäre hier sogar eine Schleife.
const UNVERAENDERT = new Set(["/", "/en/explore"]);

const ohneSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/**
 * Alle Adressen der alten Seite, aus ihren Sitemaps — MIT dem Schrägstrich am Ende.
 *
 * Der Schrägstrich ist kein Schönheitsfehler, er ist der Unterschied zwischen Prüfung und
 * Selbstbetrug: WordPress hängt ihn an jede Adresse, also steht genau diese Form in Googles
 * Index und in fremden Verlinkungen. Next normalisiert ihn mit einem EIGENEN 308, bevor
 * unsere Regeln überhaupt drankommen. Wer hier ohne Schrägstrich prüft, misst eine Kette,
 * die in Wirklichkeit ein Glied länger ist, und merkt nie, dass jede alte Adresse einen
 * Zwischensprung mehr macht als gedacht.
 */
async function alteAdressen(): Promise<string[]> {
  if (!wantSitemap && existsSync(URL_CACHE)) {
    return JSON.parse(readFileSync(URL_CACHE, "utf8")) as string[];
  }
  const index = await (await fetch(`${OLD_BASE}/sitemap_index.xml`)).text();
  const teile = [...index.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  const urls = new Set<string>();
  for (const t of teile) {
    const xml = await (await fetch(t)).text();
    for (const m of xml.matchAll(/<url>[\s\S]*?<loc>(.*?)<\/loc>/g)) {
      urls.add(new URL(m[1]).pathname);
    }
  }
  // /impressum/ steht in keiner Sitemap, antwortet aber mit 200 — Pflichtseiten stehen oft
  // auf noindex. Wer sich hier auf die Sitemap allein verlässt, übersieht genau die.
  urls.add("/impressum/");
  const liste = [...urls].sort();
  writeFileSync(URL_CACHE, JSON.stringify(liste, null, 1));
  return liste;
}

/** Die echten Routen der App, aus dem Dateibaum unter src/app/[locale]. */
function appRouten(): string[] {
  const routen: string[] = [];
  const lauf = (dir: string, pfad: string) => {
    for (const eintrag of readdirSync(dir)) {
      const voll = join(dir, eintrag);
      if (statSync(voll).isDirectory()) {
        // Routen-Gruppen wie (render) tauchen im Pfad nicht auf.
        lauf(voll, eintrag.startsWith("(") ? pfad : `${pfad}/${eintrag}`);
      } else if (eintrag === "page.tsx") {
        routen.push(pfad || "/");
      }
    }
  };
  lauf(APP_DIR, "");
  return routen;
}

/** Passt ein Zielpfad (ohne Sprache) auf eine echte Route? [slug] passt auf alles. */
function routeExistiert(pfad: string, routen: string[]): boolean {
  const teile = pfad.split("/").filter(Boolean);
  return routen.some((r) => {
    const rt = r.split("/").filter(Boolean);
    return (
      rt.length === teile.length &&
      rt.every((s, i) => (s.startsWith("[") ? true : s === teile[i]))
    );
  });
}

/** Welche Regel greift für diesen Pfad, und wohin führt sie? (Erster Treffer gewinnt.) */
function anwenden(pfad: string) {
  for (const [i, r] of legacyRedirects.entries()) {
    const treffer = ptr.match(r.source, { decode: decodeURIComponent })(pfad);
    if (treffer) {
      return { index: i, regel: r, ziel: ptr.compile(r.destination)(treffer.params) };
    }
  }
  return null;
}

async function main() {
  const routen = appRouten();
  let fehler = 0;
  const meld = (s: string) => {
    console.log(s);
    fehler++;
  };

  // ── 1. Regeln gegen sich selbst ──────────────────────────────────────────
  const gesehen = new Map<string, number>();
  for (const [i, r] of legacyRedirects.entries()) {
    if (gesehen.has(r.source)) meld(`DOPPELT   ${r.source} (Zeile ${gesehen.get(r.source)} und ${i})`);
    gesehen.set(r.source, i);

    // Verdeckt eine FRÜHERE Regel diese hier? Dann greift sie nie. Geprüft wird mit einem
    // Beispielpfad aus der Regel selbst: Parameter durch einen Platzhalter ersetzt.
    const beispiel = r.source.replace(/:(\w+)\([^)]*\)/g, (_m, n) => {
      const alternativen = /\(([^)]*)\)/.exec(r.source.slice(r.source.indexOf(`:${n}(`)));
      return alternativen ? alternativen[1].split("|")[0] : "x";
    }).replace(/:(\w+)/g, "beispiel");
    const wer = anwenden(beispiel);
    if (wer && wer.index < i)
      meld(`VERDECKT  ${r.source} greift nie, „${legacyRedirects[wer.index].source}" fängt „${beispiel}" vorher ab`);

    // ── 2. Zeigt das Ziel auf eine echte Route? ──────────────────────────
    const ziel = r.destination.replace(/:(\w+)/g, "platzhalter");
    const m = /^\/([a-z]{2})(\/.*)?$/.exec(ziel);
    if (!m || !LOCALE_CODES.includes(m[1])) {
      meld(`ZIEL      ${r.source} -> ${r.destination}: kein gültiges Sprach-Präfix`);
    } else if (!routeExistiert(m[2] ?? "/", routen)) {
      meld(`ZIEL      ${r.source} -> ${r.destination}: diese Route gibt es nicht`);
    }
  }

  // ── 3. Zeigt ein Ziel auf einen Spot, den es gibt? ────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await db.from("spots").select("slug, status");
    const live = new Set((data ?? []).filter((s) => s.status === "published").map((s) => s.slug));
    for (const r of legacyRedirects) {
      const m = /^\/[a-z]{2}\/spot\/([a-z0-9-]+)$/.exec(r.destination);
      if (m && !live.has(m[1]))
        meld(`SPOT      ${r.source} -> ${r.destination}: kein veröffentlichter Spot mit diesem Slug`);
    }
  } else {
    console.log("(Ohne Supabase-Env: die Spot-Ziele werden nicht gegen die Datenbank geprüft.)");
  }

  // ── 4. Der Bestand der alten Seite ───────────────────────────────────────
  const alt = await alteAdressen();
  const offen: string[] = [];
  const abgedeckt: { von: string; nach: string }[] = [];
  for (const pfad of alt) {
    // Regeln gegen die NORMALISIERTE Form prüfen (so sieht Next den Pfad), abrufen aber
    // später die Originalform mit Schrägstrich (so kennt Google ihn).
    if (UNVERAENDERT.has(ohneSlash(pfad))) continue;
    const erlaubt = ABSICHTLICH_404.find((a) => a.muster.test(pfad));
    const treffer = anwenden(ohneSlash(pfad));
    if (treffer && erlaubt)
      meld(`UNERWARTET ${pfad} sollte 404 sein (${erlaubt.grund}), wird aber geleitet`);
    else if (!treffer && !erlaubt) offen.push(pfad);
    else if (treffer) abgedeckt.push({ von: pfad, nach: treffer.ziel });
  }
  for (const p of offen) meld(`OFFEN     ${p}: keine Regel, kein Grund für eine 404`);

  // Landet eine Weiterleitung auf einer Adresse, die selbst weitergeleitet wird? Das wäre
  // eine Kette, und Google mag höchstens drei Glieder.
  for (const a of abgedeckt) {
    const weiter = anwenden(a.nach);
    if (weiter) meld(`KETTE     ${a.von} -> ${a.nach} -> ${weiter.ziel}`);
  }

  console.log(
    `\n${legacyRedirects.length} Regeln · ${alt.length} alte Adressen · ${abgedeckt.length} weitergeleitet · ` +
      `${alt.length - abgedeckt.length - offen.length} bewusst nicht`,
  );

  // ── 5. Wirklich abrufen ──────────────────────────────────────────────────
  if (liveBase) {
    console.log(`\nRufe ${abgedeckt.length} alte Adressen gegen ${liveBase} ab …`);

    // Von Hand Sprung für Sprung, statt fetch folgen zu lassen: Die ANZAHL der Sprünge ist
    // die Zahl, die hier interessiert. Google folgt zwar bis zu zehn, rät aber zu höchstens
    // drei — und eine Kette wächst unbemerkt, weil am Ende ja weiter eine 200 steht.
    const MAX_SPRUENGE = 3;
    const verfolgen = async (start: string) => {
      let url = `${liveBase}${start}`;
      const kette: number[] = [];
      for (let i = 0; i <= 10; i++) {
        const res = await fetch(url, { redirect: "manual" });
        if (res.status < 300 || res.status >= 400) return { url, status: res.status, kette };
        kette.push(res.status);
        url = new URL(res.headers.get("location") ?? "", url).toString();
      }
      return { url, status: 0, kette };
    };

    let ok = 0;
    let maxKette = 0;
    for (const a of abgedeckt) {
      const { url, status, kette } = await verfolgen(a.von);
      const ziel = ohneSlash(new URL(url).pathname);
      maxKette = Math.max(maxKette, kette.length);
      // Das Sprach-Routing darf hinter unserer Weiterleitung noch einmal umleiten.
      // Entscheidend ist, wo der Abruf ANKOMMT, mit wie vielen Sprüngen, und dass es 200 ist.
      if (status !== 200) meld(`LIVE      ${a.von} -> ${ziel}: HTTP ${status}`);
      else if (ziel !== ohneSlash(a.nach)) meld(`LIVE      ${a.von}: erwartet ${a.nach}, gelandet ${ziel}`);
      else if (kette.length > MAX_SPRUENGE)
        meld(`KETTE     ${a.von}: ${kette.length} Sprünge (${kette.join("->")}), höchstens ${MAX_SPRUENGE}`);
      else ok++;
    }
    console.log(`${ok}/${abgedeckt.length} landen genau dort, wo sie sollen (längste Kette: ${maxKette}).`);

    // Und das Gegenstück: Was 404 sein SOLL, muss auch 404 antworten. Eine Weiterleitung,
    // die hier stillschweigend doch greift, wäre für Google ein Soft-404.
    for (const pfad of alt.filter((p) => ABSICHTLICH_404.some((a) => a.muster.test(p)))) {
      const { status } = await verfolgen(pfad);
      if (status !== 404) meld(`LIVE      ${pfad}: sollte 404 sein, ist ${status}`);
    }
  }

  console.log(fehler ? `\n${fehler} Beanstandungen.` : "\nWeiterleitungen sauber.");
  if (fehler) process.exitCode = 1;
}

main();
