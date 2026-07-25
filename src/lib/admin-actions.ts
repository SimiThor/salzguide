"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "./supabase/service";
import { BRAND_VOICE } from "./brand-voice";
import { normalizeManual, type OpeningWeek } from "./opening-hours";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashSpotTexts, translationsPublishable } from "./spot-hash";
import {
  createBlurPreview,
  planImageBlur,
  removeBlurPreviews,
  removeSpotMediaFiles,
} from "./blur-preview";
import { stripEmDashFields } from "./em-dash";
import { guardStorageUrl } from "./storage-guard";
import { parsePois, hikingTimeMinutes, type MapPoi } from "./geo";
import { HOME_KEYS } from "./home-fields";
import { translateHomeTextsWith } from "./home-translate";
import { parseLandingImage, parseLandingVideo } from "./landing-media";
import type { HomeMedia } from "./home-content";
import { MAX_HOME_FEATURED } from "./home-featured";
import { requireAdmin } from "./admin-guard";
import { factCanonical, factPrice, type FactField } from "./facts-i18n";
import { slugify, slugifyKey } from "./slug";
import { getIntroRenderList, type IntroRenderItem } from "./admin";

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
  // Zusätzliche Karten-Punkte (mehrere je Spot): Wasserstellen und Hütten mit
  // optionalem Namen. Auf der User-Karte als eigene Symbole, Name beim Antippen.
  waterStops: MapPoi[];
  huts: MapPoi[];
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

// Quick-Fact-Werte in der kanonischen Schreibweise speichern, nicht wie getippt.
// „Cafe" -> „Café", „Mai–Oktober" -> „Mai bis Oktober", „Salzburg Stadt" -> „Stadt Salzburg".
// Damit heilt sich der Bestand mit jedem Speichern selbst, statt dass Varianten liegen
// bleiben, die keine Übersetzung treffen. Unbekanntes bleibt unangetastet — lieber ein
// deutscher Wert als ein stillschweigend verworfener.
const canon = (field: FactField, v: string) => {
  const t = e(v);
  return t === null ? null : factCanonical(field, t) ?? t;
};

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

// Rohe DB-Meldung ins Server-Log, kurzer Code zum Browser: Postgres-Texte verraten
// Tabellen-/Constraint-Namen und sind englisch – das UI übersetzt Codes (admin-errors.ts).
function logDb(where: string, message: string): "db" {
  console.error(`${where}:`, message);
  return "db";
}

