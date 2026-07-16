"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { BRAND_VOICE } from "./brand-voice";
import { normalizeManual, type OpeningWeek } from "./opening-hours";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashSpotTexts, translationsPublishable } from "./spot-hash";
import { blurPreviewFor } from "./blur-preview";
import { stripEmDashFields } from "./em-dash";
import { HOME_KEYS } from "./home-fields";
import { translateHomeTextsWith } from "./home-translate";
import { MAX_HOME_FEATURED } from "./home-featured";

export type SpotInput = {
  id?: string;
  slug: string;
  type: "activity" | "food";
  subtype: string;
  emoji: string;
  seasons: string[];
  isPro: boolean;
  status: "draft" | "published";
  sortWeight: number;
  lat: number | null;
  lng: number | null;
  parkingLat: number | null;
  parkingLng: number | null;
  routePoints: [number, number][]; // Kontrollpunkte [lng, lat] (Start … Ziel)
  routeSnapped: [number, number][]; // an Wanderwege gesnappte Linie [lng, lat] (leer = Luftlinie)
  elevationProfile: ElevationProfile | null; // Höhenprofil (beim Snapping befüllt)
  locationMode: "point" | "route"; // Einzelner Punkt ODER Wanderung
  difficulty: string;
  bestSeason: string;
  access: string;
  duration: string;
  priceLevel: string;
  area: string;
  fame: string;
  hasOpeningHours: boolean;
  openingHoursManual: boolean; // true = manuell gepflegt, false = Google Places
  openingHours: OpeningWeek | null; // manuelle Zeiten (Mo..So), nur bei openingHoursManual
  googlePlaceId: string;
  phone: string;
  websiteUrl: string;
  lakeName: string;
  localId: string;
  categoryIds: string[];
  images: string[]; // Foto-URLs (erstes = Hero)
  videoUrl: string | null; // 9:16-Video (MP4 im spot-media-Bucket) oder null
  videoPosterUrl: string | null; // Auto-Standbild (WebP) oder null
  // DE-Texte
  title: string;
  shortDesc: string;
  general: string;
  insiderTip: string;
  sectionA: string;
  sectionB: string;
  locationText: string;
  // Übersetzungen je Sprache (locale -> Texte). Leer = keine Zeile für die Sprache.
  // Wird per „In alle Sprachen übersetzen" befüllt und ist review-/editierbar.
  translations: Record<string, SpotTexts>;
  // Hash der DE-Quelltexte, aus denen die Übersetzungen erzeugt wurden (Aktualitäts-Check).
  translationsSourceHash?: string;
};

export type SpotTexts = {
  title: string;
  shortDesc: string;
  general: string;
  insiderTip: string;
  sectionA: string;
  sectionB: string;
  locationText: string;
};

export type SaveResult = { ok: boolean; id?: string; error?: string };

const e = (v: string) => (v.trim() === "" ? null : v.trim());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Robuster fetch: Timeout pro Versuch + Retry bei Netzwerkfehler/429/5xx.
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeoutMs = 20000,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr;
}

// Nur eigene öffentliche spot-media-URLs zulassen (Video + Standbild).
function spotMediaUrl(
  url: string | null,
): { ok: true; url: string | null } | { ok: false } {
  const clean = typeof url === "string" && url.trim() ? url.trim() : null;
  if (!clean) return { ok: true, url: null };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!base || !clean.startsWith(`${base}/storage/v1/object/public/spot-media/`))
    return { ok: false };
  return { ok: true, url: clean };
}

