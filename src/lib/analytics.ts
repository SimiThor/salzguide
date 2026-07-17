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
    const ref = h.get("referer") ?? "";
    const m = ref.match(/\/(de|en)(?:\/|$|\?)/);
    return {
      device: classifyDevice(h.get("user-agent")),
      country: /^[A-Z]{2}$/.test(country) ? country : null,
      locale: m ? m[1] : null,
    };
  } catch {
    return { device: "other", country: null, locale: null };
  }
}

// Spot-subtype (Kategorie-Snapshot) für Pageview-Kategorien. Indizierte Einzelabfrage.
export async function spotSubtype(slug: string): Promise<string | null> {
  try {
    const { data } = await createServiceClient()
      .from("spots")
      .select("subtype")
      .eq("slug", slug)
      .maybeSingle();
    const v = (data?.subtype as string | null) ?? null;
    return v && v.trim() ? v : null;
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
