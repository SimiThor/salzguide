// Zerlegt eine Spot-Seite der ALTEN WordPress-Seite in ein wortgetreues Quell-Objekt.
//
// GRUNDSATZ: Dieses Modul ordnet NICHTS den neuen Textfeldern zu. Es greift jeden
// beschrifteten Block so ab, wie er dasteht, und hängt sein Etikett dran. Der Altbestand
// hat zwei Template-Generationen mit verschiedenen Überschriften, und eine mechanische
// Zuordnung („Dauer" -> section_a) müsste bei jeder Abweichung raten. Raten fällt hier
// still aus: Der Text landet im falschen Feld und niemand sieht es. Also wortgetreu
// einsammeln, und das Zuordnen beim Umschreiben erledigen, wo geurteilt wird.
//
// ZWEI QUELLEN pro Spot, beide aus dem `context=edit`-Abruf:
//   content.raw          -> der Text. Ungefiltert, also auch bei Pro-Spots vollständig.
//   meta._elementor_data -> die Karte. Dort stehen Koordinaten und Wanderlinie im Klartext.
// Der Rohtext ist sauberes HTML (h1-h6 + p + Shortcodes), keine Elementor-Div-Suppe.
import { factCanonical, factPrice, type FactField } from "../../src/lib/facts-i18n.ts";
import { normalizeText } from "../../src/lib/normalize-text.ts";

export type WpFact = { field: string; value: string; canonical: string | null };
export type WpSection = { label: string; text: string };

export type WpRoute = {
  /** [lng, lat] der Linie, Höhe abgetrennt (die App speichert nur 2D in route_geojson). */
  coords: [number, number][];
  /** Höhenwerte in Metern, gleiche Länge wie coords, oder null wenn die Linie keine hat. */
  elevations: number[] | null;
  startCoord: [number, number] | null;
  endCoord: [number, number] | null;
};

export type WpSource = {
  wpId: number;
  slug: string;
  link: string;
  title: string;
  excerpt: string;
  isPro: boolean;
  template: "a" | "b" | "unbekannt";
  /** Roher Typ-Marker der alten Seite („wanderung", „food", …). */
  typeMarker: string | null;
  facts: WpFact[];
  sections: WpSection[];
  insiderAuthor: string | null;
  emoji: string | null;
  lat: number | null;
  lng: number | null;
  parkingLat: number | null;
  parkingLng: number | null;
  route: WpRoute | null;
  /** Shortcodes der alten Seite, unverändert. Zeigen an, was der Spot alles konnte. */
  shortcodes: string[];
  /** Mediathek-IDs der auf der Seite verwendeten Bilder und Videos (Originale). */
  mediaIds: number[];
  /** Saison laut der Karte, auf der der Spot stand (Gastein = Winter). Sonst null. */
  mapSeason?: "summer" | "winter" | null;
  /** Was beim Zerlegen auffiel. Landet im Lücken-Report, nichts wird still verschluckt. */
  warnings: string[];
};

// ── HTML-Kleinkram ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»",
  bdquo: "„", ldquo: "“", rdquo: "”", sbquo: "‚", lsquo: "‘", rsquo: "’",
  deg: "°", euro: "€", middot: "·", bull: "•", times: "×", eacute: "é",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => ENTITIES[name] ?? m);
}

// Tags raus, Entities auflösen, Leerraum normalisieren. </p> und <br> werden zu einem
// Umbruch, damit ein mehrteiliger Tipp nicht zu einer Wurst zusammenläuft.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ── Rohtext zu einer flachen Blockfolge ─────────────────────────────────────

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "shortcode"; name: string; attrs: string; raw: string };

