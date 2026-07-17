import { notFound } from "next/navigation";
import { getCategoriesAll, getLocalsAll, getSpotForEdit } from "@/lib/admin";
import type { SpotInput } from "@/lib/admin-actions";
import { normalizeManual, emptyManualWeek } from "@/lib/opening-hours";
import { parsePois } from "@/lib/geo";
import SpotForm from "@/components/admin/SpotForm";
import BackButton from "@/components/BackButton";

export default async function EditSpotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, categories, locals] = await Promise.all([
    getSpotForEdit(id),
    getCategoriesAll(),
    getLocalsAll(),
  ]);
  if (!data) notFound();

  const { spot, de, translations, translationsSourceHash, categoryIds, images } = data;
  const s = spot as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  // Übersetzungs-Zeilen (snake_case) -> SpotTexts (camelCase) je Sprache.
  const trMap: Record<string, SpotInput["translations"][string]> = {};
  for (const [lang, row] of Object.entries(translations)) {
    trMap[lang] = {
      title: str(row.title),
      shortDesc: str(row.short_desc),
      general: str(row.general),
      insiderTip: str(row.insider_tip),
      sectionA: str(row.section_a),
      sectionB: str(row.section_b),
      locationText: str(row.location_text),
    };
  }
  const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

  const rg = s.route_geojson as
    | { type?: string; coordinates?: [number, number][] }
    | null;
  const snappedCoords: [number, number][] =
    rg && rg.type === "LineString" && Array.isArray(rg.coordinates)
      ? rg.coordinates
      : [];
  const wp = s.route_waypoints as [number, number][] | null;
  // Kontrollpunkte: bevorzugt route_waypoints; Fallback (Altdaten) = gezeichnete Linie
  const waypoints: [number, number][] = Array.isArray(wp) ? wp : snappedCoords;

  const initial: Partial<SpotInput> = {
    id: str(s.id),
    slug: str(s.slug),
    type: (s.type as "activity" | "food") ?? "activity",
    subtype: str(s.subtype),
    emoji: str(s.emoji),
    seasons: (s.seasons as string[]) ?? ["summer"],
    isPro: Boolean(s.is_pro),
    status: (s.status as "draft" | "published") ?? "draft",
    sortWeight: numOrNull(s.sort_weight) ?? 0,
    lat: numOrNull(s.lat),
    lng: numOrNull(s.lng),
    parkingLat: numOrNull(s.parking_lat),
    parkingLng: numOrNull(s.parking_lng),
    waterStops: parsePois(s.water_stops),
    huts: parsePois(s.huts),
    routePoints: waypoints,
    routeSnapped: snappedCoords,
    elevationProfile: (s.elevation_profile as SpotInput["elevationProfile"]) ?? null,
    locationMode:
      waypoints.length >= 2 || snappedCoords.length >= 2 ? "route" : "point",
    difficulty: str(s.difficulty),
    bestSeason: str(s.best_season),
    access: str(s.access),
    duration: str(s.duration),
    priceLevel: str(s.price_level),
    area: str(s.area),
    fame: str(s.fame),
    hasOpeningHours: Boolean(s.has_opening_hours),
    openingHoursManual: Boolean(s.opening_hours_manual),
    openingHours: normalizeManual(s.opening_hours) ?? emptyManualWeek(),
    googlePlaceId: str(s.google_place_id),
    phone: str(s.phone),
    websiteUrl: str(s.website_url),
    lakeName: str(s.lake_name),
    localId: str(s.local_id),
    categoryIds,
    images,
    videoUrl: str(s.video_url) || null,
    videoPosterUrl: str(s.video_poster_url) || null,
    title: str(de.title),
    shortDesc: str(de.short_desc),
    general: str(de.general),
    insiderTip: str(de.insider_tip),
    sectionA: str(de.section_a),
    sectionB: str(de.section_b),
    locationText: str(de.location_text),
    translations: trMap,
    translationsSourceHash,
  };

  return (
    <div className="space-y-4">
      <BackButton fallbackHref="/admin" />
      <SpotForm categories={categories} locals={locals} initial={initial} isNew={false} />
    </div>
  );
}