export async function saveSpot(input: SpotInput): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (!input.slug.trim() || !input.title.trim())
    return { ok: false, error: "required" };

  // Öffnungszeiten: im Google-Modus (Default) ist die Place-ID Pflicht.
  if (
    input.hasOpeningHours &&
    !input.openingHoursManual &&
    !input.googlePlaceId.trim()
  )
    return { ok: false, error: "place_id_required" };

  const vid = spotMediaUrl(input.videoUrl);
  const vidPoster = spotMediaUrl(input.videoPosterUrl);
  if (!vid.ok || !vidPoster.ok) return { ok: false, error: "bad_url" };

  // Veröffentlichen-Gate (Anti-Chaos): live gehen darf ein Spot NUR, wenn er in ALLE Sprachen
  // übersetzt UND aktuell ist. Geprüft wird NUR der Übergang Entwurf->Veröffentlicht: ein bereits
  // veröffentlichter Spot bleibt frei editierbar (Koordinaten/Fotos/Tippfehler), ohne dass alle
  // Sprachen erneut erzwungen werden. Entwurf speichern ist immer erlaubt. (Verbindliche Grenze.)
  if (input.status === "published") {
    let wasPublished = false;
    if (input.id) {
      const { data: cur } = await supabase
        .from("spots")
        .select("status")
        .eq("id", input.id)
        .maybeSingle();
      wasPublished = (cur as { status?: string } | null)?.status === "published";
    }
    if (!wasPublished) {
      const deHashGate = hashSpotTexts({
        title: input.title,
        shortDesc: input.shortDesc,
        general: input.general,
        insiderTip: input.insiderTip,
        sectionA: input.sectionA,
        sectionB: input.sectionB,
        locationText: input.locationText,
      });
      const targets = routing.locales.filter((l) => l !== "de");
      if (!translationsPublishable(input.translations, input.translationsSourceHash, deHashGate, targets))
        return { ok: false, error: "translations_incomplete" };
    }
  }

  // Modus: Einzelner Punkt ODER Wanderung. Bei einer Wanderung ist der
  // Haupt-/Anreisepunkt (lat/lng) automatisch der Startpunkt (erster Kontrollpunkt).
  const isRoute = input.locationMode === "route" && input.routePoints.length >= 2;
  const lat = isRoute ? input.routePoints[0][1] : input.lat;
  const lng = isRoute ? input.routePoints[0][0] : input.lng;
  // Anzeige-Linie: gesnappte Wege bevorzugen, sonst Luftlinie durch die Kontrollpunkte.
  const lineCoords =
    input.routeSnapped.length >= 2 ? input.routeSnapped : input.routePoints;
  const routeGeojson = isRoute
    ? { type: "LineString", coordinates: lineCoords }
    : null;
  const routeWaypoints = isRoute ? input.routePoints : null;
  const elevationProfile = isRoute ? input.elevationProfile : null;

  const row = {
    slug: input.slug.trim(),
    type: input.type,
    subtype: e(input.subtype),
    emoji: e(input.emoji),
    seasons: input.seasons.length ? input.seasons : ["summer"],
    is_pro: input.isPro,
    status: input.status,
    sort_weight: input.sortWeight,
    lat,
    lng,
    parking_lat: input.parkingLat,
    parking_lng: input.parkingLng,
    // Öffis-Anreise zielt immer auf den Spot/Startpunkt -> kein eigener Transit-Punkt
    transit_lat: null,
    transit_lng: null,
    route_geojson: routeGeojson,
    route_waypoints: routeWaypoints,
    elevation_profile: elevationProfile,
    difficulty: e(input.difficulty),
    best_season: e(input.bestSeason),
    access: e(input.access),
    duration: e(input.duration),
    price_level: e(input.priceLevel),
    area: e(input.area),
    fame: e(input.fame),
    has_opening_hours: input.hasOpeningHours,
    google_place_id: e(input.googlePlaceId),
    phone: e(input.phone),
    website_url: e(input.websiteUrl),
    lake_name: e(input.lakeName),
    local_id: e(input.localId),
    video_url: vid.url,
    video_poster_url: vidPoster.url,
  };

  // Spot anlegen/aktualisieren
  let spotId = input.id;
  if (spotId) {
    const { error } = await supabase.from("spots").update(row).eq("id", spotId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabase
      .from("spots")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    spotId = data.id;
  }

  // Schlägt ein Übersetzungs-Write beim VERÖFFENTLICHEN fehl, darf der Spot nicht live+unübersetzt
  // zurückbleiben -> Status auf Entwurf zurücknehmen (kein „published ohne Übersetzungen").
  const abortPublish = async (err: string): Promise<SaveResult> => {
    if (input.status === "published" && spotId)
      await supabase.from("spots").update({ status: "draft" }).eq("id", spotId);
    return { ok: false, error: err };
  };

  // Öffnungszeiten separat & fehlertolerant schreiben (migrationssicher: falls die
  // Spalten noch nicht existieren, scheitert nur dieser Teil – nicht der ganze Spot).
  {
    const manualWeek =
      input.hasOpeningHours && input.openingHoursManual
        ? normalizeManual({ days: input.openingHours ?? [] })
        : null;
    const { error: ohErr } = await supabase
      .from("spots")
      .update({
        opening_hours_manual: input.hasOpeningHours
          ? input.openingHoursManual
          : false,
        opening_hours: manualWeek ? { days: manualWeek } : null,
      })
      .eq("id", spotId);
    if (ohErr) console.error("opening_hours update:", ohErr.message);
  }

  // DE-Übersetzung (Quelle). Ihr source_hash = aktueller Inhalts-Hash -> „Versionsmarke":
  // eine Übersetzung ist aktuell, wenn ihr source_hash gleich diesem ist.
  const deHash = hashSpotTexts({
    title: input.title,
    shortDesc: input.shortDesc,
    general: input.general,
    insiderTip: input.insiderTip,
    sectionA: input.sectionA,
    sectionB: input.sectionB,
    locationText: input.locationText,
  });
  const { error: trErr } = await supabase.from("spot_translations").upsert(
    {
      spot_id: spotId,
      lang: "de",
      title: input.title.trim(),
      short_desc: e(input.shortDesc),
      general: e(input.general),
      insider_tip: e(input.insiderTip),
      section_a: e(input.sectionA),
      section_b: e(input.sectionB),
      location_text: e(input.locationText),
    },
    { onConflict: "spot_id,lang" },
  );
  if (trErr) return await abortPublish(trErr.message);

  // Übersetzungen (alle Sprachen außer DE): je Sprache MIT Inhalt eine Zeile upserten,
  // leere Sprachen -> vorhandene Zeile löschen (keine leeren Übersetzungs-Datensätze).
  for (const [lang, tx] of Object.entries(input.translations ?? {})) {
    if (lang === "de" || !tx) continue;
    const has = [
      tx.title,
      tx.shortDesc,
      tx.general,
      tx.insiderTip,
      tx.sectionA,
      tx.sectionB,
      tx.locationText,
    ].some((s) => (s ?? "").trim() !== "");
    if (has) {
      const { error: txErr } = await supabase.from("spot_translations").upsert(
        {
          spot_id: spotId,
          lang,
          title: tx.title.trim() || input.title.trim(), // Spalte ist NOT NULL
          short_desc: e(tx.shortDesc),
          general: e(tx.general),
          insider_tip: e(tx.insiderTip),
          section_a: e(tx.sectionA),
          section_b: e(tx.sectionB),
          location_text: e(tx.locationText),
        },
        { onConflict: "spot_id,lang" },
      );
      if (txErr) return await abortPublish(txErr.message);
    } else {
      await supabase
        .from("spot_translations")
        .delete()
        .eq("spot_id", spotId)
        .eq("lang", lang);
    }
  }

  // Aktualitäts-Marken (source_hash) NACHRÜGLICH & fehlertolerant setzen: existiert die
  // Spalte noch nicht (Migration 0031 nicht eingespielt), scheitert nur DAS – nicht der Spot.
  {
    const { error: dh } = await supabase
      .from("spot_translations")
      .update({ source_hash: deHash })
      .eq("spot_id", spotId)
      .eq("lang", "de");
    if (dh) console.warn("source_hash (de) übersprungen – Migration 0031 nötig?", dh.message);
    else if (input.translationsSourceHash) {
      await supabase
        .from("spot_translations")
        .update({ source_hash: input.translationsSourceHash })
        .eq("spot_id", spotId)
        .neq("lang", "de");
    }
  }

  // Kategorien neu setzen
  await supabase.from("spot_categories").delete().eq("spot_id", spotId);
  if (input.categoryIds.length) {
    await supabase
      .from("spot_categories")
      .insert(input.categoryIds.map((cid) => ({ spot_id: spotId, category_id: cid })));
  }

  // Fotos neu setzen (erstes = Hero); media-Tabelle ist die Quelle der Wahrheit.
  // Bisheriges Hero VOR dem Löschen lesen, damit eine bereits erzeugte Blur-Vorschau
  // ein Speichern überlebt, bei dem sich am Bild nichts geändert hat.
  const { data: prevHero } = await supabase
    .from("media")
    .select("url, blur_url")
    .eq("spot_id", spotId)
    .eq("type", "image")
    .eq("role", "hero")
    .limit(1)
    .maybeSingle();

  await supabase.from("media").delete().eq("spot_id", spotId).eq("type", "image");
  if (input.images.length) {
    // Vorschau nur fürs Hero: Nur dieses Bild zeigen gesperrte Pro-Spots als Teaser.
    // Schlägt die Erzeugung fehl, bleibt die Spalte null und die UI fällt auf das
    // Emoji zurück – das Speichern des Spots darf daran nicht scheitern.
    const heroBlur = await blurPreviewFor(
      supabase.storage,
      input.images[0],
      prevHero?.url,
      prevHero?.blur_url,
    );
    await supabase.from("media").insert(
      input.images.map((url, i) => ({
        spot_id: spotId,
        type: "image",
        role: i === 0 ? "hero" : "gallery",
        url,
        sort_order: i,
        blur_url: i === 0 ? heroBlur : null,
      })),
    );
  }

  return { ok: true, id: spotId };
}

// Höhenprofil einer Wanderung (kompakt, für minimalistische Anzeige).
export type ElevationProfile = {
  points: { d: number; e: number }[]; // d = km (kumuliert), e = m (Höhe)
  ascent: number; // Aufstieg in m
  descent: number; // Abstieg in m
  min: number; // tiefster Punkt in m
  max: number; // höchster Punkt in m
  distanceKm: number;
};

// Distanz (m) zwischen zwei [lng,lat]-Punkten (Haversine)
function haversine(a: number[], b: number[]): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Gleichmäßig auf max. n Punkte ausdünnen (erster & letzter bleiben erhalten)
function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

