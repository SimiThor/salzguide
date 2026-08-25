"use server";

import { fetchWithRetry } from "./ai-fetch";
import { stripEmDashFields } from "./em-dash";
import { requireAdmin } from "./admin-guard";
import { slugifyKey } from "./slug";
import { guardStorageUrl } from "./storage-guard";
import { hashTourTexts, translationsPublishable } from "./spot-hash";
import { cleanRouteGeo, tourRouteHash, type RoutePoint } from "./tour-route";
import type { TourMode } from "./tour-mode";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";

// Server-Actions für Audio-Touren. Muster wie admin-actions.ts:
// - jede Action beginnt mit requireAdmin() aus lib/admin-guard (Defense-in-depth zur RLS)
// - Writes über den SESSION-Client (läuft als eingeloggter Admin; RLS tours_admin_all /
//   spot_audio_admin_all erlauben es)
// - kein revalidatePath (gibt es repo-weit nicht) -> Client ruft router.refresh()
// - slugifyKey/guardStorageUrl kommen aus lib/slug.ts bzw. lib/storage-guard.ts

const e = (v: string) => (v.trim() === "" ? null : v.trim());

// Zielsprachen = alle ausser Deutsch (zentrale Quelle: src/i18n/locales.ts).
const TOUR_TARGET_LOCALES = routing.locales.filter((l) => l !== "de");

// Ein Stop einer kuratierten Runde = ein POOL-PUNKT (tour_points). Audio/Text gehört
// zum Punkt (im Punkt-Editor gepflegt), nicht zur Tour.
export type TourStopInput = { pointId: string };

export type TourTexts = { title: string; subtitle: string; description: string };

export type TourInput = {
  id?: string;
  areaId: string | null;
  emoji: string;
  coverUrl: string | null;
  isPro: boolean;
  freeStops: number;
  status: "draft" | "published";
  // Fortbewegungsart (0064). "bike" schaltet den eigenen Navigations-Screen frei.
  mode: TourMode;
  durationMin: number | null;
  distanceKm: number | null;
  de: TourTexts;
  // Alle weiteren Sprachen (Muster wie Punkte/Gebiete): eine Zeile je Sprache,
  // Deutsch bleibt die Quelle, translationsSourceHash markiert deren Stand.
  translations: Record<string, TourTexts>;
  translationsSourceHash?: string;
  start: RoutePoint | null;
  end: RoutePoint | null;
  routeGeo: [number, number][] | null;
  routeHash: string | null;
  stops: TourStopInput[];
};

export type TourSaveResult = { ok: boolean; id?: string; error?: string };

