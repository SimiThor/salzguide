// Legt die importierten Wanderlinien auf echte Wanderwege (unser Routendienst, BRouter mit
// Profil hiking-mountain, docs/42; bis 23.10.2026 openrouteservice foot-hiking) und
// vergleicht das Ergebnis mit den Dauer-Angaben der alten Seite.
// Aufruf:
//   npm run wp:routes                nur rechnen und berichten
//   npm run wp:routes -- --limit 5   Stichprobe
//
// ZWECK: Die alten Texte sind nicht unbedingt richtig. Eine an echte Wege gesnappte Linie
// plus die DAV-Gehzeit ergibt eine Zahl, die man verteidigen kann — und der Vergleich zeigt,
// wo die alte Angabe danebenlag.
//
// WAS SNAPPING NICHT KANN, und das ist hier der wichtigere Teil: Es richtet eine Linie am
// Weg aus. Es erfindet keine fehlende Strecke. Ein Teil der alten Linien ist nicht ungenau,
// sondern ein STUMMEL: Die Seisenbergklamm hat 16 Punkte im Abstand von zehn Metern, die
// ganze Linie passt in eine Box von 130 Metern, angegeben sind zwei Stunden. Da gibt der
// Dienst wieder 160 Meter zurück. Solche Routen brauchen Handarbeit, kein API.
//
// Das Ergebnis landet in .wp-cache/routes.json und im Report — es wird NICHTS geschrieben.
// Was am Ende in die Datenbank geht, entscheidet der Import.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { routeLengthKm, hikingTimeMinutes, isClosedRoute } from "../../src/lib/geo.ts";
import type { WpSource } from "./parse.ts";
import { ascentDescent, doubled, downsample } from "./route-math.ts";
import { routeSpotLine } from "../../src/lib/routing/snap-spot.ts";

if (!process.env.ROUTING_URL) throw new Error("ROUTING_URL fehlt (.env.local, Routendienst nach docs/42)");

const CACHE_DIR = ".wp-cache";
const SOURCE_DIR = join(CACHE_DIR, "source");
const OUT_FILE = join(CACHE_DIR, "routes.json");

/**
 * Ab wann gilt eine Linie als Stummel statt als ungenau?
 *
 * Vergleichsmass ist die gesnappte Gehzeit gegen die alte Angabe. Unter der Hälfte ist die
 * Linie so viel kürzer als der beschriebene Weg, dass kein Ausrichten das erklärt: Da fehlt
 * Strecke. Über dem Doppelten stimmt entweder die alte Angabe nicht oder die Linie enthält
 * einen Umweg, den niemand geht. Dazwischen ist beides plausibel, und dann ist die
 * gerechnete Zahl die bessere.
 */
const TOO_SHORT = 0.5;
const TOO_LONG = 2.0;

/**
 * Viele alte Linien gehen nur bis zum Gipfel und nicht zurück. Dann fehlt die halbe Strecke,
 * und das Höhenprofil hört oben auf. Das Admin-Formular hat dafür den Knopf „↔ Hin & zurück"
 * (makeThereAndBack in SpotForm.tsx); hier passiert dasselbe rechnerisch.
 *
 * ABER NICHT BLIND. Nicht jede offene Route ist hin und zurück: Auf der Schmittenhöhe geht
 * man rauf und fährt mit der Seilbahn runter, dort wäre Verdoppeln schlicht gelogen. Wer
 * entscheidet, ist die alte Dauer-Angabe — beide Varianten werden gerechnet und die
 * genommen, die besser dazu passt.
 *
 * Verdoppeln braucht KEINE zweite Anfrage: Der Rückweg ist der Hinweg rückwärts, also
 * verdoppelt sich die Strecke, und Auf- und Abstieg tauschen die Plätze und addieren sich.
 * Das ist exakt, nicht geschätzt.
 */
/**
 * Routen, die NIE verdoppelt werden dürfen, egal was die alte Dauer nahelegt.
 *
 * Die Schmittenhöhe geht man rauf und fährt mit der Seilbahn runter, das steht wörtlich im
 * eigenen Insider-Tipp („dass du rechtzeitig die letzte Talfahrt der Seilbahn erreichst").
 * Die Automatik hat sie trotzdem verdoppelt: Schiedsrichter ist die alte Dauer-Angabe, und
 * die stand hier auf 8 Stunden — selbst schon eine „plane so viel ein"-Zahl und keine
 * Gehzeit. 628 Minuten lagen damit näher als die richtigen 314.
 *
 * Von 25 verdoppelten Routen ist das die einzige. Der Eintrag steht hier und nicht als
 * korrigierter Wert in routes.json, weil eine von Hand geänderte Datei beim nächsten Lauf
 * still überschrieben wird.
 */