// Wegpunkte an echte Wanderwege anpassen (OpenRouteService foot-hiking).
// Läuft serverseitig -> ORS_KEY bleibt geheim. Gibt die gesnappte Linie + Höhenprofil zurück.
export type SnapResult = {
  ok: boolean;
  coords?: [number, number][];
  distanceKm?: number;
  durationMin?: number;
  profile?: ElevationProfile | null;
  error?: string;
};

export async function snapRoute(
  waypoints: [number, number][],
): Promise<SnapResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (waypoints.length < 2) return { ok: false, error: "Mindestens 2 Punkte nötig" };
  const key = process.env.ORS_KEY;
  if (!key)
    return { ok: false, error: "ORS_KEY fehlt – bitte in .env.local eintragen" };

  try {
    const res = await fetchWithRetry(
      "https://api.openrouteservice.org/v2/directions/foot-hiking/geojson",
      {
        method: "POST",
        headers: { Authorization: key, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: waypoints, elevation: true }),
      },
      2,
      20000,
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `ORS ${res.status}: ${txt.slice(0, 160)}` };
    }
    const data = await res.json();
    const feat = data?.features?.[0];
    const raw = feat?.geometry?.coordinates as number[][] | undefined;
    if (!raw || raw.length < 2) return { ok: false, error: "Keine Route gefunden" };
    const coords = raw.map((c) => [c[0], c[1]] as [number, number]);
    const props = feat?.properties ?? {};
    const dist = props?.summary?.distance as number | undefined;
    const distanceKm = typeof dist === "number" ? dist / 1000 : undefined;
    const dur = props?.summary?.duration as number | undefined;
    const durationMin = typeof dur === "number" ? Math.round(dur / 60) : undefined;

    // Höhenprofil (nur wenn ORS Höhe liefert -> 3D-Koordinaten)
    let profile: ElevationProfile | null = null;
    if (raw[0].length >= 3) {
      let cum = 0;
      const pts: { d: number; e: number }[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (i > 0) cum += haversine(raw[i - 1], raw[i]);
        pts.push({ d: cum / 1000, e: raw[i][2] });
      }
      const eles = pts.map((p) => p.e);
      const sum = (n: unknown) => (typeof n === "number" ? Math.round(n) : 0);
      profile = {
        points: downsample(pts, 100).map((p) => ({
          d: Math.round(p.d * 100) / 100,
          e: Math.round(p.e),
        })),
        ascent: sum(props.ascent),
        descent: sum(props.descent),
        min: Math.round(Math.min(...eles)),
        max: Math.round(Math.max(...eles)),
        distanceKm: distanceKm ?? cum / 1000,
      };
    }

    return { ok: true, coords, distanceKm, durationMin, profile };
  } catch {
    return {
      ok: false,
      error: "Routing-Dienst (ORS) gerade nicht erreichbar – bitte nochmal versuchen.",
    };
  }
}

// ---- KI-Texte (Claude Sonnet, docs/27) -------------------------------------
export type GenerateTextsInput = {
  type: "activity" | "food";
  title: string;
  subtype: string;
  seasons: string[];
  categories: string[];
  localName: string;
  notes: string;
  // Aktiv
  difficulty: string;
  bestSeason: string;
  duration: string;
  access: string;
  route: { distanceKm: number; ascent: number; descent: number } | null;
  // Food
  area: string;
  priceLevel: string;
  fame: string;
  // Web-Recherche (Locals/Blogs) einbeziehen
  useWebResearch: boolean;
};

export type GeneratedTexts = {
  general: string;
  insiderTip: string;
  sectionA: string;
  sectionB: string;
  locationText: string;
  shortDesc: string;
};

export type GenerateTextsResult = {
  ok: boolean;
  texts?: GeneratedTexts;
  sources?: string[];
  searchCount?: number;
  error?: string;
};

// Schritt 1: Web-Recherche zum Spot (Server-Tool web_search, von Anthropic ausgeführt).
// Liefert eine belegte Stichpunkt-Zusammenfassung + Quell-URLs. Fehler -> null (Fallback).
async function researchSpot(
  input: GenerateTextsInput,
  key: string,
): Promise<{ research: string; sources: string[]; searches: number } | null> {
  const system = `Du recherchierst für einen Reise-Spot im Salzburger Land (Österreich). Suche im Web nach echten, belegten Infos zu DIESEM konkreten Spot von Locals, Blogs, Foren und offiziellen Seiten: Insider-Tipps, Besonderheiten, beste Zeit, Parken/Anreise, Eigenheiten, worauf man achten sollte. Fasse NUR Belegtes knapp in deutschen Stichpunkten zusammen (kein Markdown-Schnickschnack, keine Emojis). Erfinde nichts. Findest du wenig Verlässliches, sag das offen.`;
  const userMsg = `Spot: ${input.title}${input.subtype ? ` (${input.subtype})` : ""}${input.area ? `, ${input.area}` : ""}, Salzburger Land, Österreich.
Typ: ${input.type}.
Bekannte Stichworte vom Betreiber: ${input.notes.trim() || "—"}.
Finde konkrete Insider-Tipps, Besonderheiten, beste Zeit und Parken/Anreise.`;

  let messages: { role: string; content: unknown }[] = [
    { role: "user", content: userMsg },
  ];
  let last: {
    stop_reason?: string;
    content?: { type: string; text?: string; url?: string; content?: { url?: string }[] }[];
    usage?: { server_tool_use?: { web_search_requests?: number } };
  } | null = null;

  try {
    for (let guard = 0; guard < 4; guard++) {
      const res = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          system,
          messages,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 4,
              user_location: {
                type: "approximate",
                country: "AT",
                region: "Salzburg",
                city: "Salzburg",
                timezone: "Europe/Vienna",
              },
            },
          ],
        }),
        },
        1,
        90000,
      );
      if (!res.ok) return null;
      last = await res.json();
      if (last?.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: last.content }];
        continue;
      }
      break;
    }
  } catch {
    return null;
  }
  if (!last) return null;

  const research = (last.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  const sources: string[] = [];
  for (const b of last.content ?? []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) sources.push(r.url);
    }
  }
  const searches = last.usage?.server_tool_use?.web_search_requests ?? 0;
  if (!research && searches === 0) return null;
  return { research, sources: [...new Set(sources)], searches };
}

