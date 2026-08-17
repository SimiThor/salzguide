// Korrigiert Zahlen IM TEXT, die der gemessenen Route widersprechen. Aufruf:
//   npm run wp:fix-numbers          zeigt, was passieren würde
//   npm run wp:fix-numbers -- --go  schreibt
//
// GEFUNDEN MIT `npm run wp:audit`. Alle drei Fälle haben dieselbe Ursache: Der Entwurf
// übernahm die Kilometerangabe der alten WordPress-Seite, während auf der Karte die
// gesnappte Linie liegt. Aus DIESER Linie rechnet `geo.ts` auch die Dauer, und die Dauer im
// Text stimmt jeweils. Nur die Länge daneben stammt noch aus der alten Quelle.
//
// WARUM DIE GEMESSENE LINIE GEWINNT: Sie ist das, was der Besucher auf der Karte sieht und
// abgeht. Eine Länge im Text, die nicht zur gezeichneten Route passt, ist nicht bloss
// ungenau, sie widerspricht der Karte auf derselben Bildschirmseite.
//
// WARUM DAS SKRIPT AUCH DIE ÜBERSETZUNGEN ANFASST: Die falsche Zahl steht in allen neun
// Sprachen. Nur Deutsch zu ändern hiesse, den Widerspruch in zwölf Sprachen stehen zu lassen
// UND alle acht auf „veraltet" zu setzen, weil sich der Quell-Hash ändert. Also wird die
// Zahl überall ersetzt und die Aktualitäts-Marke neu gesetzt.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { hashSpotTexts } from "../../src/lib/spot-hash.ts";
import { LOCALE_CODES } from "../../src/i18n/locales.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** alt/neu als Zahl, damit beide Schreibweisen (3,7 und 3.7) daraus abgeleitet werden. */
type Fix = { slug: string; alt: string; neu: string; warum: string };

const FIXES: Fix[] = [
  {
    slug: "falkensteinwand",
    alt: "3,7",
    neu: "3",
    warum: "gemessen 3,0 km (hin und zurück); die Dauer 3 Std 50 min im Text passt dazu",
  },
  {
    slug: "gamskogerl",
    alt: "5,8",
    neu: "5,2",
    warum: "gemessen 5,2 km; Höhenmeter (690) und Dauer im Text stimmen bereits",
  },
  {
    slug: "tappenkar-wasserfall",
    alt: "5,2",
    neu: "4,7",
    warum: "gemessen 4,7 km; Dauer 4 Std 20 min im Text stimmt bereits",
  },
  // ---- Ab hier: gefunden beim Fakten-Nachschlagen, nicht durch Nachrechnen ----
  {
    slug: "stubnerkogel",
    alt: "2.300",
    neu: "2.250",
    warum:
      "Der Gipfel ist 2.246 m hoch, die Brücke steht oben. Sie kann nicht 54 m über ihrem " +
      "eigenen Gipfel hängen. Unsere eigenen Texte nannten für dieselbe Bergstation vier " +
      "Höhen: 2.300 (hier), 2.251 (stubnerkogelbahn), 2.230 (gipfelrestaurant) und knapp " +
      "über 2.200 (glocknerblick). Nur diese eine fällt heraus.",
  },
  {
    slug: "zwolferhorn",
    alt: "1.521",
    neu: "1.522",
    warum: "offiziell 1.522 m (Wikipedia, SalzburgerLand, TVB Wolfgangsee); für 1.521 gibt es keine Quelle",
  },
  {
    slug: "schuhflickersee",
    alt: "2.100",
    neu: "2.040",
    warum:
      "Der amtliche Höhendienst des Bundesamts für Eich- und Vermessungswesen gibt für die " +
      "Seemitte 2.041,6 m; dieselbe Abfrage trifft am Gipfel Schuhflicker die amtlichen " +
      "2.214 m, ist also kalibriert. Salzburgwiki und das Tourenportal des TVB Großarltal " +
      "nennen 2.042 m, Wikidata 2.041 m. Unser eigenes Höhenprofil stützt es von der anderen " +
      "Seite: Der Wendepunkt der Route liegt bei 2.080 m und der höchste Punkt der Tour (die " +
      "Scharte) bei 2.111 m, der See also darunter. Die 2.100 stammen aus dem Fliesstext von " +
      "grossarltal.info, den Blogs abgeschrieben haben; das Tourenportal desselben Verbands " +
      "widerspricht ihm. Gerundet auf 2.040, weil die Formel für eine Seehöhe keine " +
      "Nachkommastelle hergibt.",
  },
];

const SPALTEN = [
  "title",
  "short_desc",
  "general",
  "insider_tip",
  "section_a",
  "section_b",
  "location_text",
] as const;

/**
 * Dieselbe Zahl in allen Schreibweisen, die in den dreizehn Sprachen vorkommen, jeweils mit
 * ihrem Ersatz. Zwei Fälle, die man auseinanderhalten muss:
 *   Dezimalzahl  „3,7"   -> „3,7" (de/it/nl/fr/es/pt) und „3.7" (en/ko/zh)
 *   Tausender    „2.300" -> „2.300", „2,300", „2 300" und „2300"
 * Erkannt am Rest hinter dem Trennzeichen: drei Ziffern heisst Tausender.
 */
