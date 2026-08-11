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
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpot, type WpPost, type WpSource } from "./parse.ts";
import { readCache, POSTS_FILE, MEDIA_FILE, PRO_FILE, MAPS_FILE, CACHE_DIR } from "./cache.ts";
import { routeLengthKm, hikingTimeMinutes, haversineMeters } from "../../src/lib/geo.ts";
import { LAKES } from "../../src/lib/lakes.ts";

const SOURCE_DIR = join(CACHE_DIR, "source");

// WAS IST ÜBERHAUPT EIN SPOT: Er steht auf einer der beiden Frontend-Karten der alten
// Seite. Sonst nicht.
//
// Die Kategorie „alle" enthält 102 Beiträge, aber sieben davon sind keine Spots: vier
// Vorlagen („Outdoor Spot Template", „Werbung Anzeige Template") und drei Entwürfe, die es
// nie auf die Karte geschafft haben. Zuerst stand hier eine Ausschlussliste mit vier Slugs,
// die ich beim Draufschauen für Müll hielt. Die hätte die drei Entwürfe durchgelassen, und
// sie hätte jeden künftigen Test durchgelassen, dessen Titel ich nicht errate.
//
// Die Karte weiss es besser, weil sie die Antwort schon enthält: Was SalzGuide seinen
// Besuchern als Spot zeigt, ist ein Spot. Kein Pflege-Aufwand, keine Rate-Regel.

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

  // Pro-Flag: NUR aus dem anonymen Abruf. Im angemeldeten Rohinhalt steht der Kauf-Hinweis
  // nicht, deshalb erkennt der Parser die Sperre dort grundsätzlich nicht.
  const proSlugs = new Set(readCache<string[]>(PRO_FILE));

  // Die zwei Frontend-Karten der alten Seite liefern Emoji, Pro-Flag und (bei Gastein) die
  // Saison. Sie decken 95 der 98 Spots ab, taugen also nicht als alleinige Pro-Quelle —
  // aber auf diesen 95 stimmt ihr Flag zu 100 % mit dem unabhängig ermittelten anonymen
  // Abruf überein. Zwei Quellen, die sich nirgends widersprechen, sind ein Beleg; eine
  // wäre nur eine Annahme.
  const maps = readCache<Record<string, { isPro: boolean; emoji: string | null; season: "summer" | "winter" | null }>>(MAPS_FILE);
  const proConflicts: string[] = [];

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
    images: { url: string; width: number | null; height: number | null; alt: string | null }[];
    imageUrls: string[];
    videos: number;
    routeKm: number | null;
    ascent: number | null;
    minutes: number | null;
  }[] = [];

  const skipped: string[] = [];
  for (const post of posts) {
    if (!maps[post.slug]) {
      skipped.push(`${post.slug} (${post.title.raw ?? post.title.rendered})`);
      continue;
    }
    const src = parseSpot(post);

    // Pro und Emoji werden dem geparsten Objekt NACHTRÄGLICH aufgeprägt: Beides steht
    // nicht im Inhalt, den parse.ts sieht, sondern kommt aus den zwei Nebenquellen.
    src.isPro = proSlugs.has(post.slug);
    const onMap = maps[post.slug];
    if (onMap) {
      if (onMap.isPro !== src.isPro) proConflicts.push(post.slug);
      // Das Emoji der Karte STICHT das aus dem Seitenquelltext: Dort steht bei den älteren
      // Spots der erste Routenpunkt-Marker, und Loipe wie Rodelbahn kamen so zu einem 📸.
      if (onMap.emoji) src.emoji = onMap.emoji;
      if (onMap.season) src.mapSeason = onMap.season;
    }
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

    const imageList = images.map((i) => ({
      url: i.source_url,
      width: i.media_details?.width ?? null,
      height: i.media_details?.height ?? null,
      alt: i.alt_text || null,
    }));

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
            images: imageList,
            videos: videos.map((v) => ({ url: v.source_url })),
          },
          computed: { routeKm, ascent, hikingMinutes: minutes },
        },
        null,
        1,
      ),
    );
    rows.push({
      src,
      images: imageList,
      imageUrls: imageList.map((i) => i.url),
      videos: videos.length,
      routeKm,
      ascent,
      minutes,
    });
  }

  // ── Wassertemperatur: welcher See gehört zum Spot ─────────────────────────
  //
  // Die Wassertemperatur-Kachel hängt an `lake_name`. Auf der alten Seite hat den nur
  // gesetzt, wer den Shortcode [sg_seetemp see="…"] eingebaut hat: fünf Spots. Gemeint
  // sind aber alle, die an einem See liegen, für den es überhaupt eine Messung gibt.
  //
  // Die Zuordnung läuft über die ENTFERNUNG, nicht über Wörter im Text. LAKES aus
  // src/lib/lakes.ts trägt zu jedem See die Koordinate der offiziellen Messstelle, und die
  // Spot-Koordinaten haben wir für alle 95.
  //
  // Automatisch nur unter 400 Metern, und das ist mit Absicht streng. Darüber wird es
  // Zufall: Die Bad-Gastein-Spots liegen alle rund 3 km vom „Badesee Gastein", die Cafés in
  // der Altstadt 4 km vom Lieferinger Badesee. Eine Wassertemperatur an einem Café ist
  // nicht bloss nutzlos, sie behauptet etwas Falsches über den Ort. Was dazwischen liegt,
  // steht im Report und entscheidet ein Mensch.
  //
  // Ein bereits gesetzter Wert gewinnt immer: Falkensteinwand liegt 1,7 km vom Messpunkt
  // entfernt, ist aber die Felswand AM Wolfgangsee, und das wusste Anton besser.
  const LAKE_AUTO_M = 400;
  const LAKE_ASK_M = 3000;
  const lakeCandidates: string[] = [];
  for (const r of rows) {
    if (r.src.lat == null || r.src.lng == null) continue;
    let best: { name: string; m: number } | null = null;
    for (const l of LAKES) {
      const m = haversineMeters([r.src.lng, r.src.lat], [l.lng, l.lat]);
      if (!best || m < best.m) best = { name: l.name, m };
    }
    if (!best) continue;
    if (r.src.lakeName) continue;
    if (best.m <= LAKE_AUTO_M) r.src.lakeName = best.name;
    else if (best.m <= LAKE_ASK_M)
      lakeCandidates.push(`${r.src.slug}: ${best.name}, ${Math.round(best.m)} m entfernt`);
  }

  // ── Was gehört NICHT in die Galerie ────────────────────────────────────────
  //
  // Zwei Sorten Bilder liegen im Elementor-Datensatz und sehen für den Sammler aus wie
  // Spot-Fotos, sind aber keine. Beide fielen erst auf, als Anton im Admin nachgeschaut hat.
  //
  // 1. PERSONEN-PORTRAITS. Der „Tipp von Anton, Local"-Block trägt das Portrait als ganz
  //    normales Bild. Antons Foto lag damit in 23 Galerien, Simons in 7, Livias in 4.
  //    Antons Regel dafür ist besser als eine Namensliste: mehrfach verwendet UND
  //    quadratisch. Beide Bedingungen sind nötig, weil Tappenkarsee und Schafbergbahn sich
  //    je ein echtes Vorschaubild teilen, und das ist 1080x1920 und bleibt. Über die Namen
  //    der Locals zu gehen wäre für diesen Bestand exakt, würde aber ein Logo durchlassen,
  //    das morgen dazukommt.
  //
  // 2. KARTEN-KACHELN. „…_Explore_Vorschaubild.webp" (1000x800) und „…_Thumbnail.webp"
  //    (1080x1920) sind die Bilder der alten Karten-Kärtchen, bei 88 von 95 Spots dabei,
  //    dazu ein „SalzGuide_Platzhalter…" beim Almkanal. In der neuen App leitet sich das
  //    Kärtchen vom Hero-Foto ab, es braucht kein eigenes.
  //
  //    EHRLICH DAZU: Anton sagt, es sei dasselbe Foto wie eines in der Galerie. Belegen
  //    konnte ich das nicht — ein 1000x800-Zuschnitt und ein 1440x1920-Original liegen im
  //    Bildvergleich weit auseinander, auch wenn dieselbe Szene drauf ist. Der Ausschluss
  //    hängt deshalb am Dateinamen und daran, WOFÜR die Datei gemacht wurde, nicht an einer
  //    behaupteten Gleichheit. Kein Spot verliert dadurch sein letztes Foto (geprüft).
  const CARD_IMAGE = /vorschaubild|thumbnail|platzhalter/i;

  const usage = new Map<string, number>();
  for (const r of rows) for (const u of r.imageUrls) usage.set(u, (usage.get(u) ?? 0) + 1);
  const isSquare = (w: number | null, h: number | null) =>
    !!w && !!h && Math.abs(w - h) / Math.max(w, h) < 0.05;

  const droppedPortrait = new Map<string, number>();
  const droppedCard: string[] = [];
  for (const r of rows) {
    const keep = r.images.filter((img) => {
      const name = img.url.split("/").pop() ?? "";
      if ((usage.get(img.url) ?? 0) > 1 && isSquare(img.width, img.height)) {
        droppedPortrait.set(name, (droppedPortrait.get(name) ?? 0) + 1);
        return false;
      }
      if (CARD_IMAGE.test(name)) {
        droppedCard.push(`${r.src.slug}: ${name}`);
        return false;
      }
      return true;
    });
    // Ein Spot ohne jedes Foto wäre schlimmer als eine Karten-Kachel in der Galerie.
    // Bisher tritt der Fall nicht ein; falls doch, bleibt lieber alles stehen und der
    // Report sagt es.
    if (!keep.length && r.images.length) {
      r.src.warnings.push("alle Fotos wären Karten-Kacheln oder Portraits, nichts entfernt");
    } else {
      r.images = keep;
    }
    const file = join(SOURCE_DIR, `${r.src.slug}.json`);
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      media: { images: unknown[] };
      warnings: string[];
      lakeName: string | null;
    };
    data.media.images = r.images;
    data.warnings = r.src.warnings;
    data.lakeName = r.src.lakeName;
    writeFileSync(file, JSON.stringify(data, null, 1));
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const L: string[] = [];
  const n = rows.length;
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const pct = (k: number) => `${k}/${n}`;

  L.push("# Lücken-Report: Inhalts-Übernahme von der alten WordPress-Seite", "");
  L.push(`Erzeugt aus \`.wp-cache/\`. ${n} Spots.`, "");
  L.push(`${skipped.length} Beiträge übersprungen, weil sie auf keiner Karte der alten Seite`, "stehen und damit keine Spots sind:", "");
  for (const s of skipped) L.push(`- ${s}`);
  L.push("");
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
  line("Fotos in der Mediathek", count((r) => r.images.length > 0));
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

  // Widersprechen sich die zwei unabhängigen Pro-Quellen, ist eine davon falsch, und man
  // weiss nicht welche. Ein Pro-Spot, der frei ausgeliefert wird, ist ein verschenktes
  // Produkt; ein freier Spot hinter der Schranke vertreibt Leute. Also laut werden.
  if (proConflicts.length) {
    L.push("## WIDERSPRUCH beim Pro-Flag", "");
    L.push("Anonymer Abruf und Startseiten-Karte sind sich uneinig. Vor dem Import klären.", "");
    for (const s of proConflicts) L.push(`- ${s}`);
    L.push("");
  }

  if (droppedPortrait.size) {
    L.push("## Aus den Galerien entfernt: Personen-Portraits", "");
    L.push("Quadratisch und in mehreren Spots verwendet. Das sind die Portraits der Locals", "aus dem Tipp-von-Block, keine Fotos vom Ort.", "");
    for (const [name, n] of [...droppedPortrait].sort((a, b) => b[1] - a[1]))
      L.push(`- ${name} (${n} Spots)`);
    L.push("");
  }
  if (droppedCard.length) {
    L.push("## Aus den Galerien entfernt: Karten-Kacheln", "");
    L.push(`${droppedCard.length} Bilder. Das Kärtchen der neuen App leitet sich vom Hero-Foto ab.`, "");
    L.push("<details><summary>Liste</summary>", "");
    for (const d of droppedCard) L.push(`- ${d}`);
    L.push("", "</details>", "");
  }

  if (lakeCandidates.length) {
    L.push("## Wassertemperatur: See von Hand entscheiden", "");
    L.push("Diese Spots liegen zwischen 400 m und 3 km von einer Messstelle. Zu weit für eine", "automatische Zuordnung, zu nah, um sie nicht zu erwähnen.", "");
    for (const c of lakeCandidates) L.push(`- ${c}`);
    L.push("");
  }

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
