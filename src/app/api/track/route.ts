// Analytics-Ingestion (docs/34 §H) — cookieless Beacon vom Client. Setzt/liest
// NICHTS am Gerät. Berechnet Gerät/Quelle/Land/Visitor-Hash serverseitig und
// schreibt ein aggregierbares Event. Antwortet immer schnell (Tracking unkritisch).
import { NextResponse } from "next/server";
import { LOCALE_CODES } from "@/i18n/locales";
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

const clip = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, n) : null;

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

  // ── Event-Link-Klick (Klick auf die Quell-Seite eines Events) ──────────────
  if (body.type === "event_link") {
    const target = clip(body.target, 128);
    if (!target) return new NextResponse(null, { status: 204 });
    await trackEvent({
      type: "event_link",
      kind: "event",
      target,
      category: clip(body.category, 40),
      device,
      locale,
      country,
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

  // Spot-Kategorie-Snapshot (nur bei Spot-Seiten, indizierte Einzelabfrage).
  const category =
    info.kind === "spot" && info.target ? await spotSubtype(info.target) : null;

  const hash = await visitorHash(clientIp(req), ua);

  await trackEvent({
    type: "pageview",
    kind: info.kind,
    target: info.target,
    category,
    source: classifySource(referrer, req.headers.get("host")),
    utmSource,
    utmMedium,
    utmCampaign,
    country,
    device,
    locale,
    visitorHash: hash,
  });

  return new NextResponse(null, { status: 204 });
}
