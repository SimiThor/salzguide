"use server";

import { createServiceClient } from "./supabase/service";
import { viewerCanSeePro } from "./spots";
import { fetchWithRetry } from "./ai-fetch";
import { saveUserTour } from "./user-tours";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { pickLabel, AUDIO_WALK_FALLBACK } from "./i18n-labels";
import type { TourDetail, TourStopView } from "./tour-types";

// KI-Runden-Generator (Schritt 3): aus den Interessen des Nutzers wählt Claude
// passende POOL-Punkte eines Gebiets, Mapbox baut daraus die effiziente Geh-RUNDE
// ab dem fixen Gebiets-Startpunkt (z.B. Mirabellplatz) zurück zum Start. Ergebnis ist
// EPHEMER (nicht gespeichert) und wird als TourDetail zurückgegeben (Teaser/Pro-Gating
// + Signed-URLs wie überall). Bauen ist gratis; die ersten Stops sind gratis, Rest Pro.

const DE = "de";
const GENERATED_FREE_STOPS = 2; // Teaser: erste 2 Stops gratis anhörbar

type Cand = {
  id: string;
  lat: number;
  lng: number;
  kind: string | null;
  tags: string[];
  emoji: string | null;
  title: string;
  img: string | null;
};
type LngLat = { lat: number; lng: number };

export type GenerateInput = {
  areaId: string;
  interests: string[]; // gewählte Interessen-Labels
  freeText: string;
  maxStops?: number;
  locale: string;
};

