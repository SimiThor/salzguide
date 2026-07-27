// Zerlegt den Cache der alten Seite in ein Quell-Objekt je Spot und schreibt einen
// Lücken-Report. Aufruf:  npm run wp:extract
//
// Ausgabe:
//   .wp-cache/source/<slug>.json   ein wortgetreues Quell-Objekt je Spot
//   .wp-cache/report.md            was vollständig ist und was Handarbeit braucht
//
// Der Report ist der eigentliche Zweck. Ein Import, der am Ende sagt „102 Spots erledigt",
// hat nur gezählt. Interessant ist, WO er raten musste — und das steht hier, Spot für Spot,
// statt still in einem null-Feld zu verschwinden.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpot, type WpPost, type WpSource } from "./parse.ts";
import { readCache, POSTS_FILE, MEDIA_FILE, CACHE_DIR } from "./fetch.ts";
import { routeLengthKm, hikingTimeMinutes } from "../../src/lib/geo.ts";

const SOURCE_DIR = join(CACHE_DIR, "source");

/** Slugs, die auf der alten Seite nur Vorlage oder Test waren. Nicht importieren. */
const SKIP = new Set([
  "outdoor-spot-template",
  "food-spot-template",
  "werbung-anzeige-template",
  "video-maker-test",
]);

type WpMedia = {
  id: number;
  post: number | null;
  source_url: string;
  mime_type: string;
  media_details?: { width?: number; height?: number };
  alt_text?: string;
};

// Auf- und Abstieg aus den Höhenwerten der alten Linie. Kleine Zacken (unter 3 m) werden
// verschluckt, sonst summiert sich das Rauschen der Höhendaten zu Fantasie-Höhenmetern:
// eine 400-Punkte-Linie sammelt so schnell einige hundert Meter, die niemand geht.
function ascentDescent(elevations: number[]): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  let ref = elevations[0];
  for (const e of elevations.slice(1)) {
    const d = e - ref;
    if (Math.abs(d) < 3) continue;
    if (d > 0) ascent += d;
    else descent -= d;
    ref = e;
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) };
}