export async function generateSpotTexts(
  input: GenerateTextsInput,
): Promise<GenerateTextsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (!input.title.trim()) return { ok: false, error: "Bitte zuerst einen Titel eingeben." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  // Schritt 1: optionale Web-Recherche (Locals/Blogs) als zusätzliche Faktenquelle
  let research = "";
  let sources: string[] = [];
  let searchCount = 0;
  if (input.useWebResearch) {
    const r = await researchSpot(input, key);
    if (r) {
      research = r.research;
      sources = r.sources;
      searchCount = r.searches;
    }
  }

  const isFood = input.type === "food";
  const local = input.localName.trim() || "ein Local";

  const system = `${BRAND_VOICE}

AUFGABE: Erzeuge die 6 deutschen Spot-Textfelder. Gib sie AUSSCHLIESSLICH über das Tool "spot_texts" zurück (kein Fließtext, kein Markdown, keine Überschriften in den Texten).

FELDER & LÄNGE:
- general: Allgemeines, ${isFood ? "ca. 50" : "60–80"} Wörter. Worum geht's, was macht den Spot besonders.
- insider_tip: ca. 50 Wörter, in der ICH-Form von ${local} (z. B. "Ich geh am liebsten früh …") – ein echter, persönlicher Tipp.
- section_a: ${isFood ? "Küche & Stil, ca. 20 Wörter" : "Dauer & Schwierigkeit, 20–30 Wörter"}.
- section_b: ${isFood ? "Preisniveau, ca. 20 Wörter" : "Beste Jahreszeit, ca. 20 Wörter"}.
- location_text: Lage & Erreichbarkeit, 20–30 Wörter.
- short_desc: knackiger Karten-Teaser, 5–8 Wörter, ohne Punkt am Ende.`;

  const systemFull = research
    ? `${system}

ZUSÄTZLICH: Du erhältst einen Block "WEB-RECHERCHE" mit belegten Fakten aus dem Web (Locals/Blogs/offizielle Seiten). Nutze ihn als zusätzliche Faktenquelle – vor allem für "general" und "insider_tip" (konkrete, echte Details dieses Spots!). Es gilt weiterhin: NUR Fakten aus Notizen/Daten/Recherche verwenden, nichts erfinden.`
    : system;

  const facts: string[] = [];
  if (input.subtype) facts.push(`Art: ${input.subtype}`);
  if (input.categories.length) facts.push(`Kategorien: ${input.categories.join(", ")}`);
  if (input.seasons.length) facts.push(`Saison: ${input.seasons.join(", ")}`);
  if (isFood) {
    if (input.area) facts.push(`Standort/Gegend: ${input.area}`);
    if (input.priceLevel) facts.push(`Preisniveau: ${input.priceLevel}`);
    if (input.fame) facts.push(`Bekanntheit: ${input.fame}`);
  } else {
    if (input.route)
      facts.push(
        `Route: ${input.route.distanceKm.toFixed(1)} km, Aufstieg ${input.route.ascent} hm, Abstieg ${input.route.descent} hm`,
      );
    if (input.duration) facts.push(`Dauer: ${input.duration}`);
    if (input.difficulty) facts.push(`Schwierigkeit: ${input.difficulty}`);
    if (input.bestSeason) facts.push(`Beste Zeit: ${input.bestSeason}`);
    if (input.access) facts.push(`Anreise: ${input.access}`);
  }

  const userMsg = `TYP: ${input.type}
SPOT: ${input.title}
LOCAL (für Insider-Tipp, Ich-Form): ${local}
DATEN:
${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "- (keine zusätzlichen)"}
BEKANNTE FAKTEN / STICHWORTE (vom Admin):
${input.notes.trim() || "- (keine)"}${
    research ? `\n\nWEB-RECHERCHE (belegte Fakten von Locals/Blogs):\n${research}` : ""
  }`;

  try {
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: systemFull,
        messages: [{ role: "user", content: userMsg }],
        tools: [
          {
            name: "spot_texts",
            description: "Die 6 deutschen Spot-Textfelder im SalzGuide-Stil.",
            input_schema: {
              type: "object",
              properties: {
                general: { type: "string" },
                insider_tip: { type: "string" },
                section_a: { type: "string" },
                section_b: { type: "string" },
                location_text: { type: "string" },
                short_desc: { type: "string" },
              },
              required: [
                "general",
                "insider_tip",
                "section_a",
                "section_b",
                "location_text",
                "short_desc",
              ],
            },
          },
        ],
        tool_choice: { type: "tool", name: "spot_texts" },
      }),
      },
      2,
      60000,
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${txt.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "spot_texts",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return { ok: false, error: "Keine Textausgabe erhalten" };
    return {
      ok: true,
      // Der Prompt verbietet den Gedankenstrich, aber ein Prompt ist eine Bitte. Hier wird
      // er zum Zwang, bevor der Text ins Formular und damit in die DB geht (em-dash.ts).
      texts: stripEmDashFields(
        {
          general: t.general ?? "",
          insiderTip: t.insider_tip ?? "",
          sectionA: t.section_a ?? "",
          sectionB: t.section_b ?? "",
          locationText: t.location_text ?? "",
          shortDesc: t.short_desc ?? "",
        },
        "de",
      ),
      sources,
      searchCount,
    };
  } catch {
    return {
      ok: false,
      error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen.",
    };
  }
}

export async function deleteSpot(id: string): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  const { error } = await supabase.from("spots").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---- 1-Klick DE→EN-Übersetzung der Spot-Texte -------------------------------
export type TranslateResult = { ok: boolean; texts?: SpotTexts; error?: string };

const EN_VOICE = `You are translating SalzGuide spot texts from German to natural English for salzguide.com (Salzburg region, Austria).

STYLE:
- Casual, buddy tone (German "Du" -> English "you"). Direct, honest, to the point.
- Short, punchy sentences. Few, well-chosen adjectives.
- Translate the MEANING into natural English, never word-for-word.
- Keep ALL proper nouns and place names exactly (Hochkeil, Arthurhaus, Mandlwand, Salzburg, hut/dish names …). Keep numbers and units.

NEVER use em dashes (—). They are the clearest tell of AI-written text and cost us the trust this brand is built on. Write like a human types: full stop, comma, colon, or a plain hyphen. The ONLY exception is Chinese, where the doubled "——" is standard punctuation.
STRICTLY AVOID travel-brochure clichés: "breathtaking", "hidden gem", "paradise", "a must", "magical", "stunning vista", "nestled", "picturesque", "jewel".

RULES:
- Translate ONLY what is given. Do not add, embellish or invent facts.
- If a source field is empty, return an empty string for it.`;