function formen(alt: string, neu: string): [string, string][] {
  const trenner = /[.,]/.exec(alt);
  const tausender = trenner ? /[.,]\d{3}\b/.test(alt) : false;
  if (!trenner) return [[alt, neu]];
  if (!tausender) return [
    [alt, neu],
    [alt.replace(",", "."), neu.replace(",", ".")],
  ];
  const roh = (s: string) => s.replace(/[.,\s]/g, "");
  const [a, n] = [roh(alt), roh(neu)];
  const mit = (s: string, z: string) => s.slice(0, s.length - 3) + z + s.slice(s.length - 3);
  return [
    [mit(a, "."), mit(n, ".")],
    [mit(a, ","), mit(n, ",")],
    [mit(a, " "), mit(n, " ")],
    [a, n],
  ];
}

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots, error } = await db.from("spots").select("id, slug");
  if (error) throw error;

  let ersetzt = 0;
  for (const fix of FIXES) {
    const spot = spots!.find((s) => s.slug === fix.slug);
    if (!spot) throw new Error(`Spot ${fix.slug} gibt es nicht`);
    const { data: rows, error: e2 } = await db
      .from("spot_translations")
      .select(`spot_id, lang, ${SPALTEN.join(", ")}`)
      .eq("spot_id", spot.id);
    if (e2) throw e2;

    // Ohne Einheit: die Liste enthält Kilometer UND Höhenmeter, ein festes „km" hätte
    // die Höhenkorrekturen im Protokoll als Längen ausgegeben.
    console.log(`\n=== ${fix.slug}: ${fix.alt} -> ${fix.neu}`);
    console.log(`    ${fix.warum}`);

    const neueDeTexte: Record<string, string> = {};
    for (const r of rows as unknown as Record<string, string | null>[]) {
      const lang = r.lang as string;
      const patch: Record<string, string> = {};
      for (const sp of SPALTEN) {
        const wert = r[sp];
        if (!wert) continue;
        let neu = wert;
        for (const [suche, ersatz] of formen(fix.alt, fix.neu)) {
          // Ziffer davor und danach ausschliessen: sonst würde in „5,25" die „5,2" und in
          // „12.300" die „2.300" ersetzt.
          neu = neu.replace(new RegExp(`(?<![\\d])${suche.replace(/\./g, "\\.")}(?![\\d])`, "g"), ersatz);
        }
        if (neu !== wert) patch[sp] = neu;
      }
      if (lang === "de") for (const sp of SPALTEN) neueDeTexte[sp] = patch[sp] ?? r[sp] ?? "";
      if (!Object.keys(patch).length) {
        console.log(`    ${lang.padEnd(3)} keine Fundstelle`);
        continue;
      }
      ersetzt++;
      console.log(`    ${lang.padEnd(3)} ${Object.keys(patch).join(", ")}`);
      if (go) {
        const { error: e3 } = await db
          .from("spot_translations")
          .update(patch)
          .eq("spot_id", spot.id)
          .eq("lang", lang);
        if (e3) throw e3;
      }
    }

    if (!go) continue;

    // Der deutsche Text hat sich geändert -> neue Aktualitäts-Marke für ALLE Sprachen,
    // sonst gelten die Übersetzungen als veraltet, obwohl sie mitkorrigiert wurden.
    const deHash = hashSpotTexts({
      title: neueDeTexte.title,
      shortDesc: neueDeTexte.short_desc,
      general: neueDeTexte.general,
      insiderTip: neueDeTexte.insider_tip,
      sectionA: neueDeTexte.section_a,
      sectionB: neueDeTexte.section_b,
      locationText: neueDeTexte.location_text,
    });
    const { error: e4 } = await db
      .from("spot_translations")
      .update({ source_hash: deHash })
      .eq("spot_id", spot.id)
      .in("lang", LOCALE_CODES as string[]);
    if (e4) throw e4;

    // Entwurf und Übersetzungs-Ablage mitziehen, sonst holt der nächste Import bzw. der
    // nächste `wp:translate --go` die alte Zahl zurück.
    for (const ordner of [join(".wp-cache", "drafts"), join(".wp-cache", "i18n")]) {
      const pfad = join(ordner, `${fix.slug}.json`);
      if (!existsSync(pfad)) continue;
      let roh = readFileSync(pfad, "utf8");
      for (const [suche, ersatz] of formen(fix.alt, fix.neu))
        roh = roh.replace(
          new RegExp(`(?<![\\d])${suche.replace(/\./g, "\\.")}(?![\\d])`, "g"),
          ersatz,
        );
      writeFileSync(pfad, roh);
      console.log(`    ${pfad} nachgezogen`);
    }
  }

  console.log(`\n${ersetzt} Sprachzeilen betroffen.`);
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:fix-numbers -- --go");
    return;
  }
  console.log("Danach: npm run wp:audit  (sollte keine Widersprüche mehr melden)");
}

main();