// Überschriften, Absätze und Shortcodes in Lesereihenfolge. Alles andere (Bilder,
// Buttons, Karten-Skript) ist hier Deko und fliegt raus; die Karte wird separat aus
// _elementor_data gelesen, die Bilder separat aus der Mediathek.
export function blocks(raw: string): Block[] {
  const out: Block[] = [];
  const re = /<(h([1-6]))\b[^>]*>([\s\S]*?)<\/\1>|<p\b[^>]*>([\s\S]*?)<\/p>|\[([a-z0-9_]+)([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[5]) {
      out.push({ kind: "shortcode", name: m[5].toLowerCase(), attrs: norm(m[6] ?? ""), raw: m[0] });
      continue;
    }
    if (m[2]) {
      const t = norm(htmlToText(m[3]));
      if (t) out.push({ kind: "heading", level: Number(m[2]), text: t });
      continue;
    }
    const t = htmlToText(m[4] ?? "");
    if (t) out.push({ kind: "para", text: t });
  }
  return out;
}

// ── Etiketten beider Generationen ───────────────────────────────────────────

// Überschriften, die einen Fliesstext-Block einleiten. Beide Schreibweisen, weil der
// Altbestand „Insider-Tipp" (neu) und „Insider Tipps" (alt) mischt. Der kanonische Name
// links ist das, was im Quell-Objekt landet.
const SECTION_HEADINGS: [RegExp, string][] = [
  [/^allgemeines$/i, "Allgemeines"],
  [/^insider[\s-]?tipps?$/i, "Insider-Tipp"],
  [/^küche\s*&\s*stil$/i, "Küche & Stil"],
  [/^preisniveau$/i, "Preisniveau"],
  [/^lage\s*&\s*erreichbarkeit$/i, "Lage & Erreichbarkeit"],
  [/^dauer\s*&\s*schwierigkeit$/i, "Dauer & Schwierigkeit"],
  [/^beste\s+jahreszeit$/i, "Beste Jahreszeit"],
  [/^dauer$/i, "Dauer"],
  [/^schwierigkeit$/i, "Schwierigkeit"],
  [/^jahreszeit$/i, "Jahreszeit"],
  [/^an(reise|fahrt)$/i, "Anreise"],
];

// Überschriften, die zu einem Widget gehören und keinen Inhalt einleiten. In der neuen
// App kommen Wetter, Wassertemperatur und Öffnungszeiten aus echten Quellen.
const IGNORED_HEADING = /^(wetter für diesen spot|wassertemperatur|öffnungszeiten|karte|spot-karte)/i;

// „Tipp von Anton, Local" steht als EIGENE Überschrift ZWISCHEN „Insider-Tipp" und dem
// Tipp-Text. Sie darf das offene Etikett deshalb nicht zurücksetzen, sonst fällt genau
// der Text weg, der die Seite persönlich macht. (Genau das ist hier zuerst passiert.)
const AUTHOR_HEADING = /^Tipp von\s+([^,]+?)\s*(?:,\s*Local)?$/i;

function matchSectionHeading(t: string): string | null {
  const n = norm(t).replace(/[:]$/, "");
  for (const [re, name] of SECTION_HEADINGS) if (re.test(n)) return name;
  return null;
}

// ── Quick-Facts nach ihrem WERT einordnen ───────────────────────────────────

// Gen A beschriftet die Quick-Facts mit einem Emoji, Gen B stellt nur die nackten Werte
// hin. Auf die Position zu bauen wäre also entweder falsch oder zerbrechlich. Stattdessen
// wird jeder Wert gefragt: „In welche Auswahlliste passt du?" — beantwortet von
// factCanonical, also der ECHTEN Auflösung der App inklusive ihrer Alias-Tabelle. Damit
// funktioniert dieselbe Zeile für beide Generationen, und was hier durchfällt, fiele im
// Admin genauso durch und gehört deshalb in den Report.
const DURATION_RE =
  /^\d+([.,]\d+)?\s*(min|minuten|h|std|stunden?)(\s*[-–]\s*\d+([.,]\d+)?\s*(h|std|stunden?))?(\s*gesamt)?$/i;
const PRICE_RE = /^(kostenlos|gratis|günstig|guenstig|mittel|gehoben|teuer|€{1,4})$/i;

// Gen A beschriftet jeden Quick-Fact mit einem Emoji, Gen B stellt nur den nackten Wert
// hin. Wo die Beschriftung da ist, wird sie benutzt: Die Quelle weiss besser, was ein Wert
// bedeutet, als jede Rückschlussregel. „Sport" unter ⭐ ist eine Bekanntheits-Angabe,
// „Sport" ohne Emoji könnte alles sein.
const FACT_EMOJI: Record<string, string> = {
  "⏳": "duration", "⏰": "duration", "🕐": "duration", "🕒": "duration",
  "💪": "difficulty", "🥾": "difficulty",
  "🌤": "season", "☀": "season", "🌞": "season", "🍂": "season",
  "🚌": "access", "🚗": "access", "🚙": "access", "🚋": "access", "🚏": "access",
  "🍽": "cuisine", "🍴": "cuisine", "☕": "cuisine",
  "💸": "priceLevel", "💰": "priceLevel", "💶": "priceLevel",
  "📍": "area",
  "⭐": "fame", "🌟": "fame", "🏆": "fame",
  "📸": "vibe", "🧘": "vibe", "🎯": "vibe", "😍": "vibe", "🚶": "vibe", "🎿": "vibe",
};

// Emoji-Varianten unterscheiden sich durch unsichtbare Beiwerk-Zeichen (Variantenselektor
// U+FE0F, Zero-Width-Joiner, Hautton). „🚶‍♂️" und „🚶" wären sonst zwei verschiedene
// Schlüssel, und die Tabelle müsste jede Schreibweise doppelt führen.
const emojiKey = (s: string) =>
  [...s].filter((c) => !/[\u{FE00}-\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{2640}\u{2642}]/u.test(c)).join("");

/** Trägt keinen Buchstaben und keine Ziffer, ist also reine Bildschrift. */
export const isEmojiOnly = (s: string) => s.length > 0 && !/[\p{L}\p{N}]/u.test(s);

// Reihenfolge ist Absicht: Ein Wert wie „Altstadt" steht in ZWEI Listen (als Gegend und
// als Subtyp „Altstadt & Gasse"). In der Quick-Fact-Leiste ist die Gegend gemeint, deshalb
// wird area vor subtype gefragt. Subtyp steht ganz hinten, weil seine Liste die breiteste
// ist und sonst alles einsammeln würde.
const FACT_FIELDS: FactField[] = ["difficulty", "season", "fame", "duration", "area", "subtype"];

// Schreibweisen, die es NUR auf der alten Seite gibt: englische Reste aus einer früheren
// Übersetzungsrunde und Bindestrich-Spannen. Sie gehören bewusst hierher und nicht in die
// ALIAS-Tabelle der App: Das sind Altlasten dieses einen Imports, keine Varianten, die je
// wieder jemand ins Admin-Formular tippt. Die App mit ihnen zu füttern, hiesse den Müll
// von 2025 dauerhaft zu adoptieren.
const LEGACY: Record<string, string> = {
  medium: "mittel",
  easy: "leicht",
  hard: "schwer",
  difficult: "schwer",
  "sommer - herbst": "Frühling bis Herbst",
  "frühling - herbst": "Frühling bis Herbst",
  "mai - oktober": "Mai bis Oktober",
  "juni - september": "Juni bis September",
  "dezember - märz": "Dezember bis März",
  "april - oktober": "April bis Oktober",
  ganzjährig: "Ganzjährig",
  einfach: "leicht",
  "frühling - sommer": "Frühling bis Herbst",
  "must-see": "Touristen-Hotspot",
  "local fav": "Lokal beliebt",
  "must see": "Touristen-Hotspot",
  "hidden gem": "Hidden Gem",
};

function classifyFact(value: string, hint: string | null): { field: string; canonical: string | null } {
  const v = LEGACY[norm(value).toLowerCase()] ?? norm(value);

  // Sagt das Emoji, um welches Feld es geht, wird nur noch die Schreibweise geglättet.
  // „Küche & Stil" und „Vibe" haben in der neuen App absichtlich KEIN eigenes Fact-Feld
  // (Küche fliesst in section_a, Vibes sind ein eigenes Array) — dort bleibt der Rohwert
  // als Quellmaterial stehen, statt in ein unpassendes Feld gezwängt zu werden.
  if (hint) {
    if (hint === "cuisine" || hint === "vibe") return { field: hint, canonical: null };
    if (hint === "access") {
      if (/^öffis\s*&\s*auto$/i.test(v) || /^beides$/i.test(v)) return { field: "access", canonical: "beides" };
      if (/^öffis?$/i.test(v)) return { field: "access", canonical: "oeffis" };
      if (/^auto$/i.test(v)) return { field: "access", canonical: "auto" };
      return { field: "access", canonical: null };
    }
    if (hint === "priceLevel") return { field: "priceLevel", canonical: factPrice(v) };
    if (hint === "duration" && !factCanonical("duration", v))
      return { field: "duration", canonical: null };
    return { field: hint, canonical: factCanonical(hint as FactField, v) };
  }

  for (const field of FACT_FIELDS) {
    const c = factCanonical(field, v);
    if (c) return { field, canonical: c };
  }
  // Access steht im JSON als Code statt als deutsches Wort, hat also keine Auswahlliste
  // zum Abgleichen. Die drei Fälle von Hand.
  if (/^öffis\s*&\s*auto$/i.test(v) || /^beides$/i.test(v)) return { field: "access", canonical: "beides" };
  if (/^öffis?$/i.test(v)) return { field: "access", canonical: "oeffis" };
  if (/^auto$/i.test(v)) return { field: "access", canonical: "auto" };
  // „8 h", „2 h", „30 min": die alte Seite schrieb die Dauer als Zeit, die neue kennt
  // Halbtag/Ganztag. Der Rohwert bleibt stehen, die Einordnung macht der Import.
  if (DURATION_RE.test(v)) return { field: "duration", canonical: null };
  if (PRICE_RE.test(v)) return { field: "priceLevel", canonical: factPrice(v) };
  return { field: "unbekannt", canonical: null };
}

// ── Karte: Koordinaten und Wanderlinie aus _elementor_data ──────────────────

// _elementor_data ist ein JSON-String, in dem das Karten-Skript nochmal als String steckt.
// Dadurch sind Anführungszeichen und Schrägstriche doppelt maskiert. Einmal entschachteln,
// dann steht das Skript so da, wie der Browser es sieht.
function unescapeElementor(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

const pair = (a: string, b: string): [number, number] => [Number(a), Number(b)];

// Gen A: `const SPOT = { emoji: '🏔', coord: [lng, lat] };`
// Gen B: `const START_COORD = [lng, lat];` plus `const END_COORD = [...]`.
function extractPoint(js: string): { emoji: string | null; lng: number | null; lat: number | null } {
  const a = /const\s+SPOT\s*=\s*\{([\s\S]{0,400}?)\}\s*;/.exec(js);
  if (a) {
    const emoji = /emoji\s*:\s*['"]([^'"]*)['"]/.exec(a[1])?.[1] ?? null;
    const c = /coord\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(a[1]);
    // Die alte Seite speichert [lng, lat] (GeoJSON-Reihenfolge), die neue App auch.
    if (c) return { emoji, lng: Number(c[1]), lat: Number(c[2]) };
    return { emoji, lng: null, lat: null };
  }
  const b = /START_COORD\s*=\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(js);
  if (b) return { emoji: null, lng: Number(b[1]), lat: Number(b[2]) };
  return { emoji: null, lng: null, lat: null };
}

// Die Linie steht als GeoJSON im Skript, entweder als FeatureCollection (Gen B) oder als
// einzelnes Feature (Gen A). Gesucht wird das erste LineString-Koordinatenfeld; die
// Klammern werden gezählt statt per Regex gesucht, weil die Linien bis zu 1447 Punkte
// haben und jedes „bis zur nächsten ]" danebenliegt.
function extractRoute(js: string): WpRoute | null {
  const m = /"type"\s*:\s*"LineString"\s*,\s*"coordinates"\s*:\s*\[/.exec(js);
  if (!m) return null;
  const start = js.indexOf("[", m.index + m[0].length - 1);
  let depth = 0;
  let end = -1;
  for (let i = start; i < js.length; i++) {
    if (js[i] === "[") depth++;
    else if (js[i] === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return null;

  let raw: number[][];
  try {
    raw = JSON.parse(js.slice(start, end + 1)) as number[][];
  } catch {
    return null;
  }
  const clean = raw.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (clean.length < 2) return null;

  const hasEle = clean.every((c) => Number.isFinite(c[2]));
  const s = /START_COORD\s*=\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(js);
  const e = /END_COORD\s*=\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(js);
  return {
    coords: clean.map((c) => [c[0], c[1]] as [number, number]),
    elevations: hasEle ? clean.map((c) => c[2]) : null,
    startCoord: s ? pair(s[1], s[2]) : null,
    endCoord: e ? pair(e[1], e[2]) : null,
  };
}

// ── Medien-IDs ──────────────────────────────────────────────────────────────

// Elementor notiert zu jedem Bild und Video die Mediathek-ID:
//   {"url":"https:\/\/.../DSC05667.webp","id":3455,"size":"","alt":"","source":"library"}
// Über diese ID kommt man an das ORIGINAL. Die im Inhalt sichtbaren Adressen zeigen auf
// beschnittene Elementor-Miniaturen mit gehashten Namen und taugen nicht als Quelle.
//
// Die naheliegende Zuordnung über das Eltern-Feld der Mediathek greift zu kurz: Sie ist
// nur gesetzt, wenn die Datei AUS diesem Beitrag heraus hochgeladen wurde. Bei 38 von 98
// Spots wären so gar keine Bilder herausgekommen, ohne dass etwas kaputt aussieht.
export function extractMediaIds(elementorData: string): number[] {
  const ids = new Set<number>();
  for (const m of elementorData.matchAll(/"url":"(?:https?:[^"]+)","id":(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}

// ── Hauptfunktion ───────────────────────────────────────────────────────────

export type WpPost = {
  id: number;
  slug: string;
  link: string;
  title: { raw?: string; rendered: string };
  excerpt: { raw?: string; rendered: string };
  content: { raw?: string; rendered: string };
  meta?: Record<string, unknown>;
};

export function parseSpot(post: WpPost): WpSource {
  const raw = post.content.raw ?? post.content.rendered;
  const js = unescapeElementor(String(post.meta?._elementor_data ?? ""));
  const warnings: string[] = [];

  // Der Rohinhalt umgeht den Paywall-Filter. Steht der Hinweis trotzdem drin, wurde nicht
  // mit context=edit geholt — dann fehlt der halbe Bestand und das muss knallen.
  const isPro = /swpm[_-]/.test(raw) || /swpm/.test(String(post.meta?._swpm_protection_type ?? ""));
  if (raw.includes("swpm-post-not-logged-in"))
    warnings.push("Paywall-Hinweis statt Inhalt — mit context=edit erneut holen");

  const bs = blocks(raw);
  const facts: WpFact[] = [];
  const sections: WpSection[] = [];
  const shortcodes: string[] = [];
  let insiderAuthor: string | null = null;
  let typeMarker: string | null = null;
  let parkingLat: number | null = null;
  let parkingLng: number | null = null;
  let shortcodeLat: number | null = null;
  let shortcodeLng: number | null = null;

  const titleText = norm(decodeEntities(post.title.raw ?? post.title.rendered));
  let pending: string | null = null;
  let pendingHint: string | null = null;
  // Die Quick-Fact-Leiste steht ganz oben, VOR der ersten Inhalts-Überschrift. Danach sind
  // kurze Überschriften Sektions-Etiketten und keine Werte mehr.
  let inFactStrip = true;

  for (const b of bs) {
    if (b.kind === "shortcode") {
      shortcodes.push(b.raw);
      if (b.name === "sg_anfahrt") {
        const num = (k: string) => {
          const m = new RegExp(`${k}\\s*=\\s*"(-?[\\d.]+)"`).exec(b.attrs);
          return m ? Number(m[1]) : null;
        };
        shortcodeLat = num("lat");
        shortcodeLng = num("lon");
        parkingLat = num("lat_park");
        parkingLng = num("lon_park");
      }
      continue;
    }

    if (b.kind === "heading") {
      const t = b.text;
      // Reines Emoji: Etikett für den folgenden Wert (nur Gen A).
      if (isEmojiOnly(t)) {
        pendingHint = FACT_EMOJI[emojiKey(t)] ?? null;
        continue;
      }

      // Der Titel steht als eigene Überschrift direkt vor „Allgemeines" und beendet die
      // Quick-Fact-Leiste. Ohne diese Grenze wurde er als Fact eingelesen, und die unscharfe
      // Auflösung machte aus „Schmittenhöhe" klaglos die Gegend „Zell am See": falsch, aber
      // plausibel, also unsichtbar. Der Vergleich läuft gegen den echten Beitragstitel.
      // Verglichen wird GEFALTET, nicht wörtlich: WordPress' wptexturize macht beim
      // Rendern aus dem geraden Apostroph einen typografischen, der Rohtitel behält den
      // geraden. „Maier's" und „Maier's" sind derselbe Spot, aber nicht derselbe String.
      if (inFactStrip && normalizeText(t) === normalizeText(titleText)) {
        inFactStrip = false;
        continue;
      }

      const heading = matchSectionHeading(t);
      if (heading) {
        pending = heading;
        inFactStrip = false;
        continue;
      }
      // Autor-Zeile: Namen merken, offenes Etikett ABSICHTLICH stehen lassen.
      const author = AUTHOR_HEADING.exec(t);
      if (author) {
        insiderAuthor = norm(author[1]);
        continue;
      }
      if (IGNORED_HEADING.test(t)) {
        pending = null;
        inFactStrip = false;
        continue;
      }
      if (inFactStrip && t.length <= 40) {
        const { field, canonical } = classifyFact(t, pendingHint);
        facts.push({ field, value: t, canonical });
        pendingHint = null;
        continue;
      }
      // Der Titel und Bild-Überschriften. Bewusst ignoriert.
      continue;
    }

    // Absatz.
    if (pending) {
      sections.push({ label: pending, text: b.text });
      pending = null;
      continue;
    }
    // Der Typ-Marker steht als nackter Absatz und BEENDET die Quick-Fact-Leiste. Direkt
    // danach folgt der Titel als Überschrift. Ohne diese Grenze läse der Automat den Titel
    // als weiteren Quick-Fact ein — und die unscharfe Auflösung machte aus „Schmittenhöhe"
    // klaglos die Gegend „Zell am See". Falsch, aber plausibel, also unsichtbar.
    if (inFactStrip && !typeMarker && b.text.length <= 30 && !b.text.includes(" ")) {
      typeMarker = b.text.toLowerCase();
      inFactStrip = false;
    }
  }

  const labels = new Set(sections.map((s) => s.label));
  const template: WpSource["template"] = labels.has("Lage & Erreichbarkeit")
    ? "a"
    : labels.has("Anreise")
      ? "b"
      : "unbekannt";

  const point = extractPoint(js);
  const route = extractRoute(js);
  // Rangfolge der Geo-Quellen, von der genauesten zur gröbsten. Der erste Punkt der Linie
  // ist die letzte Rettung und für eine Wanderung genau richtig: Bei einer Route ist der
  // Startpunkt ohnehin der Haupt-/Anreisepunkt (so macht es saveSpot auch).
  const lat = point.lat ?? shortcodeLat ?? route?.startCoord?.[1] ?? route?.coords[0]?.[1] ?? null;
  const lng = point.lng ?? shortcodeLng ?? route?.startCoord?.[0] ?? route?.coords[0]?.[0] ?? null;

  if (lat == null || lng == null) warnings.push("keine Koordinaten gefunden");
  if (!labels.has("Allgemeines")) warnings.push("kein Abschnitt „Allgemeines“");
  if (!labels.has("Insider-Tipp")) warnings.push("kein Insider-Tipp");
  if (!insiderAuthor && labels.has("Insider-Tipp")) warnings.push("Insider-Tipp ohne Autor");
  if (template === "unbekannt") warnings.push("Template nicht erkannt");
  if (!facts.length) warnings.push("keine Quick-Facts gefunden");
  for (const f of facts.filter((f) => f.field === "unbekannt"))
    warnings.push(`Quick-Fact „${f.value}“ passt in keine Auswahlliste`);
  if (route && !route.elevations) warnings.push("Wanderlinie ohne Höhenwerte");

  return {
    wpId: post.id,
    slug: post.slug,
    link: post.link,
    title: titleText,
    excerpt: htmlToText(post.excerpt.raw ?? post.excerpt.rendered),
    isPro,
    template,
    typeMarker,
    facts,
    sections,
    insiderAuthor,
    emoji: point.emoji,
    lat,
    lng,
    parkingLat,
    parkingLng,
    route,
    shortcodes,
    // Die IDs stehen im UNveränderten Elementor-Datensatz: Das Entschachteln oben ersetzt
    // \/ durch /, und danach passt das Muster "url":"…","id":N nicht mehr zuverlässig.
    mediaIds: extractMediaIds(String(post.meta?._elementor_data ?? "")),
    warnings,
  };
}