export async function saveTour(input: TourInput): Promise<TourSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const de = stripEmDashFields(
    {
      title: input.de.title.trim(),
      subtitle: input.de.subtitle.trim(),
      description: input.de.description.trim(),
    },
    "de",
  );
  const deTitle = de.title;
  if (!deTitle) return { ok: false, error: "required" };

  // Übersetzungen säubern (Gedankenstrich sprachbewusst, Chinesisch behält seinen).
  const trClean: Record<string, TourTexts> = {};
  for (const l of TOUR_TARGET_LOCALES) {
    const tx = input.translations?.[l];
    if (!tx) continue;
    const cleaned = stripEmDashFields(
      {
        title: (tx.title ?? "").trim(),
        subtitle: (tx.subtitle ?? "").trim(),
        description: (tx.description ?? "").trim(),
      },
      l,
    );
    if ([cleaned.title, cleaned.subtitle, cleaned.description].some((v) => v !== ""))
      trClean[l] = cleaned;
  }

  // VERÖFFENTLICHEN nur mit vollständigen UND aktuellen Übersetzungen (Anti-Chaos-Gate
  // wie bei Spots, Events und Punkten). Als Entwurf speichern ist immer erlaubt – sonst
  // könnte man eine Runde nicht anlegen, ohne sie in einem Rutsch fertig zu übersetzen.
  const deHash = hashTourTexts(de);
  if (
    input.status === "published" &&
    !translationsPublishable(trClean, input.translationsSourceHash, deHash, TOUR_TARGET_LOCALES)
  )
    return { ok: false, error: "translations_incomplete" };

  const cover = guardStorageUrl(input.coverUrl);
  if (!cover.ok) return { ok: false, error: "bad_url" };
  const freeStops = Number.isFinite(input.freeStops)
    ? Math.max(0, Math.floor(input.freeStops))
    : 0;

  // Stops = geordnete Pool-Punkte (dedupe, Reihenfolge = Index). Audio/Text gehören
  // zum Punkt und werden hier NICHT geschrieben.
  const seen = new Set<string>();
  const pointIds: string[] = [];
  for (const s of input.stops) {
    if (s.pointId && !seen.has(s.pointId)) {
      seen.add(s.pointId);
      pointIds.push(s.pointId);
    }
  }

  // Stationen VOR jedem Write prüfen (danach wäre die Tour schon halb geschrieben):
  // 1. Jede Station muss existieren und zum gewählten Gebiet gehören. Der Stationen-
  //    Picker kann bei schnellem Gebiet-Wechsel noch Punkte des ALTEN Gebiets anbieten
  //    (Race im Formular) – ohne diesen Check landete die Inkonsistenz in der DB.
  // 2. Publish-Gate: Live gehen darf eine Tour nur mit mindestens einem
  //    VERÖFFENTLICHTEN Punkt. Sonst erschiene sie öffentlich mit 0 Stationen
  //    (getPublishedTours filtert Entwurfs-Punkte raus).
  let publishedStops = 0;
  if (pointIds.length) {
    const { data: pts, error: ptsErr } = await supabase
      .from("tour_points")
      .select("id, area_id, status")
      .in("id", pointIds);
    if (ptsErr) return { ok: false, error: "db" };
    const byId = new Map(
      ((pts ?? []) as { id: string; area_id: string | null; status: string }[]).map((p) => [
        p.id,
        p,
      ]),
    );
    for (const pid of pointIds) {
      const p = byId.get(pid);
      if (!p) return { ok: false, error: "points_area_mismatch" };
      if (input.areaId && p.area_id !== input.areaId)
        return { ok: false, error: "points_area_mismatch" };
    }
    publishedStops = [...byId.values()].filter((p) => p.status === "published").length;
  }
  const wantsPublish = input.status === "published";
  if (wantsPublish && publishedStops === 0)
    return { ok: false, error: "no_published_stops" };

  const row = {
    area_id: input.areaId ?? null,
    region: "stadt-salzburg", // vestigial (Gebiet ersetzt Region); Spalte bleibt NOT-NULL-frei
    emoji: e(input.emoji),
    cover_url: cover.url,
    is_pro: Boolean(input.isPro),
    free_stops: freeStops,
    status: input.status === "published" ? "published" : "draft",
    mode: input.mode === "bike" ? "bike" : "walk",
    duration_min:
      input.durationMin != null && Number.isFinite(input.durationMin)
        ? Math.max(0, Math.floor(input.durationMin))
        : null,
    distance_km:
      input.distanceKm != null && Number.isFinite(input.distanceKm)
        ? Math.max(0, input.distanceKm)
        : null,
  };

  const createdNew = !input.id;
  let tourId = input.id;
  if (tourId) {
    const { error } = await supabase.from("tours").update(row).eq("id", tourId);
    if (error) return { ok: false, error: "db" };
  } else {
    const base = slugifyKey(deTitle) || "tour";
    const { data: existing, error: slugErr } = await supabase.from("tours").select("slug"); // GLOBAL unique
    if (slugErr) return { ok: false, error: "db" };
    const used = new Set(((existing ?? []) as { slug: string }[]).map((r) => r.slug));
    // Insert mit Retry bei Unique-Kollision (TOCTOU-Race zwischen SELECT und INSERT).
    for (let attempt = 0; attempt < 6 && !tourId; attempt++) {
      let slug = base;
      let n = 2;
      while (used.has(slug)) slug = `${base}-${n++}`;
      const { data, error } = await supabase
        .from("tours")
        .insert({ ...row, slug })
        .select("id")
        .single();
      if (!error && data) {
        tourId = (data as { id: string }).id;
      } else if (error && (error as { code?: string }).code === "23505") {
        used.add(slug); // Slug inzwischen vergeben -> nächsten Suffix probieren
      } else {
        return { ok: false, error: "db" };
      }
    }
  }
  if (!tourId) return { ok: false, error: "db" };

  // Bricht bei einem Folgefehler ab und räumt eine gerade NEU angelegte Tour wieder
  // weg -> keine Waisen-/Duplikat-Touren (saveTour ist nicht transaktional).
  const abort = async (err: string): Promise<TourSaveResult> => {
    if (createdNew && tourId) await supabase.from("tours").delete().eq("id", tourId);
    return { ok: false, error: err };
  };

  // Übersetzungen: Deutsch ist die Quelle, jede Zielsprache eine eigene Zeile.
  // Sprache ohne Inhalt -> Zeile löschen, damit kein leerer Rest stehen bleibt
  // (gleiches Muster wie saveArea/savePoint).
  const { error: eDe } = await supabase.from("tour_translations").upsert(
    {
      tour_id: tourId,
      lang: "de",
      title: deTitle,
      subtitle: e(de.subtitle),
      description: e(de.description),
    },
    { onConflict: "tour_id,lang" },
  );
  if (eDe) return abort("db");

  for (const l of TOUR_TARGET_LOCALES) {
    const tx = trClean[l];
    if (tx) {
      const { error } = await supabase.from("tour_translations").upsert(
        {
          tour_id: tourId,
          lang: l,
          title: tx.title || deTitle, // title ist NOT NULL
          subtitle: e(tx.subtitle),
          description: e(tx.description),
        },
        { onConflict: "tour_id,lang" },
      );
      if (error) return abort("db");
    } else {
      const { error } = await supabase
        .from("tour_translations")
        .delete()
        .eq("tour_id", tourId)
        .eq("lang", l);
      if (error) return abort("db");
    }
  }

  // Aktualitäts-Marken (source_hash) NACHTRÄGLICH & fehlertolerant setzen: die Spalte
  // gibt es erst ab Migration 0060, und eine fehlende Marke darf kein Speichern kosten.
  {
    const { error: dh } = await supabase
      .from("tour_translations")
      .update({ source_hash: deHash })
      .eq("tour_id", tourId)
      .eq("lang", "de");
    if (dh) console.warn("source_hash (de) übersprungen – Migration 0060 nötig?", dh.message);
    // Die ZIEL-Zeilen tragen den Stand, aus dem übersetzt wurde. Ohne sie könnte der
    // Veraltet-Vergleich beim nächsten Laden nie greifen (wie savePoint/saveArea).
    if (!dh && input.translationsSourceHash) {
      await supabase
        .from("tour_translations")
        .update({ source_hash: input.translationsSourceHash })
        .eq("tour_id", tourId)
        .neq("lang", "de");
    }
  }

  // Start/Ziel + gesnappte Route (Migration 0061) ebenfalls nachträglich schreiben:
  // Fehlen die Spalten noch, bleibt die Runde speicherbar und die Karte fällt auf die
  // Linie über die Stationen zurück.
  {
    const geo = cleanRouteGeo(input.routeGeo);
    const { error: re } = await supabase
      .from("tours")
      .update({
        start_lat: input.start?.lat ?? null,
        start_lng: input.start?.lng ?? null,
        end_lat: input.end?.lat ?? null,
        end_lng: input.end?.lng ?? null,
        route_geo: geo,
        route_hash: geo ? (input.routeHash ?? null) : null,
      })
      .eq("id", tourId);
    if (re) console.warn("Route/Start übersprungen – Migration 0061 nötig?", re.message);
  }

  // Stops schreiben (full replace). Die alte Liste wird VOR dem Löschen gelesen:
  // Schlägt das Neu-Einfügen fehl (Netz, Constraint), werden die alten Stops
  // zurückgeschrieben – sonst stünde eine bestehende Tour plötzlich ohne Stationen
  // da, und die einzige Kopie der kuratierten Reihenfolge wäre der Formular-State.
  const { data: prevStops, error: ePrevStops } = await supabase
    .from("tour_stops")
    .select("point_id, sort_order")
    .eq("tour_id", tourId)
    .order("sort_order", { ascending: true });
  if (ePrevStops) return abort("db");
  const { error: eStopsDel } = await supabase.from("tour_stops").delete().eq("tour_id", tourId);
  if (eStopsDel) return abort("db");
  if (pointIds.length) {
    const { error: eStops } = await supabase
      .from("tour_stops")
      .insert(pointIds.map((pid, i) => ({ tour_id: tourId, point_id: pid, sort_order: i })));
    if (eStops) {
      const old = (prevStops ?? []) as { point_id: string; sort_order: number }[];
      if (old.length) {
        const { error: eRestore } = await supabase
          .from("tour_stops")
          .insert(old.map((r) => ({ tour_id: tourId, point_id: r.point_id, sort_order: r.sort_order })));
        if (eRestore) console.error("saveTour: Stops-Restore fehlgeschlagen", eRestore.message);
      }
      return abort("db");
    }
  }

  return { ok: true, id: tourId };
}