export async function saveSpot(input: SpotInput): Promise<SaveResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  // Slug = URL-Schlüssel. Bei NEUEN Spots kanonisieren, damit nie ein roher „Hallstätter See!"
  // als URL landet. Bestehende Spots NICHT umschreiben: ein geänderter Slug bräche alte
  // Links/SEO; wer ihn bewusst ändert, tut das im Feld selbst.
  const slug = input.id ? input.slug.trim() : slugify(input.slug);
  if (!slug || !input.title.trim()) return { ok: false, error: "required" };

  // Öffnungszeiten: im Google-Modus (Default) ist die Place-ID Pflicht.
  if (
    input.hasOpeningHours &&
    !input.openingHoursManual &&
    !input.googlePlaceId.trim()
  )
    return { ok: false, error: "place_id_required" };

  const vid = guardStorageUrl(input.videoUrl);
  const vidPoster = guardStorageUrl(input.videoPosterUrl);
  if (!vid.ok || !vidPoster.ok) return { ok: false, error: "bad_url" };

  // Auch die FOTO-URLs müssen aus dem eigenen Bucket kommen (wie Video + Standbild):
  // Eine fremde URL in der media-Tabelle bricht next/image (remotePatterns erlauben nur
  // *.supabase.co), und createBlurPreview lädt die URL serverseitig – ohne Guard hieße
  // das: der Server ruft beliebige Adressen ab (SSRF).
  const images: string[] = [];
  for (const raw of input.images ?? []) {
    const img = guardStorageUrl(raw);
    if (!img.ok || !img.url) return { ok: false, error: "bad_url" };
    images.push(img.url);
  }

  // VOR den Writes wissen, ob der Spot schon live war: Das Publish-Gate unten prüft nur
  // den Übergang Entwurf->Veröffentlicht, und die Fehler-Rücknahme (abort) darf einen
  // SCHON live stehenden Spot nicht auf Entwurf zurückwerfen – seine Übersetzungen in
  // der DB sind ja intakt, nur der neue Write ist gescheitert.
  let wasPublished = false;
  if (input.id) {
    const { data: cur, error: curErr } = await supabase
      .from("spots")
      .select("status")
      .eq("id", input.id)
      .maybeSingle();
    if (curErr) return { ok: false, error: logDb("saveSpot: Status lesen", curErr.message) };
    wasPublished = (cur as { status?: string } | null)?.status === "published";
  }

  // Zahlen härten, wie savePoint/saveTour es vormachen: Ein NaN aus dem Client
  // serialisiert zu null und knallt erst als roher Postgres-Fehler (sort_weight ist
  // NOT NULL); kaputte Koordinaten-Paare gingen über route_geojson bis auf die
  // öffentliche Karte durch (getSpotRoute).
  const sortWeight = Number.isFinite(input.sortWeight) ? Math.trunc(input.sortWeight) : 0;
  const num = (v: number | null) => (v != null && Number.isFinite(v) ? v : null);
  const finitePair = (p: [number, number]) =>
    Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const routePoints = (input.routePoints ?? []).filter(finitePair);
  const routeSnapped = (input.routeSnapped ?? []).filter(finitePair);

  // Modus: Einzelner Punkt ODER Wanderung. Bei einer Wanderung ist der
  // Haupt-/Anreisepunkt (lat/lng) automatisch der Startpunkt (erster Kontrollpunkt).
  const isRoute = input.locationMode === "route" && routePoints.length >= 2;
  const lat = isRoute ? routePoints[0][1] : num(input.lat);
  const lng = isRoute ? routePoints[0][0] : num(input.lng);
  // Anzeige-Linie: gesnappte Wege bevorzugen, sonst Luftlinie durch die Kontrollpunkte.
  const lineCoords = routeSnapped.length >= 2 ? routeSnapped : routePoints;
  const routeGeojson = isRoute
    ? { type: "LineString", coordinates: lineCoords }
    : null;
  const routeWaypoints = isRoute ? routePoints : null;
  const elevationProfile = isRoute ? input.elevationProfile : null;
  // Zusatzpunkte säubern (echte Zahlen, Name getrimmt, leere raus); leer -> null.
  const waterStops = parsePois(input.waterStops);
  const huts = parsePois(input.huts);

  // Veröffentlichen-Gate (Anti-Chaos): live gehen darf ein Spot NUR mit gesetztem Ort UND in
  // ALLE Sprachen übersetzt & aktuell. Geprüft wird NUR der Übergang Entwurf->Veröffentlicht
  // (wasPublished oben): ein bereits veröffentlichter Spot bleibt frei editierbar
  // (Koordinaten/Fotos/Tippfehler), ohne dass alles erneut erzwungen wird. Entwurf speichern
  // ist immer erlaubt. (Verbindliche Grenze.)
  if (input.status === "published" && !wasPublished) {
    // Ohne Ort ist der Spot auf der Karte unsichtbar -> nicht veröffentlichbar. Der Ort ist in
    // beiden Modi ein Klick (Einzelpunkt oder Wanderung mit Start & Ziel).
    if (lat == null || lng == null)
      return { ok: false, error: "location_required" };
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

  const row = {
    slug,
    type: input.type,
    subtype: canon("subtype", input.subtype),
    emoji: e(input.emoji),
    seasons: input.seasons.length ? input.seasons : ["summer"],
    is_pro: input.isPro,
    status: input.status,
    sort_weight: sortWeight,
    lat,
    lng,
    parking_lat: num(input.parkingLat),
    parking_lng: num(input.parkingLng),
    water_stops: waterStops.length ? waterStops : null,
    huts: huts.length ? huts : null,
    // Öffis-Anreise zielt immer auf den Spot/Startpunkt -> kein eigener Transit-Punkt
    transit_lat: null,
    transit_lng: null,
    route_geojson: routeGeojson,
    route_waypoints: routeWaypoints,
    elevation_profile: elevationProfile,
    difficulty: canon("difficulty", input.difficulty),
    best_season: canon("season", input.bestSeason),
    access: e(input.access),
    duration: e(input.duration),
    price_level: factPrice(input.priceLevel),
    area: canon("area", input.area),
    fame: canon("fame", input.fame),
    has_opening_hours: input.hasOpeningHours,
    google_place_id: e(input.googlePlaceId),
    phone: e(input.phone),
    website_url: e(input.websiteUrl),
    lake_name: e(input.lakeName),
    local_id: e(input.localId),
    video_url: vid.url,
    video_poster_url: vidPoster.url,
  };

  // Spot anlegen/aktualisieren. Der häufigste echte Fehler ist der doppelte Slug ->
  // eigener Code statt roher Constraint-Meldung (rohe Postgres-Texte bleiben im Server-Log).
  const spotErr = (e2: { message: string; code?: string }) =>
    e2.code === "23505" ? ("slug_taken" as const) : logDb("saveSpot: spots-Write", e2.message);
  const createdNew = !input.id;
  let spotId = input.id;
  if (spotId) {
    const { error } = await supabase.from("spots").update(row).eq("id", spotId);
    if (error) return { ok: false, error: spotErr(error) };
  } else {
    const { data, error } = await supabase
      .from("spots")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: spotErr(error) };
    spotId = data.id;
  }

  // Schlägt ein Folge-Write fehl, bleibt kein halber Spot zurück:
  // - Ein NEU angelegter Spot wird wieder gelöscht (sonst stünde ein titelloser
  //   Slug-Geist in der Liste; die Tour-Actions machen das genauso).
  // - Nur ein GERADE ERST veröffentlichter fällt auf Entwurf zurück. Ein schon vorher
  //   live stehender behält seinen Status: Seine Übersetzungen in der DB sind intakt,
  //   nur der neue Write ist gescheitert – ein Tippfehler-Fix darf den Spot nicht
  //   von der öffentlichen Seite nehmen.
  const abort = async (err: string): Promise<SaveResult> => {
    if (createdNew && spotId) {
      await supabase.from("spots").delete().eq("id", spotId);
    } else if (input.status === "published" && !wasPublished && spotId) {
      await supabase.from("spots").update({ status: "draft" }).eq("id", spotId);
    }
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
  // Gedankenstrich-Riegel wie bei saveHomeTexts: Auch von Hand eingefügter Text (etwa
  // aus einem KI-Chat, der NICHT durch unsere KI-Actions lief) wird beim Speichern
  // gesäubert. hashTexts säubert identisch, die Aktualitäts-Marken bleiben stimmig.
  const deClean = stripEmDashFields(
    {
      title: input.title.trim(),
      shortDesc: input.shortDesc,
      general: input.general,
      insiderTip: input.insiderTip,
      sectionA: input.sectionA,
      sectionB: input.sectionB,
      locationText: input.locationText,
    },
    "de",
  );
  const { error: trErr } = await supabase.from("spot_translations").upsert(
    {
      spot_id: spotId,
      lang: "de",
      title: deClean.title,
      short_desc: e(deClean.shortDesc),
      general: e(deClean.general),
      insider_tip: e(deClean.insiderTip),
      section_a: e(deClean.sectionA),
      section_b: e(deClean.sectionB),
      location_text: e(deClean.locationText),
    },
    { onConflict: "spot_id,lang" },
  );
  if (trErr) return await abort(logDb("saveSpot: DE-Texte", trErr.message));

  // Übersetzungen (alle Sprachen außer DE): je Sprache MIT Inhalt eine Zeile upserten,
  // leere Sprachen -> vorhandene Zeile löschen (keine leeren Übersetzungs-Datensätze).
  // NUR bekannte Sprachen (routing.locales): Der Client ist nicht vertrauenswürdig,
  // Fantasie-Codes würden sonst als Junk-Zeilen in spot_translations landen. Sprachen,
  // die im Formular fehlen (z.B. weil eine Übersetzung fehlschlug), bleiben unangetastet.
  const upsertedLangs: string[] = [];
  for (const lang of routing.locales) {
    if (lang === "de") continue;
    const tx = input.translations?.[lang];
    if (!tx) continue;
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
      const clean = stripEmDashFields(tx, lang);
      const { error: txErr } = await supabase.from("spot_translations").upsert(
        {
          spot_id: spotId,
          lang,
          title: clean.title.trim() || deClean.title, // Spalte ist NOT NULL
          short_desc: e(clean.shortDesc),
          general: e(clean.general),
          insider_tip: e(clean.insiderTip),
          section_a: e(clean.sectionA),
          section_b: e(clean.sectionB),
          location_text: e(clean.locationText),
        },
        { onConflict: "spot_id,lang" },
      );
      if (txErr) return await abort(logDb(`saveSpot: Übersetzung ${lang}`, txErr.message));
      upsertedLangs.push(lang);
    } else {
      const { error: delTxErr } = await supabase
        .from("spot_translations")
        .delete()
        .eq("spot_id", spotId)
        .eq("lang", lang);
      if (delTxErr)
        return await abort(logDb(`saveSpot: Übersetzung ${lang} löschen`, delTxErr.message));
    }
  }

  // Aktualitäts-Marken (source_hash) NACHTRÄGLICH & fehlertolerant setzen: existiert die
  // Spalte noch nicht (Migration 0031 nicht eingespielt), scheitert nur DAS – nicht der Spot.
  {
    const { error: dh } = await supabase
      .from("spot_translations")
      .update({ source_hash: deHash })
      .eq("spot_id", spotId)
      .eq("lang", "de");
    if (dh) console.warn("source_hash (de) übersprungen – Migration 0031 nötig?", dh.message);
    else if (input.translationsSourceHash && upsertedLangs.length) {
      // NUR die gerade wirklich geschriebenen Sprachen stempeln. Vorher stempelte
      // `.neq("lang","de")` auch DB-Zeilen, die gar nicht im Formular standen (etwa
      // weil ihre Übersetzung fehlgeschlagen war) – die galten dann als „aktuell",
      // obwohl ihr Text noch aus dem alten Deutsch stammte. Das hebelte das
      // Anti-Chaos-System aus.
      await supabase
        .from("spot_translations")
        .update({ source_hash: input.translationsSourceHash })
        .eq("spot_id", spotId)
        .in("lang", upsertedLangs);
    }
  }

  // Kategorien neu setzen. Delete+Insert ist nicht transaktional -> beide Fehler
  // PRÜFEN: Vorher lief die Funktion nach einem stillen Insert-Fehler weiter und
  // meldete „gespeichert", während der Spot alle Kategorien verloren hatte.
  {
    const { error: delErr } = await supabase
      .from("spot_categories")
      .delete()
      .eq("spot_id", spotId);
    if (delErr) return await abort(logDb("saveSpot: Kategorien löschen", delErr.message));
    if (input.categoryIds.length) {
      const { error: insErr } = await supabase
        .from("spot_categories")
        .insert(input.categoryIds.map((cid) => ({ spot_id: spotId, category_id: cid })));
      if (insErr) return await abort(logDb("saveSpot: Kategorien schreiben", insErr.message));
    }
  }

  // Fotos neu setzen (erstes = Hero); media-Tabelle ist die Quelle der Wahrheit.
  //
  // DIE VORSCHAU GEHÖRT ZUM BILD, NICHT ZUR HERO-ROLLE.
  // Deshalb lesen wir ALLE bisherigen Bildzeilen, nicht nur das Hero. Wer im Admin ein
  // Foto nach vorn zieht, das schon einmal Hero war, bekommt dessen Vorschau geschenkt,
  // statt sie erneut aus dem Netz zu laden und durch sharp zu schicken. Und – wichtiger –
  // ein Umsortieren kann keine funktionierende Vorschau mehr zerstören: Wir werfen nur
  // weg, was zu einem entfernten FOTO gehört, nie was zu einer alten Rolle gehörte.
  const { data: prevRows, error: prevErr } = await supabase
    .from("media")
    .select("url, blur_url")
    .eq("spot_id", spotId)
    .eq("type", "image");
  if (prevErr) return await abort(logDb("saveSpot: Fotos lesen", prevErr.message));

  const plan = planImageBlur(prevRows ?? [], images);

  // Fehlt dem Hero die Vorschau, jetzt EINE erzeugen. Ein reines Textspeichern rendert
  // damit gar nichts, und Umsortieren auf ein Foto, das schon einmal Hero war, ebenso
  // wenig. Schlägt es fehl, bleibt die Spalte null und die UI fällt auf das Emoji zurück –
  // das Speichern darf daran nicht scheitern, `npm run backfill:blur` holt es nach.
  if (plan.heroNeedingPreview) {
    const made = await createBlurPreview(supabase.storage, plan.heroNeedingPreview);
    if (made) plan.blurByUrl.set(plan.heroNeedingPreview, made);
  }

  // Delete+Insert mit Fehlerprüfung (siehe Kategorien): Ein stiller Insert-Fehler
  // hieß vorher „Spot live, aber alle Fotos weg" – und der Admin sah „gespeichert".
  {
    const { error: delErr } = await supabase
      .from("media")
      .delete()
      .eq("spot_id", spotId)
      .eq("type", "image");
    if (delErr) return await abort(logDb("saveSpot: Fotos löschen", delErr.message));
    if (images.length) {
      const { error: insErr } = await supabase.from("media").insert(
        images.map((url, i) => ({
          spot_id: spotId,
          type: "image",
          role: i === 0 ? "hero" : "gallery",
          url,
          sort_order: i,
          // Eine einmal erzeugte Vorschau bleibt an ihrem Bild kleben, auch wenn es gerade
          // in der Galerie steht: Sonst kostet jedes Hin-und-Her-Sortieren ein neues Rendern.
          blur_url: plan.blurByUrl.get(url) ?? null,
        })),
      );
      if (insErr) return await abort(logDb("saveSpot: Fotos schreiben", insErr.message));
    }
  }

  // Vorschauen UND Originaldateien entfernter Fotos wegräumen. Erst NACH dem Insert,
  // damit ein Fehler beim Aufräumen nichts gerade Gespeichertes reißt. Originale sind
  // sicher wegwerfbar: Jeder Upload bekommt einen eigenen UUID-Dateinamen, die Datei
  // gehört also genau diesem Spot. Best-effort, loggt nur.
  if (plan.orphanPreviews.length) {
    await removeBlurPreviews(supabase.storage, plan.orphanPreviews);
  }
  const removedOriginals = (prevRows ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === "string" && u !== "" && !images.includes(u));
  if (removedOriginals.length) {
    await removeSpotMediaFiles(supabase.storage, removedOriginals);
  }

  // Die Startseite wird vorgerendert (siehe lib/home-content.ts) und zeigt die Spot-Anzahl
  // sowie die ausgewählten Spots. Ohne diesen Aufruf hinge sie nach dem Veröffentlichen bis
  // zu einer Stunde auf dem alten Stand.
  for (const l of routing.locales) revalidatePath(`/${l}`);

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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

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

    // Gehzeit SELBST rechnen (DAV, siehe hikingTimeMinutes) statt ORS' optimistischer Dauer:
    // ehrlich für einen normalen Wanderer, mit echten Höhenmetern (Auf- UND Abstieg). Ohne
    // Höhenprofil (kein ORS-Höhe) bleibt nur die Horizontalzeit -> immer noch nachvollziehbar.
    const km = distanceKm ?? profile?.distanceKm;
    const durationMin =
      km != null ? hikingTimeMinutes(km, profile?.ascent ?? 0, profile?.descent ?? 0) : undefined;

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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  // VOR dem Löschen alle Datei-URLs des Spots einsammeln: Die media-Zeilen kaskadieren
  // mit der spots-Zeile weg, danach wüsste niemand mehr, welche Dateien im Bucket zu
  // diesem Spot gehörten – sie lägen für immer öffentlich erreichbar herum.
  const { data: mediaRows } = await supabase
    .from("media")
    .select("url, blur_url")
    .eq("spot_id", id);
  const { data: spotRow } = await supabase
    .from("spots")
    .select("video_url, video_poster_url")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("spots").delete().eq("id", id);
  if (error) return { ok: false, error: logDb("deleteSpot", error.message) };

  // Erst NACH dem erfolgreichen DB-Delete aufräumen (best-effort, loggt nur):
  // Scheitert das Löschen der Zeile, bleiben die Dateien korrekt referenziert stehen.
  const fileUrls = (mediaRows ?? []).flatMap((m) => [m.url, m.blur_url]);
  const s = spotRow as { video_url?: string | null; video_poster_url?: string | null } | null;
  await removeSpotMediaFiles(supabase.storage, [
    ...fileUrls,
    s?.video_url,
    s?.video_poster_url,
  ]);

  // Wie in saveSpot: Die vorgerenderte Startseite muss die neue Spot-Anzahl mitbekommen.
  for (const l of routing.locales) revalidatePath(`/${l}`);

  return { ok: true };
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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY fehlt" };

  // Lese-Fehler nicht schlucken: Sonst meldet ein DB-Schluckauf fälschlich „no_de",
  // und der Admin sucht den Fehler bei seinen Texten statt bei der Verbindung.
  const { data: rows, error: readErr } = await supabase
    .from("spot_translations")
    .select(
      "lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, source_hash",
    )
    .eq("spot_id", spotId);
  if (readErr)
    return { ok: false, error: logDb("fillSpotTranslations: lesen", readErr.message) };
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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

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
// unverändert. (slugifyKey kommt aus lib/slug.ts – EINE Implementierung für alle.)