export async function translateSpotTexts(input: SpotTexts): Promise<TranslateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (!input.title.trim()) return { ok: false, error: "Bitte zuerst deutsche Texte erstellen." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const src = {
    title: input.title.trim(),
    short_desc: input.shortDesc.trim(),
    general: input.general.trim(),
    insider_tip: input.insiderTip.trim(),
    section_a: input.sectionA.trim(),
    section_b: input.sectionB.trim(),
    location_text: input.locationText.trim(),
  };
  const userMsg = `Translate these German spot fields to English and return them via the tool "spot_texts_en". Keep empty fields empty.\n\n${JSON.stringify(
    src,
    null,
    2,
  )}`;

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: EN_VOICE,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "spot_texts_en",
              description: "The English translations of the SalzGuide spot fields.",
              input_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  short_desc: { type: "string" },
                  general: { type: "string" },
                  insider_tip: { type: "string" },
                  section_a: { type: "string" },
                  section_b: { type: "string" },
                  location_text: { type: "string" },
                },
                required: [
                  "title",
                  "short_desc",
                  "general",
                  "insider_tip",
                  "section_a",
                  "section_b",
                  "location_text",
                ],
              },
            },
          ],
          tool_choice: { type: "tool", name: "spot_texts_en" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Claude ${res.status}: ${txt.slice(0, 160)}` };
    }
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) =>
        b.type === "tool_use" && b.name === "spot_texts_en",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return { ok: false, error: "Keine Übersetzung erhalten" };
    // Leere DE-Felder bleiben leer (die KI soll nichts erfinden)
    const keep = (deVal: string, enVal?: string) => (deVal.trim() ? (enVal ?? "").trim() : "");
    return {
      ok: true,
      texts: stripEmDashFields(
        {
          title: t.title?.trim() || input.title.trim(),
          shortDesc: keep(input.shortDesc, t.short_desc),
          general: keep(input.general, t.general),
          insiderTip: keep(input.insiderTip, t.insider_tip),
          sectionA: keep(input.sectionA, t.section_a),
          sectionB: keep(input.sectionB, t.section_b),
          locationText: keep(input.locationText, t.location_text),
        },
        "en",
      ),
    };
  } catch {
    return { ok: false, error: "KI-Dienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

// ---- „In ALLE Sprachen übersetzen" -----------------------------------------
// Übersetzt die deutschen Spot-Texte in jede Nicht-DE-Sprache aus der Config (parallel,
// je Sprache ein Claude-Aufruf für beste Qualität). Neue Sprache in locales.ts = automatisch
// mitübersetzt. Ergebnis ist im Formular review-/editierbar.
function spotVoice(langName: string): string {
  return `You are translating SalzGuide spot texts from German into natural ${langName} for salzguide.com (Salzburg region, Austria).

STYLE:
- Casual, friendly (like a cool local friend). Direct, honest, to the point.
- Short, punchy sentences. Few, well-chosen adjectives.
- Translate the MEANING into natural ${langName}, never word-for-word.
- Keep ALL proper nouns and place names exactly (Hochkeil, Arthurhaus, Salzburg, hut/dish names …). Keep numbers and units.

NEVER use em dashes (—). They are the clearest tell of AI-written text and cost us the trust this brand is built on. Write like a human types: full stop, comma, colon, or a plain hyphen. The ONLY exception is Chinese, where the doubled "——" is standard punctuation.
STRICTLY AVOID travel-brochure clichés (the ${langName} equivalents of "breathtaking", "hidden gem", "paradise", "a must", "magical", "stunning", "nestled", "picturesque", "jewel").

RULES:
- Translate ONLY what is given. Do not add, embellish or invent facts.
- If a source field is empty, return an empty string for it.`;
}

async function translateSpotTextsTo(
  input: SpotTexts,
  targetLocale: string,
  apiKey: string,
): Promise<SpotTexts | null> {
  const langName = localeMeta(targetLocale).english;
  const src = {
    title: input.title.trim(),
    short_desc: input.shortDesc.trim(),
    general: input.general.trim(),
    insider_tip: input.insiderTip.trim(),
    section_a: input.sectionA.trim(),
    section_b: input.sectionB.trim(),
    location_text: input.locationText.trim(),
  };
  const userMsg = `Translate these German spot fields into ${langName} and return them via the tool "spot_texts". Keep empty fields empty.\n\n${JSON.stringify(
    src,
    null,
    2,
  )}`;
  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: spotVoice(langName),
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "spot_texts",
              description: `The ${langName} translations of the SalzGuide spot fields.`,
              input_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  short_desc: { type: "string" },
                  general: { type: "string" },
                  insider_tip: { type: "string" },
                  section_a: { type: "string" },
                  section_b: { type: "string" },
                  location_text: { type: "string" },
                },
                required: [
                  "title",
                  "short_desc",
                  "general",
                  "insider_tip",
                  "section_a",
                  "section_b",
                  "location_text",
                ],
              },
            },
          ],
          tool_choice: { type: "tool", name: "spot_texts" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "spot_texts",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return null;
    const keep = (deVal: string, val?: string) => (deVal.trim() ? (val ?? "").trim() : "");
    // targetLocale mitgeben: Chinesisch braucht seinen Strich (破折号), er wird dort
    // nicht gesäubert.
    return stripEmDashFields(
      {
        title: t.title?.trim() || input.title.trim(),
        shortDesc: keep(input.shortDesc, t.short_desc),
        general: keep(input.general, t.general),
        insiderTip: keep(input.insiderTip, t.insider_tip),
        sectionA: keep(input.sectionA, t.section_a),
        sectionB: keep(input.sectionB, t.section_b),
        locationText: keep(input.locationText, t.location_text),
      },
      targetLocale,
    );
  } catch {
    return null;
  }
}

export type TranslateAllResult = {
  ok: boolean;
  translations?: Record<string, SpotTexts>;
  sourceHash?: string; // DE-Hash, aus dem übersetzt wurde (für Aktualitäts-Check)
  failed?: string[];
  error?: string;
};

export async function translateSpotTextsAll(input: SpotTexts): Promise<TranslateAllResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  if (!input.title.trim()) return { ok: false, error: "Bitte zuerst deutsche Texte erstellen." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const targets = routing.locales.filter((l) => l !== "de");
  const results = await Promise.all(
    targets.map(async (l) => [l, await translateSpotTextsTo(input, l, apiKey)] as const),
  );
  const translations: Record<string, SpotTexts> = {};
  const failed: string[] = [];
  for (const [l, tx] of results) {
    if (tx) translations[l] = tx;
    else failed.push(l);
  }
  if (Object.keys(translations).length === 0)
    return { ok: false, error: "Übersetzung fehlgeschlagen – bitte nochmal versuchen." };
  return {
    ok: true,
    translations,
    sourceHash: hashSpotTexts({
      title: input.title,
      shortDesc: input.shortDesc,
      general: input.general,
      insiderTip: input.insiderTip,
      sectionA: input.sectionA,
      sectionB: input.sectionB,
      locationText: input.locationText,
    }),
    failed: failed.length ? failed : undefined,
  };
}

// EINEN Spot „auffüllen": übersetzt NUR die fehlenden ODER veralteten Zielsprachen aus dem
// aktuellen Deutsch (bereits aktuelle Sprachen werden nicht angefasst -> effizient). Für den
// Sammel-Button in der Admin-Liste. Gibt zurück, wie viele Sprachen gefüllt wurden.
export async function fillSpotTranslations(
  spotId: string,
): Promise<{ ok: boolean; filled?: number; failed?: string[]; error?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY fehlt" };

  const { data: rows } = await supabase
    .from("spot_translations")
    .select(
      "lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, source_hash",
    )
    .eq("spot_id", spotId);
  const list = (rows ?? []) as Record<string, string | null>[];
  const de = list.find((r) => r.lang === "de");
  if (!de || !(de.title ?? "").trim()) return { ok: false, error: "no_de" };

  const deTexts: SpotTexts = {
    title: de.title ?? "",
    shortDesc: de.short_desc ?? "",
    general: de.general ?? "",
    insiderTip: de.insider_tip ?? "",
    sectionA: de.section_a ?? "",
    sectionB: de.section_b ?? "",
    locationText: de.location_text ?? "",
  };
  const deHash = hashSpotTexts(deTexts);
  const targets = routing.locales.filter((l) => l !== "de");
  // Nötig, wenn Sprache fehlt (kein Titel) ODER aus einem anderen (alten) Deutsch stammt.
  const needed = targets.filter((l) => {
    const row = list.find((r) => r.lang === l);
    const present = Boolean(row && (row.title ?? "").trim());
    const inSync = Boolean(row && row.source_hash === deHash);
    return !present || !inSync;
  });

  // DE-Zeile in jedem Fall als aktuell markieren (Versionsmarke).
  await supabase
    .from("spot_translations")
    .update({ source_hash: deHash })
    .eq("spot_id", spotId)
    .eq("lang", "de");
  if (needed.length === 0) return { ok: true, filled: 0 };

  const results = await Promise.all(
    needed.map(async (l) => [l, await translateSpotTextsTo(deTexts, l, apiKey)] as const),
  );
  const failed: string[] = [];
  let filled = 0;
  for (const [l, tx] of results) {
    if (!tx) {
      failed.push(l);
      continue;
    }
    const { error } = await supabase.from("spot_translations").upsert(
      {
        spot_id: spotId,
        lang: l,
        title: tx.title.trim() || deTexts.title.trim(),
        short_desc: e(tx.shortDesc),
        general: e(tx.general),
        insider_tip: e(tx.insiderTip),
        section_a: e(tx.sectionA),
        section_b: e(tx.sectionB),
        location_text: e(tx.locationText),
        source_hash: deHash,
      },
      { onConflict: "spot_id,lang" },
    );
    if (error) failed.push(l);
    else filled++;
  }
  return { ok: true, filled, failed: failed.length ? failed : undefined };
}

// Google-Places-Textsuche für den Admin: Ort per Name/Adresse finden und die
// Place ID direkt übernehmen (Places API New, Admin-geschützt).
export type PlaceHit = { id: string; name: string; address: string };

export async function searchPlaces(
  query: string,
): Promise<{ ok: true; results: PlaceHit[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  const q = query.trim();
  if (q.length < 3) return { ok: true, results: [] };
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return { ok: false, error: "GOOGLE_PLACES_KEY fehlt in .env.local" };

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: q, languageCode: "de", regionCode: "AT" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Places-Suche ${res.status}: ${t.slice(0, 120)}` };
    }
    const j = await res.json();
    const results: PlaceHit[] = (Array.isArray(j.places) ? j.places : [])
      .slice(0, 6)
      .map((p: { id: string; displayName?: { text?: string }; formattedAddress?: string }) => ({
        id: p.id,
        name: p.displayName?.text ?? p.id,
        address: p.formattedAddress ?? "",
      }));
    return { ok: true, results };
  } catch {
    return { ok: false, error: "Places-Suche nicht erreichbar" };
  }
}