export async function deleteTour(id: string): Promise<TourSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { error } = await gate.supabase.from("tours").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

export async function setTourStatus(
  id: string,
  status: "draft" | "published",
): Promise<TourSaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const s = status === "published" ? "published" : "draft";

  // Publish-Gate wie in saveTour: Dieser Schnell-Schalter ist der Seitenweg am
  // Formular vorbei und braucht dieselbe Grenze, sonst geht eine Tour ohne einen
  // einzigen veröffentlichten Punkt live (öffentlich: 0 Stationen).
  if (s === "published") {
    const { data: stops, error: stopsErr } = await gate.supabase
      .from("tour_stops")
      .select("point_id")
      .eq("tour_id", id);
    if (stopsErr) return { ok: false, error: "db" };
    const pointIds = ((stops ?? []) as { point_id: string }[]).map((r) => r.point_id);
    if (!pointIds.length) return { ok: false, error: "no_published_stops" };
    const { data: live, error: liveErr } = await gate.supabase
      .from("tour_points")
      .select("id")
      .in("id", pointIds)
      .eq("status", "published")
      .limit(1);
    if (liveErr) return { ok: false, error: "db" };
    if (!(live ?? []).length) return { ok: false, error: "no_published_stops" };

    // Sprach-Gate, ebenfalls am Formular vorbei: Ohne diese Prüfung ginge über den
    // Schnell-Schalter eine Runde live, deren Titel nur auf Deutsch existiert –
    // genau das Loch, wegen dem italienische Stationen unter deutschem Titel standen.
    const { data: trRows, error: trErr } = await gate.supabase
      .from("tour_translations")
      .select("lang, title, subtitle, description, source_hash")
      .eq("tour_id", id);
    if (trErr) {
      console.warn("setTourStatus: source_hash fehlt – Migration 0060 nötig?", trErr.message);
      return { ok: false, error: "db" };
    }
    const rows = ((trRows ?? []) as {
      lang: string;
      title: string | null;
      subtitle: string | null;
      description: string | null;
      source_hash: string | null;
    }[]);
    const deRow = rows.find((r) => r.lang === "de");
    if (!deRow) return { ok: false, error: "translations_incomplete" };
    const present: Record<string, { title: string }> = {};
    for (const r of rows) if (r.lang !== "de") present[r.lang] = { title: r.title ?? "" };
    const deHash = hashTourTexts({
      title: deRow.title ?? "",
      subtitle: deRow.subtitle ?? "",
      description: deRow.description ?? "",
    });
    const mark = rows.find((r) => r.lang !== "de" && r.source_hash)?.source_hash ?? null;
    if (!translationsPublishable(present, mark, deHash, TOUR_TARGET_LOCALES))
      return { ok: false, error: "translations_incomplete" };
  }

  const { error } = await gate.supabase.from("tours").update({ status: s }).eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true, id };
}

