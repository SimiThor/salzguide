// Analytics-Ingestion (docs/34 §H) — cookieless Beacon vom Client. Setzt/liest
// NICHTS am Gerät. Berechnet Gerät/Quelle/Land/Visitor-Hash serverseitig und
// schreibt ein aggregierbares Event. Antwortet immer schnell (Tracking unkritisch).
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  DIE MEISTAUFGERUFENE ROUTE DER APP — hier zählt jede Millisekunde und jede Zeile
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Diese Route läuft bei JEDEM Seitenaufruf jedes Besuchers. Was hier eine Datenbank-Abfrage
// kostet, kostet sie mal Seitenaufrufe pro Tag. Zwei Dinge folgen daraus:
//
// 1. DIE ANTWORT WARTET AUF NICHTS (`after`). Bis 07/2026 hat der Browser gewartet, bis
//    Salt-Abfrage, Kategorie-Abfrage und INSERT durch waren — drei Roundtrips zur Datenbank,
//    bevor ein 204 zurückkam, für eine Zahl, die niemand in Echtzeit braucht. Jetzt geht die
//    Antwort sofort raus und die Arbeit passiert danach.
//
// 2. ES GIBT EINE OBERGRENZE. Der Same-Origin-Riegel unten greift nur, wenn ein Origin-Header
//    DA ist — und der ist bei einem Aufruf ausserhalb des Browsers schlicht nicht da. Ihn zur
//    Pflicht zu machen wäre der naheliegende Schluss und der falsche: Nicht jeder Browser
//    schickt ihn bei same-origin, und wir würden echte Aufrufe verlieren, um einen Angreifer
//    zu ärgern, der ohnehin einen Header setzen kann. Was wirklich schützt, ist ein Limit:
//    Ohne eines konnte eine Schleife auf der Kommandozeile `analytics_events` unbegrenzt
//    vollschreiben, bis die Datenbank voll ist. Das ist kein Datenleck, aber ein Ausfall.
import { NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { LOCALE_CODES } from "@/i18n/locales";
import { createServiceClient } from "@/lib/supabase/service";
import {
  trackEvent,
  visitorHash,
  clientIp,
  clientCountry,
  classifyDevice,
  classifySource,
  classifyPath,
  spotSubtype,
} from "@/lib/analytics";

export const runtime = "nodejs";

// Obergrenze je IP. BEWUSST hoch: Ein verlorener Seitenaufruf verfälscht eine Statistik,
// ein zu strammes Limit verfälscht sie systematisch — hinter dem WLAN eines Hotels oder
// eines Campingplatzes teilen sich alle Gäste eine Adresse. 600 in einer Viertelstunde
// erreicht keine Besuchergruppe, eine Schleife auf der Kommandozeile in Sekunden.
const TRACK_WINDOW_SECONDS = 900;
const TRACK_MAX_PER_IP = 600;

const clip = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, n) : null;

/**
 * Zähl-Schlüssel, pseudonymisiert — gleiches Muster wie lib/login-link.ts.
 *
 * In `rate_limits` steht nie eine Klartext-IP: Die Tabelle soll zählen können, nicht wissen,
 * wer wer ist. Das ist hier besonders wichtig, weil diese Route sonst die einzige wäre, die
 * von JEDEM Besucher eine Spur hinterlässt — und die Datenschutzerklärung sagt zu, dass die
 * IP nur transient verarbeitet wird.
 */
function ipSubject(ip: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  return `track-ip:${createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 32)}`;
}

/**
 * Darf diese IP noch schreiben? Nutzt `hit_rate_limit` aus Migration 0055 — dieselbe
 * Funktion wie der Anmeldelink, kein zweiter Mechanismus für dieselbe Aufgabe.
 *
 * FÄLLT OFFEN AUS wie überall: Hakt die Datenbank, wird gezählt statt geblockt. Ein Limit
 * soll Missbrauch bremsen, nicht die Reichweitenmessung abschalten.
 *
 * Läuft in `after()` und kostet den Besucher deshalb keine Wartezeit.
 */
async function withinTrackLimit(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  try {
    const { data } = await createServiceClient().rpc("hit_rate_limit", {
      p_subject: ipSubject(ip),
      p_window_seconds: TRACK_WINDOW_SECONDS,
      p_max: TRACK_MAX_PER_IP,
    });
    return data !== false;
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  // Same-Origin: keine Cross-Site-Beacons (kein fremdes Skript kann Daten einkippen).
  const origin = req.headers.get("origin");
  if (origin) {
    let oh = "";
    try {
      oh = new URL(origin).host;
    } catch {
      /* ungültig */
    }
    if (oh !== req.headers.get("host")) {
      return new NextResponse(null, { status: 403 });
    }
  }
  if (Number(req.headers.get("content-length") ?? 0) > 4000) {
    return new NextResponse(null, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Volle Locale erfassen (alle 9), nicht auf en/de reduzieren; unbekannt -> null.
  const locale =
    typeof body.locale === "string" && (LOCALE_CODES as readonly string[]).includes(body.locale)
      ? body.locale
      : null;
  const ua = req.headers.get("user-agent");
  const device = classifyDevice(ua);
  const country = clientCountry(req);
  // Headers JETZT auslesen: In `after()` ist das Request-Objekt nicht mehr garantiert
  // lesbar, und ein `clientIp(req)` dort wäre eine stille Null.
  const ip = clientIp(req);

  // ── Event-Link-Klick (Klick auf die Quell-Seite eines Events) ──────────────
  if (body.type === "event_link") {
    const target = clip(body.target, 128);
    if (!target) return new NextResponse(null, { status: 204 });
    const category = clip(body.category, 40);
    after(async () => {
      if (!(await withinTrackLimit(ip))) return;
      await trackEvent({ type: "event_link", kind: "event", target, category, device, locale, country });
    });
    return new NextResponse(null, { status: 204 });
  }

  // ── Pageview ───────────────────────────────────────────────────────────────
  const path = clip(body.path, 512) ?? "/";
  const referrer = clip(body.referrer, 512);
  const info = classifyPath(path);
  if (!info) return new NextResponse(null, { status: 204 }); // z.B. /admin -> nicht tracken

  // Kampagnen-Attribution (IG/TikTok-Ads): utm_* bzw. Kurzform s/c aus der Einstiegs-URL.
  const utm = (body.utm ?? {}) as Record<string, unknown>;
  const utmSource = clip(utm.source, 60);
  const utmMedium = clip(utm.medium, 60);
  const utmCampaign = clip(utm.campaign, 80);
  const source = classifySource(referrer, req.headers.get("host"));

  // Ab hier wartet der Browser nicht mehr mit: Limit prüfen, Kategorie nachschlagen,
  // Besucher-Hash bilden und schreiben passiert NACH der Antwort.
  after(async () => {
    if (!(await withinTrackLimit(ip))) return;

    // Spot-Kategorie-Snapshot (nur bei Spot-Seiten, gecachte Einzelabfrage).
    const category = info.kind === "spot" && info.target ? await spotSubtype(info.target) : null;

    await trackEvent({
      type: "pageview",
      kind: info.kind,
      target: info.target,
      category,
      source,
      utmSource,
      utmMedium,
      utmCampaign,
      country,
      device,
      locale,
      visitorHash: await visitorHash(ip, ua),
    });
  });

  return new NextResponse(null, { status: 204 });
}