export async function generateTour(
  input: GenerateInput,
): Promise<{ ok: boolean; tour?: TourDetail; id?: string; error?: string }> {
  // Volle Locale nutzen (nicht auf en/de stauchen) – so werden Titel & Audio der Punkte in der
  // gewählten Sprache geladen; unbekannte Werte fallen sicher auf Deutsch zurück.
  const locale = (routing.locales as readonly string[]).includes(input.locale)
    ? input.locale
    : DE;
  const canSeePro = await viewerCanSeePro();
  const supabase = createServiceClient();

  // 1) Gebiet + Startpunkt
  const { data: areaRow } = await supabase
    .from("tour_areas")
    .select("id, start_lat, start_lng, tour_area_translations(lang, name)")
    .eq("id", input.areaId)
    .eq("status", "published")
    .maybeSingle();
  if (!areaRow) return { ok: false, error: "area" };
  const area = areaRow as unknown as Record<string, unknown>;
  const startLat = area.start_lat as number | null;
  const startLng = area.start_lng as number | null;
  if (startLat == null || startLng == null) return { ok: false, error: "no_start" };
  const start: LngLat = { lat: startLat, lng: startLng };
  const areaTrs = (area.tour_area_translations as { lang: string; name: string }[] | null) ?? [];
  const areaName =
    areaTrs.find((r) => r.lang === locale)?.name ??
    areaTrs.find((r) => r.lang === DE)?.name ??
    "";

  // 2) Kandidaten: veröffentlichte Punkte mit Geo UND Audio.
  const { data: pointRows } = await supabase
    .from("tour_points")
    .select(
      "id, lat, lng, kind, tags, emoji, image_url, tour_point_translations(lang, title), tour_point_audio(lang)",
    )
    .eq("area_id", input.areaId)
    .eq("status", "published");
  const candidates: Cand[] = ((pointRows as unknown as Record<string, unknown>[]) ?? [])
    .filter((p) => {
      const hasGeo = p.lat != null && p.lng != null;
      const hasAudio = ((p.tour_point_audio as unknown[] | null) ?? []).length > 0;
      return hasGeo && hasAudio;
    })
    .map((p) => {
      const trs = (p.tour_point_translations as { lang: string; title: string }[] | null) ?? [];
      const tr = trs.find((r) => r.lang === locale) ?? trs.find((r) => r.lang === DE) ?? trs[0];
      return {
        id: p.id as string,
        lat: p.lat as number,
        lng: p.lng as number,
        kind: (p.kind as string | null) ?? null,
        tags: (p.tags as string[] | null) ?? [],
        emoji: (p.emoji as string | null) ?? null,
        title: tr?.title ?? "",
        img: (p.image_url as string | null) ?? null,
      };
    });
  if (candidates.length < 2) return { ok: false, error: "too_few" };

  // 3) Claude wählt eine passende, machbare Teilmenge (nie zu viele).
  const maxStops = Math.max(3, Math.min(input.maxStops ?? 6, 8, candidates.length));
  const interestText = [input.interests.join(", "), input.freeText.trim()]
    .filter((s) => s && s.trim())
    .join(" · ");
  const picked = await selectPoints(candidates, interestText, maxStops, locale);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let chosen = (picked?.ids ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is Cand => Boolean(c))
    .slice(0, maxStops);
  if (chosen.length < 2) {
    // Fallback: einfach die ersten Kandidaten (nie leer ausliefern).
    chosen = candidates.slice(0, maxStops);
  }

  // 4) Mapbox: optimale Geh-Runde ab Start, zurück zum Start.
  const optimized = await optimizeLoop(start, chosen);
  const ordered = optimized.order;

  // 5) Audio der gewählten Punkte laden, gaten, signieren.
  const chosenIdsFinal = ordered.map((c) => c.id);
  const audioByPoint = new Map<string, { url: string | null; text: string | null; dur: number | null }>();
  {
    const { data: audioRows } = await supabase
      .from("tour_point_audio")
      .select("point_id, lang, audio_url, audio_text, duration_sec")
      .in("point_id", chosenIdsFinal);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const a of (audioRows as Record<string, unknown>[] | null) ?? []) {
      const pid = a.point_id as string;
      const list = grouped.get(pid) ?? [];
      list.push(a);
      grouped.set(pid, list);
    }
    for (const [pid, list] of grouped) {
      // Sprache des Nutzers bevorzugen – ABER nur, wenn sie wirklich VERTONT ist (audio_url).
      // Sonst deutsche Vertonung (Text + Stimme als Paar). Verhindert Stille, wenn eine Sprache
      // zwar übersetzt, aber noch nicht vertont wurde. Reine Text-Zeilen sind nur letzte Wahl.
      const voiced = (l: string) => list.find((x) => x.lang === l && Boolean(x.audio_url));
      const a =
        voiced(locale) ??
        voiced(DE) ??
        list.find((x) => x.lang === locale) ??
        list.find((x) => x.lang === DE) ??
        list[0];
      audioByPoint.set(pid, {
        url: (a?.audio_url as string | null) ?? null,
        text: (a?.audio_text as string | null) ?? null,
        dur: (a?.duration_sec as number | null) ?? null,
      });
    }
  }

  const prelim = ordered.map((p, i) => {
    const audio = audioByPoint.get(p.id) ?? { url: null, text: null, dur: null };
    const locked = i >= GENERATED_FREE_STOPS && !canSeePro;
    return { p, audio, locked, order: i + 1 };
  });

  const signed = new Map<string, string>();
  const toSign = [
    ...new Set(prelim.filter((x) => !x.locked && x.audio.url).map((x) => x.audio.url as string)),
  ];
  if (toSign.length) {
    const { data: signedList } = await supabase.storage
      .from("tour-audio")
      .createSignedUrls(toSign, 60 * 60 * 2);
    for (const s of signedList ?? []) {
      if (!s.error && s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
  }

  const stops: TourStopView[] = prelim.map((x) => ({
    spotSlug: x.p.id,
    order: x.order,
    title: x.p.title,
    shortDesc: null,
    emoji: x.p.emoji,
    // Bild ist öffentlicher Teaser, auch bei locked (0029) – nur Audio ist Pro.
    imageUrl: x.p.img,
    lat: x.p.lat,
    lng: x.p.lng,
    locked: x.locked,
    audioUrl: x.locked || !x.audio.url ? null : (signed.get(x.audio.url) ?? null),
    audioText: x.locked ? null : x.audio.text,
    durationSec: x.locked ? null : x.audio.dur,
  }));

  // Dauer ≈ Geh-Zeit (Mapbox) + ~2 Min je Stop (Zuhören/Stehen).
  const walkMin = optimized.durationS != null ? Math.round(optimized.durationS / 60) : null;
  const durationMin = walkMin != null ? walkMin + stops.length * 2 : null;
  const distanceKm =
    optimized.distanceM != null ? Math.round(optimized.distanceM / 100) / 10 : null;

  const fallbackName = pickLabel(AUDIO_WALK_FALLBACK, locale);
  const routeName = (picked?.name ?? "").trim() || fallbackName;
  const routeEmoji = (picked?.emoji ?? "").trim() || "🎧";

  const tour: TourDetail = {
    slug: "generated",
    region: "",
    emoji: routeEmoji,
    coverUrl: null,
    title: routeName,
    subtitle: areaName || null,
    description: null,
    stopCount: stops.length,
    isPro: true,
    freeStops: GENERATED_FREE_STOPS,
    durationMin,
    distanceKm,
    stops,
    canSeePro,
    routeGeo: optimized.geo,
    start,
  };

  // Automatisch für den (eingeloggten) User speichern – kein Extra-Klick nötig.
  // saveUserTour prüft selbst die Anmeldung; nicht eingeloggt -> kein id (Fallback:
  // ephemere Anzeige, sollte aber durch das Login-Gate der Seite nicht vorkommen).
  const saved = await saveUserTour({
    areaId: input.areaId,
    name: routeName,
    emoji: routeEmoji,
    interests: [
      ...input.interests,
      ...(input.freeText.trim() ? [input.freeText.trim()] : []),
    ],
    pointIds: chosenIdsFinal,
    routeGeo: optimized.geo,
    start,
    distanceKm,
    durationMin,
  });

  return { ok: true, tour, id: saved.ok ? saved.id : undefined };
}

// ── Claude-Auswahl + cooler Name (EIN forced-tool-Call, keine Extra-Kosten) ──
type PickResult = { ids: string[]; name: string; emoji: string };
async function selectPoints(
  candidates: Cand[],
  interests: string,
  maxStops: number,
  locale: string,
): Promise<PickResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const nameLang = localeMeta(locale).english; // Runden-Name in der Sprache des Nutzers
  const list = candidates
    .slice(0, 60)
    .map((c) => ({ id: c.id, title: c.title, tags: c.tags, kind: c.kind ?? undefined }));
  const system = `Du stellst aus einem Pool von Audio-Tour-Punkten eine stimmige, MACHBARE Geh-Runde zusammen, passend zu den Interessen des Nutzers, und gibst ihr einen coolen Namen.
Regeln:
- Wähle 4–${maxStops} Punkte (NIE mehr als ${maxStops}). Lieber wenige, gute Stops als eine Überforderung.
- Gib NUR IDs aus der Liste zurück (exakt kopiert). Erfinde nichts.
- Match über Tags/Typ/Titel zu den Interessen. Gibt es wenig Passendes, wähle trotzdem eine schöne, abwechslungsreiche Mischung.
- Reihenfolge egal (die optimale Route wird danach berechnet).
- NAME: kurz (max ~4 Wörter), cool und konkret, im Stil unserer Zielgruppe (junge Locals & junge Reisende). ANTI-Kitsch: keine Wörter wie „bezaubernd", „traumhaft", „versteckte Perle", „magisch". Kein Doppelpunkt-Klischee. Sprache des Namens: ${nameLang}.
- EMOJI: genau EIN passendes Emoji zur Runde.`;
  const userMsg = `Interessen: ${interests || "(keine speziellen – allgemein spannende Mischung)"}\n\nPool (JSON):\n${JSON.stringify(list)}\n\nGib Auswahl + Name + Emoji über das Tool "build_route" zurück.`;
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
          max_tokens: 500,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "build_route",
              description: "Die gewählten Punkt-IDs plus cooler Name + Emoji für die Runde.",
              input_schema: {
                type: "object",
                properties: {
                  ids: { type: "array", items: { type: "string" } },
                  name: { type: "string", description: "Kurzer, cooler Runden-Name." },
                  emoji: { type: "string", description: "Ein passendes Emoji." },
                },
                required: ["ids", "name"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "build_route" },
        }),
      },
      2,
      45000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "build_route",
    ) as { input?: { ids?: unknown; name?: unknown; emoji?: unknown } } | undefined;
    const ids = block?.input?.ids;
    if (!Array.isArray(ids)) return null;
    return {
      ids: ids.filter((x): x is string => typeof x === "string"),
      name: typeof block?.input?.name === "string" ? block.input.name : "",
      emoji: typeof block?.input?.emoji === "string" ? block.input.emoji : "",
    };
  } catch {
    return null;
  }
}