// ── KI-Chat-Avatar („Toni") setzen/entfernen ────────────────────────────────
// Nur Admin. Es werden NUR unsere eigenen Storage-URLs akzeptiert (kein beliebiger
// externer Link -> kein Fremd-/Tracking-Bild, das im Chat aller Nutzer lädt).
export async function setToniAvatarUrl(
  url: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  const clean = typeof url === "string" && url.trim() ? url.trim() : null;
  if (clean) {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!base || !clean.startsWith(`${base}/storage/v1/object/public/spot-media/`)) {
      return { ok: false, error: "bad_url" };
    }
  }
  const { error } = await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: "toni_avatar_url", value: clean, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

// ── Kategorien (Karussells) verwalten ───────────────────────────────────────
// Verknüpfung Spot↔Kategorie läuft über category_id (uuid), NICHT über den key ->
// Umbenennen (Titel ändern) bricht keine Zuordnungen. Der key ist der stabile,
// interne Matching-Token (Explore-Karussell + KI-Signal) und bleibt beim Bearbeiten
// unverändert.
function slugifyKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export type CategoryInput = {
  id?: string;
  season: "summer" | "winter";
  titles: Record<string, string>;
  sortOrder: number;
};

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, ok: false as const, error: "auth" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { supabase, ok: false as const, error: "forbidden" };
  return { supabase, ok: true as const };
}

export async function saveCategory(
  input: CategoryInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  if (input.season !== "summer" && input.season !== "winter")
    return { ok: false, error: "Ungültige Saison." };
  // Alle unterstützten Sprachen sind Pflicht (sonst fällt die Anzeige auf DE zurück).
  for (const l of routing.locales) {
    if (!(input.titles?.[l] ?? "").trim())
      return { ok: false, error: "Bitte alle Titel (inkl. Übersetzungen) ausfüllen." };
  }
  const de = (input.titles?.de ?? "").trim();

  const titles: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.titles ?? {})) {
    const t = (v ?? "").trim();
    if (t) titles[k] = t;
  }
  titles.de = de;
  const sortOrder = Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0;

  if (input.id) {
    // Bearbeiten: nur Titel + Sortierung (key & Saison bleiben stabil).
    const { error } = await supabase
      .from("categories")
      .update({ title_translations: titles, sort_order: sortOrder })
      .eq("id", input.id);
    if (error) return { ok: false, error: "db" };
    return { ok: true, id: input.id };
  }

  // Neu: eindeutigen key erzeugen (Slug aus dt. Titel), unique pro Saison.
  const base = slugifyKey(de) || "kategorie";
  const { data: existing } = await supabase
    .from("categories")
    .select("key")
    .eq("season", input.season);
  const used = new Set(((existing ?? []) as { key: string }[]).map((r) => r.key));
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}-${n++}`;

  const { data: created, error } = await supabase
    .from("categories")
    .insert({ key, season: input.season, title_translations: titles, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) return { ok: false, error: "db" };
  return { ok: true, id: created.id as string };
}

export async function deleteCategory(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!id) return { ok: false, error: "bad_id" };
  // spot_categories hängt per ON DELETE CASCADE -> Zuordnungen werden mit entfernt.
  const { error } = await gate.supabase.from("categories").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

// Reihenfolge der Kategorien EINER Saison neu setzen. Bekommt die IDs in der neuen
// Reihenfolge und vergibt sort_order = Position (1-basiert). Robust: aktualisiert
// nur Zeilen, deren id UND Saison passen (kein saisonübergreifendes Verrutschen).
export async function reorderCategories(
  season: "summer" | "winter",
  ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (season !== "summer" && season !== "winter")
    return { ok: false, error: "Ungültige Saison." };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "bad_input" };
  for (let i = 0; i < ids.length; i++) {
    const { error } = await gate.supabase
      .from("categories")
      .update({ sort_order: i + 1 })
      .eq("id", ids[i])
      .eq("season", season);
    if (error) return { ok: false, error: "db" };
  }
  return { ok: true };
}

// KI-Übersetzung des Kategorie-Titels in alle Nicht-DE-Sprachen (aktuell: en).
// Extensibel: nutzt routing.locales -> kommen neue Sprachen dazu, werden sie mitübersetzt.
export async function translateCategoryTitle(
  de: string,
): Promise<{ ok: boolean; error?: string; translations?: Record<string, string> }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const text = (de ?? "").trim();
  if (!text) return { ok: false, error: "Bitte zuerst den deutschen Titel eingeben." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY fehlt" };

  const targets = routing.locales.filter((l) => l !== "de");
  if (!targets.length) return { ok: true, translations: {} };

  const props: Record<string, { type: string; description: string }> = {};
  for (const l of targets) props[l] = { type: "string", description: `Kurzer Titel in Locale '${l}'` };

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          system:
            "Du übersetzt KURZE Titel von Kategorie-Karussells einer Salzburg-Reise-App. Halte sie knapp, natürlich und im gleichen lockeren Stil (keine Wort-für-Wort-Übersetzung). Gib die Übersetzungen NUR über das Tool zurück.",
          messages: [
            {
              role: "user",
              content: `Deutscher Titel: „${text}". Übersetze in die Zielsprachen und gib sie über das Tool 'category_titles' zurück.`,
            },
          ],
          tools: [
            {
              name: "category_titles",
              description: "Übersetzte Kategorie-Titel je Locale.",
              input_schema: { type: "object", properties: props, required: targets },
            },
          ],
          tool_choice: { type: "tool", name: "category_titles" },
        }),
      },
      1,
      20000,
    );
    if (!res.ok) return { ok: false, error: "ai" };
    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };
    const tool = (json.content ?? []).find(
      (b) => b.type === "tool_use" && b.name === "category_titles",
    );
    if (!tool?.input) return { ok: false, error: "empty" };
    const translations: Record<string, string> = {};
    for (const l of targets) {
      const v = tool.input[l];
      if (typeof v === "string" && v.trim()) translations[l] = v.trim();
    }
    return { ok: true, translations };
  } catch {
    return { ok: false, error: "ai" };
  }
}