const NEVER_DOUBLE = new Set(["schmittenhohe"]);

/**
 * Routen, die IMMER verdoppelt werden, egal was die alte Dauer nahelegt.
 *
 * Der Schiedsrichter oben ist ein Zahlenvergleich, und der liest keine Wörter. Beim
 * Gamskarkogel stand als alte Dauer „8 h gesamt": Der reine Aufstieg rechnet sich zu 7:55,
 * hin und zurück zu 13:35 — also gewann der Aufstieg, obwohl das Wort „gesamt" wörtlich das
 * Gegenteil sagt. Auf der Karte lag danach eine Linie, die am Gipfel aufhört, und im Feld
 * eine Zeit für den halben Ausflug.
 *
 * Gemeinsam haben die sechs: kein Lift, kein Übergang, das Ziel ist ein Stichweg. Wer oben
 * ist, geht denselben Weg zurück. Die Liste steht hier und nicht in routes.json, weil eine
 * von Hand geänderte Datei beim nächsten Lauf still überschrieben wird.
 */
const ALWAYS_DOUBLE = new Set([
  "gamskarkogel",
  "gollinger-wasserfall",
  "lackenkogel",
  "nockstein",
  "oberhutte",
  "tappenkarsee",
]);

type Source = WpSource & { computed: { routeKm: number | null } };

export type RouteResult = {
  slug: string;
  points: number;
  /** Länge der Linie, wie sie auf der alten Seite lag. */
  rawKm: number;
  /** Länge nach dem Ausrichten an echten Wegen, oder null wenn der Dienst nichts fand. */
  snappedKm: number | null;
  ascent: number | null;
  descent: number | null;
  /** DAV-Gehzeit aus der gesnappten Linie (geo.ts, inkl. Pausen-Puffer). */
  minutes: number | null;
  /** Was die alte Seite als Dauer angab, in Minuten. null = keine Angabe. */
  statedMinutes: number | null;
  ratio: number | null;
  /** "loop" = geschlossen, "there-and-back" = verdoppelt, "one-way" = so gelassen. */
  shape: "loop" | "there-and-back" | "one-way" | null;
  verdict: "stimmig" | "alte Angabe prüfen" | "Linie unvollständig" | "kein Weg gefunden" | "kein Vergleich";
  coords?: [number, number][];
  elevations?: number[];
  error?: string;
};

// „2 h", „30 min", „8 h gesamt", „1–2 Std" -> Minuten. Bei einer Spanne die UNTERE Grenze,
// weil die alte Seite dort meist die reine Gehzeit meinte.
function parseStated(v: string | null): number | null {
  if (!v) return null;
  const m = /^(\d+(?:[.,]\d+)?)\s*(min|minuten|h|std|stunden?)/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const min = /^m/i.test(m[2]) ? Math.round(n) : Math.round(n * 60);
  // „0 min" steht im Altbestand für „nicht ausgefüllt", nicht für eine Dauer von null.
  // Ohne diese Zeile wäre es eine Angabe, gegen die sich jede Route vergleichen liesse.
  return min > 0 ? min : null;
}