function main() {
  const posts = readCache<WpPost[]>(POSTS_FILE);
  const media = readCache<WpMedia[]>(MEDIA_FILE);
  mkdirSync(SOURCE_DIR, { recursive: true });

  const byId = new Map<number, WpMedia>(media.map((m) => [m.id, m]));
  const byParent = new Map<number, WpMedia[]>();
  for (const m of media) {
    if (!m.post) continue;
    const list = byParent.get(m.post) ?? [];
    list.push(m);
    byParent.set(m.post, list);
  }

  const rows: {
    src: WpSource;
    images: number;
    videos: number;
    routeKm: number | null;
    ascent: number | null;
    minutes: number | null;
  }[] = [];

  for (const post of posts) {
    if (SKIP.has(post.slug)) continue;
    const src = parseSpot(post);
    // Zwei Quellen, weil keine allein reicht: Die Elementor-IDs decken praktisch alles ab,
    // das Eltern-Feld fängt zusätzlich Dateien, die im Beitrag liegen, aber im Layout
    // nicht mehr verlinkt sind. Zusammenführen und über die ID entdoppeln.
    const seen = new Set<number>();
    const att: WpMedia[] = [];
    for (const id of src.mediaIds) {
      const m = byId.get(id);
      if (m && !seen.has(m.id)) { seen.add(m.id); att.push(m); }
    }
    for (const m of byParent.get(post.id) ?? [])
      if (!seen.has(m.id)) { seen.add(m.id); att.push(m); }

    const images = att.filter((a) => a.mime_type.startsWith("image/"));
    const videos = att.filter((a) => a.mime_type.startsWith("video/"));

    let routeKm: number | null = null;
    let ascent: number | null = null;
    let minutes: number | null = null;
    if (src.route) {
      // Länge und Gehzeit mit den ECHTEN App-Funktionen rechnen, nicht mit einem Nachbau.
      // Die Gehzeit ist die DAV-Formel aus geo.ts, dieselbe, die das Snapping benutzt.
      routeKm = Math.round(routeLengthKm(src.route.coords) * 100) / 100;
      const ad = src.route.elevations ? ascentDescent(src.route.elevations) : null;
      ascent = ad?.ascent ?? null;
      minutes = hikingTimeMinutes(routeKm, ad?.ascent ?? 0, ad?.descent ?? 0);
    }

    writeFileSync(
      join(SOURCE_DIR, `${src.slug}.json`),
      JSON.stringify(
        {
          ...src,
          media: {
            images: images.map((i) => ({
              url: i.source_url,
              width: i.media_details?.width ?? null,
              height: i.media_details?.height ?? null,
              alt: i.alt_text || null,
            })),
            videos: videos.map((v) => ({ url: v.source_url })),
          },
          computed: { routeKm, ascent, hikingMinutes: minutes },
        },
        null,
        1,
      ),
    );
    rows.push({ src, images: images.length, videos: videos.length, routeKm, ascent, minutes });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const L: string[] = [];
  const n = rows.length;
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const pct = (k: number) => `${k}/${n}`;

  L.push("# Lücken-Report: Inhalts-Übernahme von der alten WordPress-Seite", "");
  L.push(`Erzeugt aus \`.wp-cache/\`. ${n} Spots (4 Vorlagen/Tests übersprungen).`, "");
  L.push("## Was der Extraktor mitbringt", "");
  L.push("| Feld | vollständig | fehlt |", "|---|---|---|");
  const line = (label: string, ok: number) => L.push(`| ${label} | ${pct(ok)} | ${n - ok} |`);
  line("Koordinate", count((r) => r.src.lat != null));
  line("Titel", count((r) => !!r.src.title));
  line("Teaser (short_desc)", count((r) => !!r.src.excerpt));
  line("Abschnitt „Allgemeines“", count((r) => r.src.sections.some((s) => s.label === "Allgemeines")));
  line("Insider-Tipp", count((r) => r.src.sections.some((s) => s.label === "Insider-Tipp")));
  line("Insider-Autor", count((r) => !!r.src.insiderAuthor));
  line("Quick-Facts", count((r) => r.src.facts.length > 0));
  line("Fotos in der Mediathek", count((r) => r.images > 0));
  L.push(`| Wanderlinie | ${count((r) => !!r.src.route)} | (nur Wanderungen) |`);
  L.push(`| Parkplatz-Koordinate | ${count((r) => r.src.parkingLat != null)} | (nur wo gesetzt) |`);
  L.push(`| Video | ${count((r) => r.videos > 0)} | (nur wo vorhanden) |`);
  L.push("");

  L.push("## Spots mit Anmerkungen", "");
  const flagged = rows.filter((r) => r.src.warnings.length);
  if (!flagged.length) L.push("Keine. (Unwahrscheinlich — dann stimmt eher der Report nicht.)", "");
  for (const r of flagged) {
    L.push(`### ${r.src.slug}${r.src.isPro ? " (Pro)" : ""}`);
    for (const w of r.src.warnings) L.push(`- ${w}`);
    L.push("");
  }

  L.push("## Wanderungen mit übernommener Linie", "");
  L.push("Distanz und Gehzeit sind mit den echten App-Funktionen gerechnet", "(`routeLengthKm`, `hikingTimeMinutes`, also DAV inklusive Pausen-Puffer).", "");
  L.push("| Spot | Punkte | km | Aufstieg | Gehzeit |", "|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.src.route).sort((a, b) => (b.routeKm ?? 0) - (a.routeKm ?? 0))) {
    const h = r.minutes != null ? `${Math.floor(r.minutes / 60)} h ${r.minutes % 60} min` : "—";
    L.push(
      `| ${r.src.slug} | ${r.src.route!.coords.length} | ${r.routeKm ?? "—"} | ${r.ascent != null ? r.ascent + " hm" : "keine Höhe"} | ${h} |`,
    );
  }
  L.push("");

  L.push("## Quick-Fact-Werte, die in keine Auswahlliste passen", "");
  L.push("Solche Werte speichert die App zwar, übersetzt sie aber nie", "(`canon()` lässt Unbekanntes stehen). Vor dem Import mappen.", "");
  const unknown = new Map<string, string[]>();
  for (const r of rows)
    for (const f of r.src.facts.filter((f) => f.field === "unbekannt")) {
      const list = unknown.get(f.value) ?? [];
      list.push(r.src.slug);
      unknown.set(f.value, list);
    }
  if (!unknown.size) L.push("Keine.", "");
  for (const [value, slugs] of [...unknown].sort((a, b) => b[1].length - a[1].length))
    L.push(`- \`${value}\` (${slugs.length}×): ${slugs.slice(0, 6).join(", ")}${slugs.length > 6 ? " …" : ""}`);
  L.push("");

  const reportFile = join(CACHE_DIR, "report.md");
  writeFileSync(reportFile, L.join("\n"));

  console.log(`${n} Spots zerlegt -> ${SOURCE_DIR}/`);
  console.log(`Report -> ${reportFile}`);
  console.log(`  Koordinate: ${pct(count((r) => r.src.lat != null))}`);
  console.log(`  Insider-Tipp: ${pct(count((r) => r.src.sections.some((s) => s.label === "Insider-Tipp")))}`);
  console.log(`  Wanderlinie: ${count((r) => !!r.src.route)}`);
  console.log(`  mit Anmerkung: ${flagged.length}`);
}

main();
