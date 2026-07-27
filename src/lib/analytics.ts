// First-Party-Analytics — Server-Kern (docs/34 §H). Datenschutz by design:
// KEIN Cookie/Storage, IP wird NIE gespeichert (nur transient zum täglich
// gesalzenen Visitor-Hash), nur Aggregate. Reines Server-Util (kein "use server").
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/service";
import { LOCALE_CODES } from "@/i18n/locales";

export type AnalyticsType =
  | "pageview"
  | "spot_save"
  | "event_save"
  | "event_link"
  | "ai_query"
  | "conversion";

export type TrackInput = {
  type: AnalyticsType;
  kind?: string | null; // Seiten-Art (pageview) bzw. Entity-Art (spot/event)
  target?: string | null; // Slug/ID
  category?: string | null; // Snapshot: Spot-subtype / Event-Kategorie
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  country?: string | null;
  device?: string | null;
  locale?: string | null;
  visitorHash?: string | null;
};

// YYYY-MM-DD in Wiener Zeit.
function viennaDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(
    new Date(),
  );
}

// Heutigen Salt (in-memory pro Instanz gecacht -> spart DB-Roundtrips).
let saltCache: { day: string; salt: string } | null = null;
async function todaySalt(): Promise<string | null> {
  const day = viennaDay();
  if (saltCache?.day === day) return saltCache.salt;
  try {
    const { data } = await createServiceClient().rpc("analytics_get_salt", {
      p_day: day,
    });
    if (typeof data === "string" && data) {
      saltCache = { day, salt: data };
      return data;
    }
  } catch {
    /* Tabelle/Funktion fehlt (vor Migration) -> kein Hash */
  }
  return null;
}

