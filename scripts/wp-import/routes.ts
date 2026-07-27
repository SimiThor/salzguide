// Legt die importierten Wanderlinien auf echte Wanderwege (OpenRouteService foot-hiking)
// und vergleicht das Ergebnis mit den Dauer-Angaben der alten Seite.
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
// ganze Linie passt in eine Box von 130 Metern, angegeben sind zwei Stunden. Da gibt ORS
// wieder 160 Meter zurück. Solche Routen brauchen Handarbeit, kein API.
//
// Das Ergebnis landet in .wp-cache/routes.json und im Report — es wird NICHTS geschrieben.
// Was am Ende in die Datenbank geht, entscheidet der Import.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { routeLengthKm, hikingTimeMinutes, isClosedRoute } from "../../src/lib/geo.ts";
import type { WpSource } from "./parse.ts";

const ORS_KEY = process.env.ORS_KEY;
if (!ORS_KEY) throw new Error("ORS_KEY fehlt (.env.local)");

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
 * Verdoppeln braucht KEINE zweite ORS-Anfrage: Der Rückweg ist der Hinweg rückwärts, also
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

function doubled(km: number, ascent: number, descent: number) {
  return { km: km * 2, ascent: ascent + descent, descent: ascent + descent };
}

type Source = WpSource & { computed: { routeKm: number | null } };

export type RouteResult = {
  slug: string;
  points: number;
  /** Länge der Linie, wie sie auf der alten Seite lag. */
  rawKm: number;
  /** Länge nach dem Ausrichten an echten Wegen, oder null wenn ORS nichts fand. */
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
  verdict: "stimmig" | "alte Angabe prüfen" | "Linie unvollständig" | "ORS fand nichts" | "kein Vergleich";
  coords?: [number, number][];
  elevations?: number[];
  error?: string;
};

function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

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

function ascentDescent(el: number[]): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref = el[0];
  for (const e of el.slice(1)) {
    const d = e - ref;
    if (Math.abs(d) < 3) continue;
    if (d > 0) ascent += d;
    else descent -= d;
    ref = e;
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) };
}

// Wörtlich der Aufruf aus snapRoute (admin-actions.ts): foot-hiking mit Höhe. ORS nimmt
// höchstens 50 Wegpunkte, deshalb wird die Linie vorher eingedampft; die Zwischenpunkte
// liefert ORS ohnehin selbst, es soll ja dem Weg folgen und nicht meiner Linie.
async function snap(waypoints: [number, number][]): Promise<{
  coords: [number, number][];
  elevations: number[] | null;
  distanceKm: number | null;
} | null> {
  const res = await fetch("https://api.openrouteservice.org/v2/directions/foot-hiking/geojson", {
    method: "POST",
    headers: { Authorization: ORS_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: downsample(waypoints, 50), elevation: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ORS ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = (await res.json()) as {
    features?: { geometry?: { coordinates?: number[][] }; properties?: { summary?: { distance?: number } } }[];
  };
  const feat = data.features?.[0];
  const raw = feat?.geometry?.coordinates;
  if (!raw || raw.length < 2) return null;
  const coords = raw.map((c) => [c[0], c[1]] as [number, number]);
  const elevations = raw[0].length >= 3 ? raw.map((c) => c[2]) : null;
  const dist = feat?.properties?.summary?.distance;
  return { coords, elevations, distanceKm: typeof dist === "number" ? dist / 1000 : null };
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
    // Schon gerechnet? Nicht nochmal: ORS hat ein Tageslimit, und ein Skript, das bei jedem
    // Lauf 60 Anfragen verbrennt, ist nach einer Handvoll Läufen für den Tag erledigt.
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
      verdict: "ORS fand nichts",
    };

    try {
      const snapped = await snap(coords);
      if (!snapped) {
        results.push(base);
        console.log(`  ${src.slug.padEnd(34)} ORS fand keine Route`);
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
          !closed && !NEVER_DOUBLE.has(src.slug) && stated != null && off(bothMin) < off(oneWayMin);

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

    // ORS lässt im Gratis-Tarif 40 Anfragen pro Minute zu.
    await new Promise((r) => setTimeout(r, 1600));
    writeFileSync(OUT_FILE, JSON.stringify(results, null, 1));
  }

  writeFileSync(OUT_FILE, JSON.stringify(results, null, 1));

  const by = (v: RouteResult["verdict"]) => results.filter((r) => r.verdict === v);
  console.log("");
  console.log(`stimmig:              ${by("stimmig").length}`);
  console.log(`alte Angabe prüfen:   ${by("alte Angabe prüfen").length}`);
  console.log(`Linie unvollständig:  ${by("Linie unvollständig").length}  (Handarbeit, kein API hilft)`);
  console.log(`ORS fand nichts:      ${by("ORS fand nichts").length}`);
  console.log(`kein Vergleich:       ${by("kein Vergleich").length}`);
  console.log(`\n-> ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