// ── KI: „In ALLE Sprachen übersetzen" ────────────────────────────────────────
// Ein Knopf, alle Zielsprachen parallel – wie bei Punkten und Gebieten. Die Texte
// einer Runde sind kurz (Titel, Untertitel, zwei Sätze), deshalb je Sprache ein
// eigener kleiner Call: Fällt eine Sprache aus, stehen die anderen trotzdem.
export type TourTranslateAllResult = {
  ok: boolean;
  translations?: Record<string, TourTexts>;
  sourceHash?: string;
  failed?: string[];
  error?: string;
};

async function translateTourTo(
  src: TourTexts,
  locale: string,
  key: string,
): Promise<TourTexts | null> {
  const langName = localeMeta(locale).english;
  const system = `You translate the title, subtitle and description of a SalzGuide audio walk from German into natural ${langName}. Keep the SAME casual young-local vibe (a friend showing you around their city), the same length, informal "you" address. The title stays short and punchy. Avoid tourist-brochure tone and clichés (breathtaking, hidden gem, must-see, paradise). NEVER use em dashes (—). They are the clearest tell of AI-written text and cost us the trust this brand is built on. Write like a human types: full stop, comma, colon, or a plain hyphen. The ONLY exception is Chinese, where the doubled "——" is standard punctuation. Keep proper nouns and place names exactly (Salzburg, Getreidegasse, Steingasse). Translate faithfully; invent nothing. Keep empty fields empty. Return all three fields via the tool "tour_texts".`;
  const userMsg = `Translate this German audio walk into ${langName} and return it via the tool "tour_texts" (keep empty fields empty).\n\ntitle: ${src.title.trim()}\nsubtitle: ${src.subtitle.trim()}\ndescription: ${src.description.trim()}`;
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
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: userMsg }],
          tools: [
            {
              name: "tour_texts",
              description: `${langName} translation of the audio-walk texts.`,
              input_schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  subtitle: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "subtitle", "description"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "tour_texts" },
        }),
      },
      2,
      60000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content ?? []).find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "tour_texts",
    ) as { input?: Record<string, string> } | undefined;
    const t = block?.input;
    if (!t) return null;
    // Leere Quellfelder bleiben leer (sonst erfindet die KI einen Untertitel).
    const keep = (deVal: string, val?: string) => (deVal.trim() ? (val ?? "").trim() : "");
    // Der Prompt verbietet den Gedankenstrich, aber ein Prompt ist nur eine Bitte
    // (em-dash.ts). locale mitgeben: Chinesisch behält seinen 破折号.
    return stripEmDashFields(
      {
        title: (t.title ?? "").trim() || src.title.trim(),
        subtitle: keep(src.subtitle, t.subtitle),
        description: keep(src.description, t.description),
      },
      locale,
    );
  } catch {
    return null;
  }
}