// Visitor-Hash: sha256(salt + ip + ua). Ohne Salt/IP -> null (nicht zählbar,
// aber kein Fehler). Der Hash ist nach Salt-Löschung (Cron, 2 Tage) anonym.
export async function visitorHash(
  ip: string | null,
  ua: string | null,
): Promise<string | null> {
  const salt = await todaySalt();
  if (!salt || !ip) return null;
  return createHash("sha256")
    .update(`${salt}:${ip}:${ua ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

// Vertrauenswürdige Client-IP (Vercel: x-real-ip; sonst erster XFF-Eintrag).
export function clientIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0]?.trim() || null;
}

// Land aus dem Vercel-Edge-Geo-Header (nur 2-Letter-ISO, anonym-aggregat; keine IP).
export function clientCountry(req: Request): string | null {
  const c = req.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
}

export function classifyDevice(ua: string | null): string {
  const s = (ua ?? "").toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk/.test(s)) return "tablet";
  if (/mobi|iphone|android|phone|ipod/.test(s)) return "mobile";
  if (!s) return "other";
  return "desktop";
}

// ═══════════════════════════════════════════════════════════════════════════════════════
//  MASCHINEN ZÄHLEN NICHT MIT
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Bis 07/2026 gab es diese Prüfung nicht, und das war der grösste stille Fehler in der
// ganzen Messung. Googlebot, Bingbot und die Vorschau-Roboter von WhatsApp, Slack, Discord
// oder Facebook führen JavaScript aus — sie laden also die Seite, mounten <Analytics> und
// schicken den Beacon wie ein Mensch. Jeder Crawl-Lauf über 200 Spot-Seiten waren 200
// Seitenaufrufe, und weil ein Bot eine feste IP und einen festen User-Agent hat, war er
// obendrein EIN eindeutiger Besucher mit einer sehr langen Sitzung und null Absprüngen.
// Genau die Kennzahlen also, an denen man ablesen will, ob die Seite ankommt.
//
// Bewusst eine simple Liste am User-Agent und keine Verhaltenserkennung: Wer sich als
// Browser ausgibt, ist ohnehin nicht daran zu erkennen, und für die Reichweitenmessung
// muss das auch nicht sein. Was zählt, sind die grossen, ehrlichen Crawler — die machen
// den Löwenanteil aus und nennen sich alle selbst beim Namen.
//
// Die Prüfung läuft auf dem SERVER und nicht im Beacon: Der Server sieht den User-Agent
// ohnehin, und eine Regel, die an einer Stelle steht, kann nicht an der zweiten veralten.
// Die Liste ist bewusst KURZ und eng. Beim Aussortieren ist der teure Fehler der
// umgekehrte: Ein durchgerutschter Crawler fällt als komischer Ausschlag auf, ein
// fälschlich verworfener Mensch fällt nie auf — er fehlt einfach.
//
// Deshalb steht hier weder „yandex" (Yandex Browser ist ein echter Browser, nur der
// YandexBot ist einer) noch „duckduckgo" (deren Browser trägt den Namen, deren Crawler
// heisst DuckDuckBot) noch ein nacktes „preview" oder „feed". Alles, was sich selbst
// „...bot" nennt — GPTBot, ClaudeBot, AhrefsBot, PetalBot, Applebot — fängt die erste
// Regel ohnehin ein, ohne dass jemand die Liste pflegen muss.
const BOT_UA = new RegExp(
  [
    "bot\\b", "bot/", "crawl", "spider", "slurp", // nennen sich selbst so
    "headlesschrome", "phantomjs", "puppeteer", "playwright", // Automatisierung
    "lighthouse", "pagespeed", "gtmetrix", // Messwerkzeuge
    "pingdom", "statuscake", "site24x7", "monitoring", // Verfügbarkeitswächter
    "curl/", "wget", "python-requests", "python-urllib", "go-http-client", // Skripte
    "java/", "okhttp", "libwww", "scrapy", "axios/", "node-fetch", "got/",
    "facebookexternalhit", "ia_archiver", "quora link preview", // benannte Abholer
  ].join("|"),
  "i",
);

/** Kommt dieser Aufruf von einer Maschine? Dann NICHT zählen. Eine Quelle für alle Beacons. */
export function isBotUserAgent(ua: string | null): boolean {
  // Kein User-Agent = kein Browser. Menschen kommen nie ohne.
  if (!ua || !ua.trim()) return true;
  return BOT_UA.test(ua);
}

const SEARCH_HOSTS = /(google|bing|duckduckgo|ecosia|yahoo|startpage|qwant|brave)\./;
const SOCIAL_HOSTS =
  /(instagram|facebook|fb\.com|fb\.me|tiktok|twitter|x\.com|t\.co|reddit|youtube|youtu\.be|linkedin|pinterest|whatsapp|telegram|threads)\./;

// Referrer -> grobe Quelle (kein voller URL, nur Klasse bzw. Host).
export function classifySource(
  referrer: string | null,
  selfHost: string | null,
): string {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).host.toLowerCase();
  } catch {
    return "direct";
  }
  if (!host || (selfHost && host === selfHost.toLowerCase())) return "direct";
  if (SEARCH_HOSTS.test(host)) return "search";
  if (SOCIAL_HOSTS.test(host)) return "social";
  return host.replace(/^www\./, "");
}

// Sprach-Präfix aus der ZENTRALEN Config, nicht handgepflegt: hier stand bis 07/2026
// /^\/(de|en)/ — die sieben anderen Sprachen aus locales.ts fehlten, ihre Aufrufe
// landeten also allesamt unerkannt in kind:"other".
const LOCALE_PREFIX = new RegExp(`^/(${LOCALE_CODES.join("|")})(?=/|$)`);

/** Sprach-Präfix eines Pfads, oder null. Eine Quelle für classifyPath und serverEventContext. */
export function classifyLocalePath(path: string): string | null {
  return (path || "").match(LOCALE_PREFIX)?.[1] ?? null;
}

// Pfad (mit optionalem /{locale}-Präfix) -> { kind, target }. /admin wird NICHT
// getrackt (Betreiber-eigene Nutzung).
export function classifyPath(
  rawPath: string,
): { kind: string; target: string | null } | null {
  let p = (rawPath || "/").split("?")[0].split("#")[0];
  p = p.replace(LOCALE_PREFIX, ""); // Locale-Präfix entfernen
  // „landing" und „explore" statt des früheren „home": bis 07/2026 war die Wurzel die
  // Karte, kind:"home" heisst in Altdaten also KARTEN-Aufruf. Würde die neue Startseite
  // dieses kind erben, spleisste jede Auswertung zwei verschiedene Seiten in eine Linie.
  // Zwei neue kinds -> die alte Serie endet sauber am Umzugstag, statt still zu kippen.
  if (p === "" || p === "/") return { kind: "landing", target: null };
  if (p.startsWith("/explore")) return { kind: "explore", target: null };
  if (p.startsWith("/admin")) return null; // Admin nicht tracken
  const spot = p.match(/^\/spot\/([a-z0-9-]+)\/?$/i);
  if (spot) return { kind: "spot", target: spot[1] };
  if (p.startsWith("/events")) return { kind: "events", target: null };
  if (p.startsWith("/wasser")) return { kind: "water", target: null };
  if (p.startsWith("/gespeichert")) return { kind: "saved", target: null };
  if (p.startsWith("/profil")) return { kind: "profile", target: null };
  // Ab hier: Seiten, die bis 07/2026 allesamt als kind:"other" in einem Topf lagen.
  //
  // Das war kein Schönheitsfehler. „other" war damit der zweitgrösste Eintrag der
  // Auswertung, und niemand konnte sagen, woraus er bestand: Darin steckten die
  // VERKAUFSSEITE /pro (die eine Seite, deren Aufrufe man neben den Conversions sehen
  // will, um zu wissen, ob das Angebot oder der Weg dorthin klemmt) und der ganze
  // Touren-Bereich, also ein komplettes Produkt.
  //
  // Eigene Touren (/touren/meine/...) bekommen bewusst KEINE Kennung mit: Das ist die
  // private Tour eines einzelnen Menschen; ihre ID in der Reichweitenmessung wäre ein
  // Personenbezug, den die Erklärung nicht zusagt. Der Bereich zählt, der Inhalt nicht.
  const tour = p.match(/^\/touren\/([a-z0-9-]+)\/?$/i);
  if (tour && tour[1] !== "bauen" && tour[1] !== "meine") {
    return { kind: "tour", target: tour[1] };
  }
  if (p.startsWith("/touren")) return { kind: "tours", target: null };
  if (p.startsWith("/pro")) return { kind: "pro", target: null };
  if (p.startsWith("/ueber-uns")) return { kind: "about", target: null };
  if (p.startsWith("/support")) return { kind: "support", target: null };
  if (p.startsWith("/rechtliches")) return { kind: "legal", target: null };
  // Übrig gebliebene Entwickler-Seite (Karussell + Sheet-Probe). Sie ist öffentlich
  // erreichbar, gehört aber nicht zum Produkt: eigene Kennung, damit ihre Aufrufe sichtbar
  // sind und nicht unter "other" die Auswertung verwässern. Fällt die Seite weg, fällt
  // diese Zeile mit weg.
  if (p.startsWith("/demo")) return { kind: "demo", target: null };
  // Bleibt "other" dauerhaft gross, fehlt oben eine Zeile. scripts/analytics-check.ts
  // schlägt Alarm, sobald eine neue Route hier landet.
  return { kind: "other", target: null };
}

// Ist dieser (eingeloggte) Nutzer ein Betreiber/Admin? Dann NICHT in Analytics
// zählen. Der eigene Selbst-Read der Rolle ist per RLS erlaubt. Wird an den
// Server-Aufrufstellen (Merkungen, KI) genutzt, wo die Session bereits vorliegt.
export async function isOperatorUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    return (data as { role?: string } | null)?.role === "admin";
  } catch {
    return false;
  }
}

// Ein Event schreiben (best effort — Tracking darf nie den Request stören).
export async function trackEvent(input: TrackInput): Promise<void> {
  // Nur echte Produktion zählt — in Entwicklung/Tests wird NICHTS geschrieben
  // (kein Dev-Rauschen). Zusammen mit der Betreiber-Ausnahme an den Aufrufstellen
  // misst das Dashboard so ausschließlich echten Besucher-Traffic.
  if (process.env.NODE_ENV !== "production") return;
  try {
    await createServiceClient()
      .from("analytics_events")
      .insert({
        type: input.type,
        kind: input.kind ?? null,
        target: input.target ?? null,
        category: input.category ?? null,
        source: input.source ?? null,
        utm_source: input.utmSource ?? null,
        utm_medium: input.utmMedium ?? null,
        utm_campaign: input.utmCampaign ?? null,
        country: input.country ?? null,
        device: input.device ?? null,
        // Volle Locale speichern (alle 9), nicht mehr auf en/de reduzieren.
        locale:
          input.locale && (LOCALE_CODES as readonly string[]).includes(input.locale)
            ? input.locale
            : null,
        visitor_hash: input.visitorHash ?? null,
      });
  } catch {
    /* Analytics ist unkritisch -> Fehler schlucken */
  }
}

// Kontext für Server-Action-Events (Merkungen): Gerät/Land/Sprache aus den Headers,
// damit die Dashboard-Filter (Sprache/Land/Gerät) auch für diese Events greifen.
export async function serverEventContext(): Promise<{
  device: string;
  country: string | null;
  locale: string | null;
}> {
  try {
    const h = await headers();
    const country = (h.get("x-vercel-ip-country") ?? "").toUpperCase();
    // Sprache aus der ZENTRALEN Config, nicht handgepflegt — derselbe Fehler wie oben bei
    // classifyPath: Hier stand /(de|en)/, die sieben anderen Sprachen aus locales.ts
    // fehlten. Jede Merkung eines Italieners oder Koreaners wurde also ohne Sprache
    // gezählt, und der Sprach-Filter im Dashboard zeigte für sie nichts an.
    const ref = h.get("referer") ?? "";
    let locale: string | null = null;
    try {
      locale = classifyLocalePath(new URL(ref).pathname);
    } catch {
      locale = classifyLocalePath(ref); // relativer Referrer -> direkt versuchen
    }
    return {
      device: classifyDevice(h.get("user-agent")),
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      locale,
    };
  } catch {
    return { device: "other", country: null, locale: null };
  }
}

// Spot-subtype (Kategorie-Snapshot) für Pageview-Kategorien.
//
// GECACHT, weil diese Abfrage sonst an jedem einzelnen Aufruf einer Spot-Seite hängt — und
// Spot-Seiten sind die Seiten, auf denen Leute aus Google landen. Der subtype eines Spots
// ändert sich vielleicht einmal im Jahr; ihn pro Seitenaufruf frisch zu holen, ist eine
// Abfrage, die zu 99,99 % dieselbe Antwort bekommt.
//
// Bewusst ein einfacher Speicher im Prozess und kein `api_cache`: Der wäre selbst wieder
// eine Datenbank-Abfrage, also genau das, was hier eingespart werden soll. Der Preis ist,
// dass jede Instanz ihren eigenen Stand hat und eine Änderung bis zu TTL_MS später in der
// Statistik ankommt. Für einen Kategorie-Schnappschuss ist das ohne Belang.
const SUBTYPE_TTL_MS = 10 * 60 * 1000;
const SUBTYPE_MAX = 500; // Deckel gegen unbegrenztes Wachsen bei erfundenen Slugs.
const subtypeCache = new Map<string, { value: string | null; at: number }>();

export async function spotSubtype(slug: string): Promise<string | null> {
  const hit = subtypeCache.get(slug);
  if (hit && Date.now() - hit.at < SUBTYPE_TTL_MS) return hit.value;
  try {
    const { data } = await createServiceClient()
      .from("spots")
      .select("subtype")
      .eq("slug", slug)
      .maybeSingle();
    const v = (data?.subtype as string | null) ?? null;
    const value = v && v.trim() ? v : null;
    // Ältesten Eintrag verwerfen, wenn der Deckel erreicht ist (Map merkt sich die
    // Einfüge-Reihenfolge). Auch ein `null` wird gemerkt: Sonst wäre ein erfundener Slug
    // in einer Schleife wieder eine Abfrage pro Aufruf.
    if (subtypeCache.size >= SUBTYPE_MAX) {
      const oldest = subtypeCache.keys().next().value;
      if (oldest !== undefined) subtypeCache.delete(oldest);
    }
    subtypeCache.set(slug, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

// Conversion (Free -> Pro). Wird beim Stripe-Webhook scharf geschaltet (docs/34 §H).
export async function trackConversion(
  fields: { locale?: string | null } = {},
): Promise<void> {
  await trackEvent({ type: "conversion", locale: fields.locale ?? null });
}
