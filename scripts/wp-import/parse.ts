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
  /** Google-Place-ID aus [sg_oeffnungszeiten place="…"]. Treibt die Öffnungszeiten. */
  googlePlaceId: string | null;
  phone: string | null;
  ticketUrl: string | null;
  ticketPartner: string | null;
  ticketLabel: string | null;
  /** Seename aus [sg_seetemp see="…"], für die Wassertemperatur-Kachel. */
  lakeName: string | null;
  /** Mediathek-IDs der auf der Seite verwendeten Bilder und Videos (Originale). */
  mediaIds: number[];
  /** WordPress-Kategorie-IDs des alten Beitrags. Quelle für die Karussell-Reihen. */
  wpCategories: number[];
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

// Telefonnummer aus einem Anruf-Link. Drei Tücken, alle drei sind hier zugeschnappt:
//
//   1. Nach „tel:" steht ein LEERZEICHEN („tel: 0043662879379") …
//   2. … und im Rohtext ist es URL-kodiert („tel:%200043662879379").
//      Ein Muster, das direkt eine Ziffer erwartet, findet 4 von 17 Nummern.
//   3. Die Nummer im Link ist gewählt („0043662879379"), der Text DANEBEN ist lesbar
//      („📞 +43 662 879379"). Aus der gewählten Form die Gruppierung zu erraten geht
//      schief, weil österreichische Vorwahlen unterschiedlich lang sind. Also wird die
//      lesbare Fassung bevorzugt und die gewählte nur als Rückfall normalisiert.
function extractPhone(hay: string): string | null {
  const link = /tel:(?:%20|\s)*(\+?[0-9][0-9 ()/-]{5,})/.exec(hay);
  if (!link) return null;
  // Der Anzeigetext steht kurz VOR dem Link (Elementor: "text":"… +43 …","link":{"url":"tel:…).
  const before = hay.slice(Math.max(0, link.index - 120), link.index);
  const pretty = /(\+\d{1,3}[ /-]?\d[\d ()/-]{5,})/.exec(before);
  if (pretty) return pretty[1].replace(/\s+/g, " ").trim();
  return link[1].replace(/\s+/g, "").replace(/^00/, "+");
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
  categories?: number[];
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
  let googlePlaceId: string | null = null;
  let phone: string | null = null;
  let ticketUrl: string | null = null;
  let ticketPartner: string | null = null;
  let ticketLabel: string | null = null;
  let lakeName: string | null = null;

  const titleText = norm(decodeEntities(post.title.raw ?? post.title.rendered));
  let pending: string | null = null;
  let pendingHint: string | null = null;
  // Die Quick-Fact-Leiste steht ganz oben, VOR der ersten Inhalts-Überschrift. Danach sind
  // kurze Überschriften Sektions-Etiketten und keine Werte mehr.
  let inFactStrip = true;

  for (const b of bs) {
    if (b.kind === "shortcode") {
      shortcodes.push(b.raw);
      // Die alte Seite trug ihre Integrationen als Shortcode-Attribute. Das sind keine
      // Textschnipsel, sondern genau die Werte, die in der neuen App eigene Spalten haben:
      // Öffnungszeiten laufen über die Google-Place-ID, die Wassertemperatur über den
      // Seenamen, die Ticket-Kachel über Partner und Adresse.
      const attr = (k: string) => new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(b.attrs)?.[1]?.trim() || null;
      if (b.name === "sg_oeffnungszeiten") googlePlaceId = attr("place");
      if (b.name === "sg_anrufen") phone = attr("tel");
      if (b.name === "sg_seetemp" || b.name === "sg_wassertemp") lakeName = attr("see");
      if (b.name === "sg_tickets") {
        ticketUrl = attr("url");
        ticketPartner = attr("partner");
        ticketLabel = attr("label");
      }
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

  // Öffnungszeiten und Telefon gibt es in ZWEI Bauformen, und die zweite hätte ich fast
  // übersehen. Die ältere Generation nutzt Shortcodes ([sg_oeffnungszeiten place="…"],
  // [sg_anrufen tel="…"]), das sind 4 bzw. 5 Spots. Die neuere baut stattdessen ein
  // HTML-Widget mit `data-place="ChIJ…"` und einem `tel:`-Link — nochmal 23 bzw. 13 Spots.
  //
  // Nach dem Shortcode allein zu suchen hätte also fünf Sechstel der Place-IDs liegen
  // lassen, und zwar unauffällig: Ein Spot ohne Öffnungszeiten sieht nicht kaputt aus, er
  // sieht nur nach einem Spot ohne Öffnungszeiten aus. Aufgefallen ist es nur, weil Anton
  // gesagt hat, das müssten mehr sein.
  const both = raw + "\n" + js;
  if (!googlePlaceId) googlePlaceId = /data-place=\\?"(ChIJ[A-Za-z0-9_-]+)/.exec(both)?.[1] ?? null;
  if (!phone) phone = extractPhone(both);

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
    googlePlaceId,
    phone,
    ticketUrl,
    ticketPartner,
    ticketLabel,
    lakeName,
    // Die IDs stehen im UNveränderten Elementor-Datensatz: Das Entschachteln oben ersetzt
    // \/ durch /, und danach passt das Muster "url":"…","id":N nicht mehr zuverlässig.
    mediaIds: extractMediaIds(String(post.meta?._elementor_data ?? "")),
    wpCategories: post.categories ?? [],
    warnings,
  };
}

// ── Wird der Spot gegangen oder gefahren? ───────────────────────────────────
//
// Steht hier und nicht in import.ts, weil die Arbeitsvorlage (brief.ts) dieselbe Antwort
// braucht: Sie druckt die Dauer, die im Feld landen wird, und danach schreibt jemand seinen
// Text. Vorher hatte brief.ts eine eigene Liste und verglich sie mit dem TYP-MARKER der
// alten Seite („panoramastrasse") statt mit dem Subtyp („Panoramastraße"). Das traf nie zu,
// und deshalb sagte die Vorlage für die Grossglockner-Hochalpenstrasse „DAUER FÜRS FELD:
// 16 Std 5 min" — die DAV-Gehzeit für 30 km Bergstrasse. Wer das nicht kennt, schreibt es
// hin. Eine Kopie, die im entscheidenden Moment das Gegenteil sagt, ist schlimmer als keine.
// import.ts hängt sich an dieselben Konstanten.

/** Typ-Marker der alten Seite -> kanonischer Subtyp der neuen Auswahlliste. Was hier fehlt,
 *  bleibt leer statt zu raten: Ein falscher Subtyp sortiert den Spot in die falsche Reihe
 *  und fällt niemandem auf. */
export const SUBTYPE_FROM_MARKER: Record<string, string> = {
  wanderung: "Wanderung",
  winterwanderung: "Winterwanderung",
  aussichtspunkt: "Aussichtspunkt",
  viewpoint: "Aussichtspunkt",
  wasserfall: "Wasserfall",
  klamm: "Klamm",
  see: "See & Baden",
  abkühlung: "See & Baden",
  burg: "Burg & Schloss",
  park: "Park & Garten",
  therme: "Therme",
  panoramastrasse: "Panoramastraße",
  panoramastraße: "Panoramastraße",
  rodeln: "Rodelbahn",
  langlaufen: "Langlaufloipe",
  ski: "Skigebiet",
  action: "Action & Fun",
  café: "Café",
  cafe: "Café",
  restaurant: "Restaurant",
  streetfood: "Streetfood",
  hütte: "Berghütte",
};

/** Subtypen, die man fährt statt geht. Eine Wanderlinie wäre hier eine Lüge, und die
 *  DAV-Gehzeit rechnet aus 30 km Grossglockner-Hochalpenstrasse 16 Stunden Fussmarsch.
 *  Solche Spots bekommen nur einen Punkt auf der Karte, genau wie ein Café. */
export const NOT_WALKED_SUBTYPES = new Set([
  "Panoramastraße",
  "Schifffahrt",
  "Skigebiet",
  "Bergbahn",
]);

/** Einzelfälle, die kein Subtyp verrät. Die Hellbrunner Allee IST ein Weg, aber der Text
 *  beschreibt sie durchgehend als Fahrradtour („Die Fahrradtour … dauert 20 bis 30 Minuten").
 *  Eine Wander-Gehzeit von 63 Minuten daneben zu stellen, widerspricht dem eigenen Text. */
export const NOT_WALKED_SLUGS = new Set(["hellbrunner-allee", "wolfgangsee-schifffahrt"]);

/**
 * Ab welcher Länge ist eine Linie eine Route und kein Kringel?
 *
 * 500 Meter, und das ist ein ABSOLUTES Mass, kein Vergleich mit der alten Dauer. Genau
 * dieser Vergleich hat mich vorher zweimal in die Irre geführt: Beim Goldegger See und
 * bei der Innersbachklamm sah die Linie „zu kurz" aus, dabei war sie richtig und die alte
 * Zeitangabe falsch. Die Länge weiss man dagegen sicher.
 *
 * In den Daten liegt dort ein klarer Bruch. Darunter: Hangar-7 mit 80 Metern, Blick auf
 * Hohenwerfen mit 30, Mirabellgarten mit 230. Das sind Markierungen, die jemand um einen
 * Ort gezogen hat, keine Wege. Darüber beginnen die echten Runden.
 */
export const MIN_ROUTE_KM = 0.5;

/** Warum dieser Spot nur einen Punkt bekommt, oder null für „ist eine Route". */
export function notWalkedReason(slug: string, subtype: string | null): string | null {
  if (subtype && NOT_WALKED_SUBTYPES.has(subtype)) return `wird gefahren (${subtype})`;
  if (NOT_WALKED_SLUGS.has(slug)) return "wird gefahren/geradelt laut Text";
  return null;
}

/** Echte Dauern für Punkt-Spots, die Anton von Hand kennt. Bewusst eine Liste und keine
 *  Schätzformel: Eine gerechnete „Besichtigungsdauer" wäre geraten, und Geraten fällt
 *  hier still aus. */
export const DURATION_BY_HAND: Record<string, string> = {
  "dom-zu-salzburg": "30 min", // Anton: einmal durchgehen, Krypta inklusive
};

/**
 * Die Dauer, die ohne Route im Feld landet.
 *
 * „0 min" ist keine Dauer, sondern das leere Feld der alten Seite. 17 Spots tragen den
 * Wert, darunter der Dom und der Mirabellgarten. Unverändert übernommen stünde auf der
 * Detailseite „0 min", und das liest sich nicht wie eine fehlende Angabe, sondern wie ein
 * kaputtes Feld. Keine Angabe ist ehrlicher als eine falsche.
 */
export function durationForField(src: WpSource): string | null {
  const byHand = DURATION_BY_HAND[src.slug];
  if (byHand) return byHand;
  const f = src.facts.find((x) => x.field === "duration");
  const v = f ? (f.canonical ?? f.value) : null;
  return v && /^0\s*min$/i.test(v) ? null : v;
}