export async function translateTourTextsAll(input: TourTexts): Promise<TourTranslateAllResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.title.trim())
    return { ok: false, error: "Bitte zuerst den deutschen Titel ausfüllen." };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY fehlt – bitte in .env.local eintragen" };

  const src: TourTexts = {
    title: input.title.trim(),
    subtitle: input.subtitle.trim(),
    description: input.description.trim(),
  };
  const results = await Promise.all(
    TOUR_TARGET_LOCALES.map(async (l) => [l, await translateTourTo(src, l, key)] as const),
  );
  const translations: Record<string, TourTexts> = {};
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
    // Marke aus DEN Texten, die übersetzt wurden (hashTourTexts säubert intern).
    sourceHash: hashTourTexts(src),
    failed: failed.length ? failed : undefined,
  };
}

// ── Route an die Fusswege anpassen (Mapbox Walking Directions) ───────────────
// Anders als bei den KI-Runden wird hier NICHT optimiert: Die Reihenfolge der
// Stationen ist die kuratierte Entscheidung des Admins und bleibt, wie sie ist.
// Geholt wird nur die echte Geh-Linie dazwischen (statt Luftlinie über Häuser).
export type SnapRouteInput = {
  start: RoutePoint | null;
  end: RoutePoint | null;
  pointIds: string[]; // Stationen in kuratierter Reihenfolge
  // Fortbewegungsart (0064). Sie entscheidet über das Mapbox-Profil UND über die Dauer.
  // Bis 25.08.2026 war hier "walking" fest verdrahtet, und für eine Radrunde ist das
  // gleich zweimal falsch: Das Geh-Profil führt durch Fussgängerzonen und über Treppen,
  // also genau dorthin, wo docs/40 nicht hinwill, und die Dauer wäre Gehzeit. Für Runde A
  // hiesse das rund zwei Stunden statt einer.
  mode?: TourMode;
};
export type SnapRouteResult = {
  ok: boolean;
  routeGeo?: [number, number][];
  routeHash?: string;
  distanceKm?: number;
  durationMin?: number;
  error?: string;
};

// Mapbox Directions erlaubt 25 Koordinaten je Anfrage (Start + Stationen + Ziel).
const MAX_WAYPOINTS = 25;