export type CategoryInput = {
  id?: string;
  season: "summer" | "winter";
  titles: Record<string, string>;
  sortOrder: number;
};


export async function saveCategory(
  input: CategoryInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const gate = await requireAdmin();
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
  // Insert mit Retry bei Unique-Kollision (TOCTOU-Race zwischen SELECT und INSERT),
  // dasselbe Muster wie saveArea/saveTour.
  const base = slugifyKey(de) || "kategorie";
  const { data: existing, error: keysErr } = await supabase
    .from("categories")
    .select("key")
    .eq("season", input.season);
  if (keysErr) return { ok: false, error: logDb("saveCategory: Keys lesen", keysErr.message) };
  const used = new Set(((existing ?? []) as { key: string }[]).map((r) => r.key));
  for (let attempt = 0; attempt < 6; attempt++) {
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}-${n++}`;
    const { data: created, error } = await supabase
      .from("categories")
      .insert({ key, season: input.season, title_translations: titles, sort_order: sortOrder })
      .select("id")
      .single();
    if (!error && created) return { ok: true, id: created.id as string };
    if (error && (error as { code?: string }).code === "23505") {
      used.add(key); // Key inzwischen vergeben -> nächsten Suffix probieren
      continue;
    }
    return { ok: false, error: logDb("saveCategory: anlegen", error?.message ?? "unbekannt") };
  }
  return { ok: false, error: "db" };
}

export async function deleteCategory(id: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (season !== "summer" && season !== "winter")
    return { ok: false, error: "Ungültige Saison." };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "bad_input" };
  // ALLE Kategorien der Saison holen und vollständig neu durchnummerieren. Käme nur eine
  // Teilliste an, behielten die ausgelassenen ihre alte sort_order und kollidierten mit den
  // neu vergebenen Positionen (doppelte Nummern -> unbestimmte Reihenfolge in den Karussells).
  const { data: all, error: readErr } = await gate.supabase
    .from("categories")
    .select("id")
    .eq("season", season)
    .order("sort_order", { ascending: true });
  if (readErr) return { ok: false, error: "db" };
  const allIds = (all ?? []).map((r) => r.id as string);
  const wanted = ids.filter((id) => allIds.includes(id));
  // Gewünschte Reihenfolge zuerst, alles Übrige (stabil nach alter Sortierung) dahinter.
  const ordered = [...wanted, ...allIds.filter((id) => !wanted.includes(id))];
  for (let i = 0; i < ordered.length; i++) {
    const { error } = await gate.supabase
      .from("categories")
      .update({ sort_order: i + 1 })
      .eq("id", ordered[i])
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
  const gate = await requireAdmin();
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
  const gate = await requireAdmin();
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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;

  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Bitte einen Namen eingeben." };
  const role = (input.role ?? "").trim();

  const avatar = guardStorageUrl(input.avatarUrl);
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
  const gate = await requireAdmin();
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
  const gate = await requireAdmin();
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
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  if (!Array.isArray(slugs)) return { ok: false, error: "Ungültige Auswahl." };
  if (slugs.length > MAX_HOME_FEATURED)
    return { ok: false, error: `Höchstens ${MAX_HOME_FEATURED} Spots auf der Startseite.` };

  // spots hat die RLS-Policy spots_admin_all -> der Session-Client (mit Admin-Login) darf lesen
  // und schreiben, und die zweite Schloss-Ebene (RLS) bleibt aktiv. Kein Service-Client nötig,
  // wie schon saveSpot zeigt. Nur home_content bräuchte ihn (dort gibt es keine Admin-Write-Policy).
  const svc = gate.supabase;

  // Nur das durchlassen, was wirklich frei und veröffentlicht ist. Der Client könnte
  // veraltete oder manipulierte Slugs schicken.
  const wanted = [...new Set(slugs)];
  const { data: valid, error: checkErr } = await svc
    .from("spots")
    .select("slug")
    .in("slug", wanted.length ? wanted : ["__none__"])
    .eq("status", "published")
    .eq("is_pro", false);
  if (checkErr) return { ok: false, error: logDb("saveHomeFeatured: Slugs prüfen", checkErr.message) };

  const allowed = new Set((valid ?? []).map((s) => s.slug as string));
  const ordered = wanted.filter((s) => allowed.has(s));

  // Alles abräumen — auch die, die gerade nicht in `wanted` stehen.
  const { error: clearErr } = await svc
    .from("spots")
    .update({ home_rank: null })
    .not("home_rank", "is", null);
  if (clearErr) return { ok: false, error: logDb("saveHomeFeatured: Ränge räumen", clearErr.message) };

  // Neu vergeben, Position = Rang.
  for (const [i, slug] of ordered.entries()) {
    const { error } = await svc
      .from("spots")
      .update({ home_rank: i + 1 })
      .eq("slug", slug);
    if (error) return { ok: false, error: logDb("saveHomeFeatured: Rang setzen", error.message) };
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
): Promise<{ ok: boolean; error?: string; texts?: Record<string, string> }> {
  const gate = await requireAdmin();
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
  if (error) return { ok: false, error: logDb("saveHomeTexts", error.message) };

  // Die Startseite UND die Über-uns-Seite (nutzt dieselben Gründer-Texte) sind statisch
  // gerendert -> ohne revalidate bliebe der alte Text stehen, und im Admin sähe alles
  // richtig aus. Alle Sprachen, weil jede die deutschen Texte als Auffangnetz nutzt.
  for (const l of routing.locales) {
    revalidatePath(`/${l}`);
    revalidatePath(`/${l}/ueber-uns`);
  }
  // Den normalisierten Stand zurückgeben, damit das Formular ihn übernimmt: sonst bliebe der
  // lokale Rohtext (Leerzeichen/Gedankenstrich) ungleich dem gespeicherten und „dirty" klemmte.
  return { ok: true, texts: cleaned };
}

// „In alle Sprachen übersetzen": Deutsch -> alle Ziel-Locales, in einem Rutsch.
// Schreibt die Übersetzungen UND den source_hash des Standes, der übersetzt wurde.
export async function fillHomeTranslations(): Promise<{
  ok: boolean;
  error?: string;
  failed?: string[];
  rejected?: string[];
}> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY fehlt." };

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("home_content")
    .select("texts, translations, source_hash")
    .eq("id", 1)
    .maybeSingle();
  if (error) return { ok: false, error: logDb("fillHomeTranslations: lesen", error.message) };

  const de = (data?.texts ?? {}) as Record<string, string>;
  if (!Object.values(de).some((v) => (v ?? "").trim()))
    return { ok: false, error: "Erst die deutschen Texte speichern." };

  const res = await translateHomeTextsWith(de, apiKey);
  if (!res.ok || !res.translations)
    return { ok: false, error: res.error === "empty" ? "Keine Texte." : "Übersetzung fehlgeschlagen." };

  // Bereits gespeicherte Übersetzungen NICHT wegwerfen: nur die neu erhaltenen Sprachen
  // überschreiben. Sonst würde ein Teilausfall (eine Sprache scheitert transient, der Lauf gilt
  // trotzdem als ok) deren zuvor gute Übersetzung löschen und die Seite fiele dort auf Deutsch.
  const prevTranslations = (data?.translations ?? {}) as Record<string, unknown>;
  const mergedTranslations = { ...prevTranslations, ...res.translations };
  // Die Aktualitäts-Marke nur setzen, wenn ALLE Zielsprachen geklappt haben. Bei Teilausfall die
  // alte behalten -> das Badge bleibt „veraltet", statt die fehlgeschlagenen (jetzt alten)
  // Sprachen fälschlich als aktuell auszuweisen.
  const allSucceeded = !(res.failed && res.failed.length);
  const nextSourceHash = allSucceeded
    ? res.sourceHash
    : ((data?.source_hash as string | null | undefined) ?? null);
  const { error: upErr } = await svc
    .from("home_content")
    .update({
      translations: mergedTranslations,
      source_hash: nextSourceHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (upErr) return { ok: false, error: logDb("fillHomeTranslations: schreiben", upErr.message) };

  for (const l of routing.locales) {
    revalidatePath(`/${l}`);
    revalidatePath(`/${l}/ueber-uns`);
  }
  return { ok: true, failed: res.failed, rejected: res.rejected };
}

// Bilder und Video der Startseite speichern.
//
// Dieselbe Prüfung wie beim Lesen (landing-media.ts): Was hier nicht durchkommt, wird zu
// null statt zu einer halben Zeile in der DB. Der Alt-Text läuft NICHT durch die
// Übersetzung — er gehört zum Bild, nicht zu den Texten.
export async function saveHomeMedia(
  media: HomeMedia,
): Promise<{ ok: boolean; error?: string; media?: HomeMedia }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!media || typeof media !== "object") return { ok: false, error: "Ungültige Medien." };

  const clean = {
    heroPortrait: parseLandingImage(media.heroPortrait),
    heroLandscape: parseLandingImage(media.heroLandscape),
    explainerVideo: parseLandingVideo(media.explainerVideo),
    explainerVideoEn: parseLandingVideo(media.explainerVideoEn),
    antonPhoto: parseLandingImage(media.antonPhoto),
    simonPhoto: parseLandingImage(media.simonPhoto),
  };

  // Ein Bild, das der Client geschickt hat und das die Prüfung NICHT überlebt, wäre sonst
  // still weg: Anton lädt hoch, sieht die Vorschau, drückt Speichern, und die Seite bleibt
  // leer. Also sagen, welcher Slot es war.
  const lost = (Object.keys(clean) as (keyof HomeMedia)[]).filter((k) => media[k] && !clean[k]);
  if (lost.length)
    return {
      ok: false,
      error: `Nicht gespeichert: ${lost.join(", ")} hat keine gültige Datei aus unserem Speicher. Bitte neu hochladen.`,
    };

  const svc = createServiceClient();
  const { error } = await svc
    .from("home_content")
    .update({ media: clean, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { ok: false, error: logDb("saveHomeMedia", error.message) };

  // Startseite UND Über-uns-Seite: beide zeigen dieselben Medien (Video, Gründerfotos).
  for (const l of routing.locales) {
    revalidatePath(`/${l}`);
    revalidatePath(`/${l}/ueber-uns`);
  }
  // Normalisierten Stand zurückgeben (verworfene Slots sind hier schon abgefangen), damit das
  // Formular ihn übernimmt und „dirty" nicht auf getrimmten Alt-Texten hängen bleibt.
  return { ok: true, media: clean };
}

// ── Intro-Video per Button rendern (GitHub Actions) ────────────────────────────
// Der Render selbst läuft NICHT hier (Playwright + ffmpeg, Minuten-Job) - das passt nicht in
// eine Vercel-Funktion. Diese Action stösst nur den GitHub-Actions-Workflow (render-intro.yml)
// an, der auf einem Runner gegen die Prod-URL rendert und hochlädt. Den Fortschritt meldet das
// Skript zurück in die spots-Zeile (intro_render_status), die die Admin-Seite pollt.
export async function triggerIntroRender(
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  if (!token || !repo) {
    return {
      ok: false,
      error: "GitHub ist nicht konfiguriert (GITHUB_ACTIONS_TOKEN / GITHUB_REPO fehlen).",
    };
  }

  // spots hat die RLS-Policy spots_admin_all -> Session-Client genügt (RLS bleibt zweites Schloss).
  const svc = gate.supabase;
  // Sofort 'queued', damit die Seite gleich „in Warteschlange" zeigt. Best-effort: fehlt
  // Migration 0049, ignorieren wir den Fehler und stossen den Workflow trotzdem an.
  await svc
    .from("spots")
    .update({
      intro_render_status: "queued",
      intro_render_error: null,
      intro_render_started_at: new Date().toISOString(),
    })
    .eq("slug", slug);

  // try/catch wie bei jedem anderen Netz-Aufruf der Datei: Ohne ihn wirft ein
  // DNS-/Netzfehler aus der Action heraus, und die Zeile stünde für immer auf
  // „in Warteschlange" – nur der non-204-Zweig unten schreibt den Fehlerstatus zurück.
  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/render-intro.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "salzguide-admin",
        },
        body: JSON.stringify({ ref: "main", inputs: { slug } }),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch (err) {
    await svc
      .from("spots")
      .update({
        intro_render_status: "error",
        intro_render_error: `GitHub nicht erreichbar: ${err instanceof Error ? err.message : "Netzwerkfehler"}`,
      })
      .eq("slug", slug);
    return { ok: false, error: "GitHub ist gerade nicht erreichbar. Bitte nochmal versuchen." };
  }

  if (res.status !== 204) {
    const txt = await res.text().catch(() => "");
    await svc
      .from("spots")
      .update({
        intro_render_status: "error",
        intro_render_error: `GitHub API ${res.status}: ${txt.slice(0, 300)}`,
      })
      .eq("slug", slug);
    return { ok: false, error: `Workflow konnte nicht gestartet werden (GitHub ${res.status}).` };
  }
  return { ok: true };
}

// Aktuelle Render-Liste neu laden (fürs Polling der Admin-Seite).
export async function refreshIntroRenderList(): Promise<IntroRenderItem[]> {
  const gate = await requireAdmin();
  if (!gate.ok) return [];
  return getIntroRenderList();
}