// ── Mapbox Optimized-Trips: Geh-Runde ab Start (roundtrip) ────────────────────
async function optimizeLoop(
  start: LngLat,
  points: Cand[],
): Promise<{ order: Cand[]; geo: [number, number][] | null; distanceM: number | null; durationS: number | null }> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const coords = [start, ...points.map((p) => ({ lat: p.lat, lng: p.lng }))];
  if (!token || coords.length < 2 || coords.length > 12) {
    return { order: nearestNeighbor(start, points), geo: null, distanceM: null, durationS: null };
  }
  const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(";");
  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/walking/${coordStr}?roundtrip=true&source=first&geometries=geojson&overview=full&access_token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    if (j.code !== "Ok" || !Array.isArray(j.trips) || !j.trips.length) throw new Error("no trip");
    const trip = j.trips[0];
    const wps = (j.waypoints as { waypoint_index: number }[]) ?? [];
    // Input-Index 0 = Start; 1..N = Punkte -> Punkte nach ihrem waypoint_index sortieren.
    const order = points
      .map((p, i) => ({ p, wi: wps[i + 1]?.waypoint_index ?? i + 1 }))
      .sort((a, b) => a.wi - b.wi)
      .map((x) => x.p);
    const geo = (trip.geometry?.coordinates as [number, number][] | undefined) ?? null;
    return {
      order,
      geo,
      distanceM: typeof trip.distance === "number" ? trip.distance : null,
      durationS: typeof trip.duration === "number" ? trip.duration : null,
    };
  } catch {
    return { order: nearestNeighbor(start, points), geo: null, distanceM: null, durationS: null };
  }
}

// Greedy Nearest-Neighbor ab Start (Fallback, falls Mapbox nicht verfügbar).
function nearestNeighbor(start: LngLat, points: Cand[]): Cand[] {
  const remaining = [...points];
  const order: Cand[] = [];
  let cur: LngLat = start;
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dx = cur.lng - remaining[i].lng;
      const dy = cur.lat - remaining[i].lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const [p] = remaining.splice(best, 1);
    order.push(p);
    cur = p;
  }
  return order;
}