// Derselbe Kern wie snapRoute im Admin (lib/routing/snap-spot.ts): Profil hiking-mountain,
// Höhe je Punkt aus den Wegdaten. Die Linie wird vorher auf 50 Punkte eingedampft; die
// Zwischenpunkte liefert der Dienst ohnehin selbst, er soll dem Weg folgen und nicht meiner
// Linie. Mehr als 25 Punkte je Anfrage schneidet der Kern selbst in Stücke.
async function snap(waypoints: [number, number][]): Promise<{
  coords: [number, number][];
  elevations: number[] | null;
  distanceKm: number | null;
} | null> {
  const r = await routeSpotLine(downsample(waypoints, 50));
  if (!r.ok) {
    if (r.code === "no-route") return null;
    throw new Error(`Routendienst: ${r.code}${r.message ? ` (${r.message})` : ""}`);
  }
  if (r.line.provider === "local") throw new Error("Testadapter aktiv (ROUTING_URL fehlt): keine erfundene Linie");
  return { coords: r.line.geometry, elevations: r.line.elevationM, distanceKm: r.line.distanceM / 1000 };
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  const previous: Record<string, RouteResult> = existsSync(OUT_FILE)
    ? Object.fromEntries((JSON.parse(readFileSync(OUT_FILE, "utf8")) as RouteResult[]).map((r) => [r.slug, r]))
    : {};

  const sources = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(SOURCE_DIR, f), "utf8")) as Source)
    .filter((s) => s.route && s.route.coords.length >= 2);

  console.log(`${sources.length} Spots mit Linie.\n`);
  const results: RouteResult[] = [];
  let n = 0;

  for (const src of sources) {
    if (n >= limit) {
      if (previous[src.slug]) results.push(previous[src.slug]);
      continue;
    }
    // Schon gerechnet? Nicht nochmal: Ein Lauf, der von vorn anfängt, wirft die Handarbeit
    // am Bericht weg (und der Geo-Server muss nicht 60 Routen am Stück rechnen).
    if (previous[src.slug] && !previous[src.slug].error) {
      results.push(previous[src.slug]);
      continue;
    }
    n++;

    const coords = src.route!.coords;
    const rawKm = Math.round(routeLengthKm(coords) * 100) / 100;
    const stated = parseStated(src.facts.find((f) => f.field === "duration")?.value ?? null);

    const base: RouteResult = {
      slug: src.slug,
      points: coords.length,
      rawKm,
      snappedKm: null,
      ascent: null,
      descent: null,
      minutes: null,
      statedMinutes: stated,
      ratio: null,
      shape: null,
      verdict: "kein Weg gefunden",
    };

    try {
      const snapped = await snap(coords);
      if (!snapped) {
        results.push(base);
        console.log(`  ${src.slug.padEnd(34)} kein Weg gefunden`);
      } else {
        const km = snapped.distanceKm ?? routeLengthKm(snapped.coords);
        const ad = snapped.elevations ? ascentDescent(snapped.elevations) : { ascent: 0, descent: 0 };
        const oneWayMin = hikingTimeMinutes(km, ad.ascent, ad.descent);

        // Geschlossene Linien sind fertige Rundwege, die darf man nicht verdoppeln.
        // Bei offenen entscheidet die alte Angabe, welche Lesart besser passt.
        const closed = isClosedRoute(snapped.coords);
        const d = doubled(km, ad.ascent, ad.descent);
        const bothMin = hikingTimeMinutes(d.km, d.ascent, d.descent);
        const off = (m: number) => (stated ? Math.abs(Math.log(m / stated)) : Infinity);
        const useBoth =
          !closed &&
          !NEVER_DOUBLE.has(src.slug) &&
          (ALWAYS_DOUBLE.has(src.slug) ||
            (stated != null && off(bothMin) < off(oneWayMin)));

        const shape: RouteResult["shape"] = closed ? "loop" : useBoth ? "there-and-back" : "one-way";
        const finalKm = useBoth ? d.km : km;
        const finalAsc = useBoth ? d.ascent : ad.ascent;
        const finalDesc = useBoth ? d.descent : ad.descent;
        const minutes = useBoth ? bothMin : oneWayMin;
        // Der Rückweg ist der Hinweg rückwärts, genau wie makeThereAndBack im Formular.
        const coords = useBoth
          ? [...snapped.coords, ...snapped.coords.slice(0, -1).reverse()]
          : snapped.coords;
        const elevations = snapped.elevations
          ? useBoth
            ? [...snapped.elevations, ...snapped.elevations.slice(0, -1).reverse()]
            : snapped.elevations
          : undefined;

        const ratio = stated ? minutes / stated : null;
        const verdict: RouteResult["verdict"] = !stated
          ? "kein Vergleich"
          : ratio! < TOO_SHORT
            ? "Linie unvollständig"
            : ratio! > TOO_LONG
              ? "alte Angabe prüfen"
              : "stimmig";
        const r: RouteResult = {
          ...base,
          snappedKm: Math.round(finalKm * 100) / 100,
          ascent: finalAsc,
          descent: finalDesc,
          minutes,
          ratio: ratio ? Math.round(ratio * 100) / 100 : null,
          shape,
          verdict,
          coords,
          elevations,
        };
        results.push(r);
        console.log(
          `  ${src.slug.padEnd(30)} ${String(r.snappedKm).padStart(6)} km ${String(minutes).padStart(4)} min  alt ${String(stated ?? "-").padStart(4)}  ${shape.padEnd(14)} ${verdict}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ...base, error: msg });
      console.log(`  ${src.slug.padEnd(34)} FEHLER ${msg.slice(0, 60)}`);
    }

    writeFileSync(OUT_FILE, JSON.stringify(results, null, 1));
  }

  writeFileSync(OUT_FILE, JSON.stringify(results, null, 1));

  const by = (v: RouteResult["verdict"]) => results.filter((r) => r.verdict === v);
  console.log("");
  console.log(`stimmig:              ${by("stimmig").length}`);
  console.log(`alte Angabe prüfen:   ${by("alte Angabe prüfen").length}`);
  console.log(`Linie unvollständig:  ${by("Linie unvollständig").length}  (Handarbeit, kein API hilft)`);
  console.log(`kein Weg gefunden:    ${by("kein Weg gefunden").length}`);
  console.log(`kein Vergleich:       ${by("kein Vergleich").length}`);
  console.log(`\n-> ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