// EINE Kategorie „auffüllen": übersetzt NUR die FEHLENDEN Zielsprachen aus dem deutschen Titel
// (bestehende bleiben unangetastet). Kategorien haben kein source_hash -> nur „fehlt" wird
// erkannt (typischer Fall: eine neue Sprache kam dazu). Für den Sammel-Button.
export async function fillCategoryTranslations(
  categoryId: string,
): Promise<{ ok: boolean; filled?: number; failed?: string[]; error?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const { data } = await supabase
    .from("categories")
    .select("title_translations")
    .eq("id", categoryId)
    .maybeSingle();
  if (!data) return { ok: false, error: "not_found" };
  const titles = { ...((data.title_translations as Record<string, string> | null) ?? {}) };
  const de = (titles.de ?? "").trim();
  if (!de) return { ok: false, error: "no_de" };

  const targets = routing.locales.filter((l) => l !== "de");
  const needed = targets.filter((l) => !(titles[l] ?? "").trim());
  if (needed.length === 0) return { ok: true, filled: 0 };

  // Wiederverwendung: übersetzt den DE-Titel in alle Ziele (ein kurzer Call); wir übernehmen
  // aber NUR die fehlenden Sprachen (bestehende Handkorrekturen bleiben erhalten).
  const tr = await translateCategoryTitle(de);
  if (!tr.ok || !tr.translations) return { ok: false, error: tr.error ?? "ai" };

  let filled = 0;
  const failed: string[] = [];
  for (const l of needed) {
    const v = (tr.translations[l] ?? "").trim();
    if (v) {
      titles[l] = v;
      filled++;
    } else failed.push(l);
  }
  if (filled === 0) return { ok: false, error: "ai", failed };

  const { error } = await supabase
    .from("categories")
    .update({ title_translations: titles })
    .eq("id", categoryId);
  if (error) return { ok: false, error: "db" };
  return { ok: true, filled, failed: failed.length ? failed : undefined };
}

// ── Locals (Insider-Tipp-Empfehlende: Name + Foto + mehrsprachige Rolle) ──────
export type LocalInput = {
  id?: string;
  name: string;
  role: string; // deutsche Basis-Rolle (z.B. „Local aus Salzburg")
  roleI18n: Record<string, string>; // alle Locales (inkl. de); de wird aus role abgeleitet
  avatarUrl: string | null;
};

export async function saveLocal(
  input: LocalInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Bitte einen Namen eingeben." };
  const role = (input.role ?? "").trim();

  const avatar = spotMediaUrl(input.avatarUrl);
  if (!avatar.ok) return { ok: false, error: "bad_url" };

  // role_i18n bereinigen: nur Nicht-DE mit Inhalt (Deutsch steckt in der Spalte `role`).
  const i18n: Record<string, string> = {};
  for (const l of routing.locales) {
    if (l === "de") continue;
    const v = (input.roleI18n?.[l] ?? "").trim();
    if (v) i18n[l] = v;
  }

  const baseRow = { name, role: role || null, avatar_url: avatar.url };
  let localId = input.id;
  if (localId) {
    const { error } = await supabase.from("locals").update(baseRow).eq("id", localId);
    if (error)
      return { ok: false, error: error.code === "23505" ? "Name schon vergeben." : "db" };
  } else {
    const { data, error } = await supabase.from("locals").insert(baseRow).select("id").single();
    if (error)
      return { ok: false, error: error.code === "23505" ? "Name schon vergeben." : "db" };
    localId = data.id as string;
  }
  if (!localId) return { ok: false, error: "db" };

  // Rollen-Übersetzungen fehlertolerant setzen (Migration 0033; Spalte evtl. noch nicht da).
  const { error: ri } = await supabase
    .from("locals")
    .update({ role_i18n: i18n })
    .eq("id", localId);
  if (ri) console.warn("locals.role_i18n übersprungen – Migration 0033 nötig?", ri.message);

  return { ok: true, id: localId };
}

export async function deleteLocal(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!id) return { ok: false, error: "bad_id" };
  // Wird der Local noch bei Spots verwendet? Dann NICHT löschen (kein stiller Datenverlust).
  const { count } = await gate.supabase
    .from("spots")
    .select("id", { count: "exact", head: true })
    .eq("local_id", id);
  if ((count ?? 0) > 0) return { ok: false, error: `in_use:${count}` };
  const { error } = await gate.supabase.from("locals").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

// KI-Übersetzung der Local-Rolle in alle Nicht-DE-Sprachen (extensibel über routing.locales).
export async function translateLocalRole(
  de: string,
): Promise<{ ok: boolean; error?: string; translations?: Record<string, string> }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const text = (de ?? "").trim();
  if (!text) return { ok: false, error: "Bitte zuerst die deutsche Rolle eingeben." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY fehlt" };

  const targets = routing.locales.filter((l) => l !== "de");
  if (!targets.length) return { ok: true, translations: {} };

  const props: Record<string, { type: string; description: string }> = {};
  for (const l of targets) props[l] = { type: "string", description: `Rolle in Locale '${l}'` };

  try {
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 400,
          system:
            "Du übersetzt eine KURZE Rolle/Bezeichnung eines Locals (Einheimischer, der einen Insider-Tipp gibt) einer Salzburg-Reise-App, z.B. 'Local aus Salzburg', 'Bergführerin', 'Kaffee-Nerd'. Kurz, natürlich, gleicher lockerer Ton – keine Wort-für-Wort-Übersetzung. Eigennamen/Ortsnamen behalten. Gib die Übersetzungen NUR über das Tool zurück.",
          messages: [
            {
              role: "user",
              content: `Deutsche Rolle: „${text}". Übersetze in die Zielsprachen und gib sie über das Tool 'local_roles' zurück.`,
            },
          ],
          tools: [
            {
              name: "local_roles",
              description: "Übersetzte Local-Rolle je Locale.",
              input_schema: { type: "object", properties: props, required: targets },
            },
          ],
          tool_choice: { type: "tool", name: "local_roles" },
        }),
      },
      1,
      20000,
    );
    if (!res.ok) return { ok: false, error: "ai" };
    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };
    const tool = (json.content ?? []).find(
      (b) => b.type === "tool_use" && b.name === "local_roles",
    );
    if (!tool?.input) return { ok: false, error: "empty" };
    const translations: Record<string, string> = {};
    for (const l of targets) {
      const v = tool.input[l];
      if (typeof v === "string" && v.trim()) translations[l] = v.trim();
    }
    return { ok: true, translations };
  } catch {
    return { ok: false, error: "ai" };
  }
}

