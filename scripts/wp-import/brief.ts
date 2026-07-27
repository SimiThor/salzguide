// Druckt die Arbeitsvorlage für das Schreiben der deutschen Texte.
// Aufruf:
//   npm run wp:brief                 alle Spots ohne Entwurf
//   npm run wp:brief -- --limit 10   die nächsten zehn
//   npm run wp:brief -- --only gaisberg,maiers
//
// Es geht darum, alles in EINEM Block zu haben, was beim Schreiben eines Spots gebraucht
// wird, und nichts sonst. Die Quell-Dateien sind je 30 bis 200 Zeilen JSON mit Routen-
// Koordinaten und Mediathek-IDs; wer daraus schreibt, blättert mehr als er tippt.
//
// Wichtig ist vor allem die ZEILE MIT DER GEHZEIT. Die Regel lautet, dass der Fliesstext
// dieselbe Zahl nennen muss wie das Feld, und dafür muss man sie beim Schreiben sehen und
// nicht hinterher nachschlagen.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  MIN_ROUTE_KM,
  SUBTYPE_FROM_MARKER,
  durationForField,
  notWalkedReason,
  type WpSource,
} from "./parse.ts";

const CACHE = ".wp-cache";
const SOURCE = join(CACHE, "source");
const DRAFTS = join(CACHE, "drafts");

type Source = WpSource & {
  media: { images: unknown[]; videos: unknown[] };
};
type RouteResult = {
  slug: string;
  snappedKm: number | null;
  ascent: number | null;
  minutes: number | null;
  shape: string | null;
  verdict: string;
};

// Wie im Import: auf fünf Minuten gerundet, ab einer Stunde in Stunden.
function formatDuration(min: number): string {
  const r = Math.round(min / 5) * 5;
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const m = r % 60;
  return m ? `${h} Std ${m} min` : `${h} Std`;
}

// Ob der Spot gefahren statt gegangen wird, entscheidet der SUBTYP, nicht der Typ-Marker
// der alten Seite. Hier stand vorher eine eigene Liste mit Subtyp-Namen, verglichen mit dem
// Marker („panoramastrasse" gegen „Panoramastraße") — sie traf nie zu. Die Vorlage sagte
// deshalb für die Grossglockner-Hochalpenstrasse „DAUER FÜRS FELD: 16 Std 5 min", also die
// DAV-Gehzeit für 30 km Bergstrasse. Der Import macht es richtig; falsch war die Ansage an
// den, der den Text schreibt.
const drivenReason = (src: WpSource) =>
  notWalkedReason(src.slug, SUBTYPE_FROM_MARKER[(src.typeMarker ?? "").toLowerCase()] ?? null);

function main() {
  const args = process.argv.slice(2);
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
  const oi = args.indexOf("--only");
  const only = oi >= 0 ? new Set(args[oi + 1].split(",")) : null;

  const routesFile = join(CACHE, "routes.json");
  const routes: Record<string, RouteResult> = existsSync(routesFile)
    ? Object.fromEntries(
        (JSON.parse(readFileSync(routesFile, "utf8")) as RouteResult[]).map((r) => [r.slug, r]),
      )
    : {};

  const slugs = readdirSync(SOURCE)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((s) => (only ? only.has(s) : !existsSync(join(DRAFTS, `${s}.json`))))
    .slice(0, limit);

  for (const slug of slugs) {
    const s = JSON.parse(readFileSync(join(SOURCE, `${slug}.json`), "utf8")) as Source;
    const isFood =
      s.facts.some((f) => f.field === "cuisine") ||
      s.sections.some((x) => x.label === "Küche & Stil");
    const r = routes[slug];

    console.log("=".repeat(78));
    console.log(
      `${slug}   [${isFood ? "FOOD" : "ACTIVITY"}]${s.isPro ? "  PRO" : ""}${s.mapSeason === "winter" ? "  WINTER" : ""}`,
    );
    console.log(`Titel: ${s.title}`);
    console.log(`Local (Ich-Form): ${s.insiderAuthor ?? "Anton"}   Emoji: ${s.emoji ?? "-"}`);

    const facts = s.facts.map((f) => `${f.field}=${f.canonical ?? f.value}`).join("  ");
    if (facts) console.log(`Facts: ${facts}`);

    // Die Zeile, auf die es beim Schreiben ankommt.
    const driven = drivenReason(s);
    const tooShort = r ? (r.snappedKm ?? 0) < MIN_ROUTE_KM : false;
    const isRoute = r?.minutes != null && !driven && !tooShort;

    if (isRoute && r) {
      console.log(
        `>>> DAUER FÜRS FELD: ${formatDuration(r.minutes!)}   (${r.snappedKm} km, ${r.ascent} hm, ${r.shape})`,
      );
      console.log(`    Der Fliesstext MUSS dieselbe Zahl nennen.`);
    } else {
      // Ohne Route steht die alte Angabe im Feld — dieselbe Regel, dieselbe Zahl.
      if (r) console.log(`ROUTE: wird NICHT importiert (${driven ?? "unter 500 m"}) -> nur Punkt`);
      const old = durationForField(s);
      if (old) {
        console.log(`>>> DAUER FÜRS FELD: ${old}   (alte Angabe, keine Route)`);
        console.log(`    Der Fliesstext MUSS dieselbe Zahl nennen.`);
      } else {
        console.log(`Dauer: kein Feld (die alte Seite hatte keine Angabe)`);
      }
    }
    if (r && r.verdict !== "stimmig") console.log(`    Achtung: ${r.verdict}`);

    if (s.googlePlaceId) console.log(`Öffnungszeiten: ja (Place-ID vorhanden)`);
    if (s.phone) console.log(`Telefon: ${s.phone}`);
    if (s.lakeName) console.log(`Wassertemperatur: ${s.lakeName}`);
    if (s.ticketUrl) console.log(`Tickets: ${s.ticketLabel ?? s.ticketPartner}`);
    console.log(`Medien: ${s.media.images.length} Fotos, ${s.media.videos.length} Videos`);
    if (s.parkingLat) console.log(`Parkplatz-Koordinate: vorhanden`);
    console.log(`Alter Teaser: ${s.excerpt}`);
    console.log("");
    for (const sec of s.sections) {
      console.log(`--- ${sec.label} ---`);
      console.log(sec.text);
    }
    console.log("");
  }
  console.log(`${slugs.length} Spots.`);
}

main();