export async function snapTourRoute(input: SnapRouteInput): Promise<SnapRouteResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const pointIds = (input.pointIds ?? []).filter((x) => typeof x === "string" && x);
  if (pointIds.length < 1)
    return { ok: false, error: "Bitte zuerst Stationen zur Runde hinzufügen." };

  // Koordinaten kommen aus der DB, nicht aus dem Formular: Der Server soll die Runde
  // aus dem laufen, was wirklich gespeichert ist.
  const { data: pts, error: ptsErr } = await gate.supabase
    .from("tour_points")
    .select("id, lat, lng")
    .in("id", pointIds);
  if (ptsErr) return { ok: false, error: "db" };
  const byId = new Map(
    ((pts ?? []) as { id: string; lat: number | null; lng: number | null }[]).map((p) => [p.id, p]),
  );
  const stops: RoutePoint[] = [];
  for (const id of pointIds) {
    const p = byId.get(id);
    if (!p || p.lat == null || p.lng == null)
      return { ok: false, error: "Mindestens eine Station hat noch keinen Punkt auf der Karte." };
    stops.push({ lat: p.lat, lng: p.lng });
  }

  // Ohne eigenen Start/Ziel läuft die Runde von der ersten zur letzten Station.
  const chain: RoutePoint[] = [
    ...(input.start ? [input.start] : []),
    ...stops,
    ...(input.end ? [input.end] : []),
  ];
  if (chain.length < 2)
    return { ok: false, error: "Für eine Route braucht es mindestens zwei Punkte." };
  if (chain.length > MAX_WAYPOINTS)
    return {
      ok: false,
      error: `Zu viele Punkte für die Routenberechnung (${chain.length}, erlaubt sind ${MAX_WAYPOINTS} inkl. Start und Ziel).`,
    };

  // Eigener SERVER-Token: Der öffentliche NEXT_PUBLIC-Token ist URL-beschränkt, ein
  // serverseitiger fetch schickt keinen Referer -> Mapbox antwortet 403 (siehe
  // tour-generate.ts). Fallback nur, damit es lokal nicht hart bricht.
  const token = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token)
    return { ok: false, error: "MAPBOX_SERVER_TOKEN fehlt – bitte in .env.local eintragen." };

  const istRad = input.mode === "bike";
  const profil = istRad ? "cycling" : "walking";
  const coordStr = chain.map((c) => `${c.lng},${c.lat}`).join(";");
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profil}/${coordStr}` +
    `?geometries=geojson&overview=full&continue_straight=false&access_token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 403 = fast immer ein URL-beschränkter Token (Referer fehlt serverseitig).
      console.error("[snapTourRoute] Mapbox", res.status, body.slice(0, 200));
      return { ok: false, error: `Mapbox antwortet ${res.status}. Bitte Token prüfen.` };
    }
    const j = await res.json();
    const route = Array.isArray(j.routes) ? j.routes[0] : null;
    const geo = cleanRouteGeo(route?.geometry?.coordinates);
    if (j.code !== "Ok" || !geo)
      return {
        ok: false,
        error: `Mapbox hat keine ${istRad ? "Rad" : "Geh"}-Route gefunden. Punkte prüfen.`,
      };

    const distanceKm =
      typeof route.distance === "number" ? Math.round(route.distance / 100) / 10 : undefined;
    // Zuschlag je Station: zu Fuss ~2 Minuten (Zuhören und Stehenbleiben), am Rad 1 Minute.
    // Die Audiotexte einer Radrunde sind rund 55 Sekunden lang, und gehört wird im Fahren;
    // gestanden wird nur, wer will. Gemessen an den sieben Texten der Runde A: 6 Minuten
    // Hörzeit auf der ganzen Runde, nicht 14.
    const proStopMin = istRad ? 1 : 2;
    const durationMin =
      typeof route.duration === "number"
        ? Math.round(route.duration / 60) + stops.length * proStopMin
        : undefined;

    return {
      ok: true,
      routeGeo: geo,
      routeHash: tourRouteHash({ start: input.start, end: input.end, pointIds }),
      distanceKm,
      durationMin,
    };
  } catch (err) {
    console.error("[snapTourRoute]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Routendienst gerade nicht erreichbar – bitte nochmal versuchen." };
  }
}