// Welche Spots auf der Startseite gezeigt werden, in welcher Reihenfolge.
// `slugs` ist die gewünschte Reihenfolge; Position 1 = erste Karte.
//
// 🔒 Drei Dinge, die hier bewusst passieren:
//  1. Die Rangfolge wird SERVERSEITIG aus der Array-Position vergeben (1..n), nicht vom
//     Client übernommen. So kann kein doppelter oder krummer Rang entstehen.
//  2. Es werden nur freie, veröffentlichte Spots akzeptiert — was der Client sonst noch
//     schickt, fliegt raus. Bei Pro-Spots verlässt das Foto den Server nie; eine
//     gefeaturedte Pro-Karte wäre leer oder ein Leak.
//  3. Erst wird ALLES zurückgesetzt, dann neu gesetzt. Ohne den Reset bliebe ein
//     abgewählter Spot mit seinem alten Rang stehen und stünde weiter auf der Startseite.
export async function saveHomeFeatured(
  slugs: string[],
): Promise<{ ok: boolean; error?: string; saved?: number }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!Array.isArray(slugs)) return { ok: false, error: "Ungültige Auswahl." };
  if (slugs.length > MAX_HOME_FEATURED)
    return { ok: false, error: `Höchstens ${MAX_HOME_FEATURED} Spots auf der Startseite.` };

  const svc = createServiceClient();

  // Nur das durchlassen, was wirklich frei und veröffentlicht ist. Der Client könnte
  // veraltete oder manipulierte Slugs schicken.
  const wanted = [...new Set(slugs)];
  const { data: valid, error: checkErr } = await svc
    .from("spots")
    .select("slug")
    .in("slug", wanted.length ? wanted : ["__none__"])
    .eq("status", "published")
    .eq("is_pro", false);
  if (checkErr) return { ok: false, error: checkErr.message };

  const allowed = new Set((valid ?? []).map((s) => s.slug as string));
  const ordered = wanted.filter((s) => allowed.has(s));

  // Alles abräumen — auch die, die gerade nicht in `wanted` stehen.
  const { error: clearErr } = await svc
    .from("spots")
    .update({ home_rank: null })
    .not("home_rank", "is", null);
  if (clearErr) return { ok: false, error: clearErr.message };

  // Neu vergeben, Position = Rang.
  for (const [i, slug] of ordered.entries()) {
    const { error } = await svc
      .from("spots")
      .update({ home_rank: i + 1 })
      .eq("slug", slug);
    if (error) return { ok: false, error: error.message };
  }

  // Die Startseite ist statisch gerendert -> ohne revalidate bliebe die alte Auswahl
  // stehen, und im Admin sähe alles richtig aus. Genau die Sorte Fehler, die man erst
  // Wochen später bemerkt.
  for (const l of routing.locales) revalidatePath(`/${l}`);

  return { ok: true, saved: ordered.length };
}

// ---------------------------------------------------------------------------
// Startseite: Texte pflegen und übersetzen (home_content, Migration 0036)
// ---------------------------------------------------------------------------

// Deutsche Texte der Startseite speichern.
//
// Der source_hash wird bewusst NICHT mitgeschrieben: Er markiert den Stand, zu dem zuletzt
// übersetzt wurde. Bleibt er stehen, während sich Deutsch ändert, weicht er ab und der
// Admin zeigt „veraltet" — genau das ist der Sinn. Würde man ihn hier mit-aktualisieren,
// wären die Übersetzungen für immer scheinbar aktuell.
export async function saveHomeTexts(
  texts: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!texts || typeof texts !== "object") return { ok: false, error: "Ungültige Texte." };

  // Nur bekannte Keys durchlassen: Was der Client sonst schickt, hätte auf der Seite
  // ohnehin keinen Platz und würde nur die Zeile aufblähen.
  const clean: Record<string, string> = {};
  for (const k of HOME_KEYS) {
    const v = texts[k];
    if (typeof v === "string") clean[k] = v.trim();
  }

  // Gedankenstrich raus, auch wenn ein Mensch getippt hat: Die Regel gilt für die Seite,
  // nicht für ihre Herkunft (brand-voice.ts). Beim Einfügen aus einem KI-Chat käme er
  // sonst durch die Hintertür wieder rein.
  const cleaned = stripEmDashFields(clean, "de");

  const svc = createServiceClient();
  const { error } = await svc
    .from("home_content")
    .update({ texts: cleaned, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };

  // Die Startseite ist statisch gerendert -> ohne revalidate bliebe der alte Text stehen,
  // und im Admin sähe alles richtig aus. Alle Sprachen, weil jede die deutschen Texte als
  // Auffangnetz nutzt (siehe home-content.ts).
  for (const l of routing.locales) revalidatePath(`/${l}`);
  return { ok: true };
}

// „In alle Sprachen übersetzen": Deutsch -> alle Ziel-Locales, in einem Rutsch.
// Schreibt die Übersetzungen UND den source_hash des Standes, der übersetzt wurde.
export async function fillHomeTranslations(): Promise<{
  ok: boolean;
  error?: string;
  failed?: string[];
  rejected?: string[];
}> {
  const gate = await assertAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY fehlt." };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("home_content")
    .select("texts")
    .eq("id", 1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const de = (data?.texts ?? {}) as Record<string, string>;
  if (!Object.values(de).some((v) => (v ?? "").trim()))
    return { ok: false, error: "Erst die deutschen Texte speichern." };

  const res = await translateHomeTextsWith(de, apiKey);
  if (!res.ok || !res.translations)
    return { ok: false, error: res.error === "empty" ? "Keine Texte." : "Übersetzung fehlgeschlagen." };

  const { error: upErr } = await svc
    .from("home_content")
    .update({
      translations: res.translations,
      // Marke des Standes, der übersetzt wurde. Ändert Anton danach ein Wort, weicht sie ab.
      source_hash: res.sourceHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (upErr) return { ok: false, error: upErr.message };

  for (const l of routing.locales) revalidatePath(`/${l}`);
  return { ok: true, failed: res.failed, rejected: res.rejected };
}
