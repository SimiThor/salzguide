import "server-only";

import { createHash } from "node:crypto";
import type { AppNavRoute, AppPackageAudio, AppTourPackage } from "./app-api-types";
import { tourDurationMin } from "./routing/chain";
import { OSM_ATTRIBUTION, type LngLat } from "./routing/types";
import { supabaseNavRouteStore, getTourNavRoute, type NavRouteStore, type StoredNavRoute } from "./tour-nav-route";
import { createServiceClient } from "./supabase/service";
import { getTourDetailFor } from "./tours";
import type { TourDetail } from "./tour-types";

// Das Offline-Paket einer Runde (docs/41 6.3, docs/42): Manifest mit Tour-Detail, Route,
// Kartenausschnitt, Bildern, Audio und contentHash. EIN Betrachter, EINE Sprache, EINE
// Stimme. Die Maskierung kommt aus getTourDetailFor (dieselbe Funktion wie GET /tours/{slug});
// hier wird nichts nachgebaut, nur neu gruppiert.

/** Puffer um Linie und Stopps für die Offline-Karte. */
export const BBOX_BUFFER_M = 1000;

/** Signierte Links ändern sich bei jedem Abruf: nur der Pfad davor zählt für den Hash. */
export function stableUrl(url: string | null | undefined): string | null {
  return url ? url.split("?")[0] : null;
}

/** JSON mit sortierten Schlüsseln: gleicher Inhalt, gleicher Text. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function packageBbox(points: LngLat[], bufferM = BBOX_BUFFER_M): AppTourPackage["bbox"] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return { west: 0, south: 0, east: 0, north: 0 };
  const midLat = (south + north) / 2;
  const dLat = bufferM / 111_320;
  const dLng = bufferM / (111_320 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { west: r(west - dLng), south: r(south - dLat), east: r(east + dLng), north: r(north + dLat) };
}

function audioOf(detail: TourDetail): AppPackageAudio[] {
  const out: AppPackageAudio[] = [];
  for (const s of detail.stops) {
    // Dieselbe Entscheidung wie stopAudioAccess, schon in getTourDetailFor gefallen: ein
    // gesperrter Stopp trägt nur die Kostprobe (audioUrl ist dort immer null), ein freier
    // nur die Vollfassung.
    if (s.locked) {
      if (s.teaserUrl) out.push({ stopId: s.spotSlug, kind: "sample", url: s.teaserUrl, durationSec: s.teaserSec ?? null });
    } else if (s.audioUrl) {
      out.push({ stopId: s.spotSlug, kind: "full", url: s.audioUrl, durationSec: s.durationSec });
    }
  }
  return out;
}

function imagesOf(detail: TourDetail): string[] {
  const urls = [detail.coverUrl, ...detail.stops.map((s) => s.imageUrl)].filter((u): u is string => Boolean(u));
  return [...new Set(urls)];
}

export function navRouteOf(detail: TourDetail, stored: StoredNavRoute, lineHash: string): AppNavRoute {
  const distanceM = Math.round(stored.lengthM);
  return {
    v: 1,
    mode: detail.mode,
    profile: stored.profile,
    routeHash: stored.routeHash,
    lineHash,
    geometry: stored.geometry,
    steps: stored.steps,
    stopAlongM: stored.viaAlong.stopAlongM,
    viaAlongM: stored.viaAlong.viaAlongM,
    distanceM,
    durationMin: tourDurationMin(distanceM, detail.mode, detail.stops.length),
    source: stored.source,
  };
}

/**
 * Hash über alles, was die App neu laden müsste, wenn es sich ändert. Nicht darin: die
 * signierten Links (Token wechselt bei jedem Abruf), Berechnungszeitpunkt, Dauer (folgt aus
 * Länge, Fortbewegung und Stoppzahl). Die Stufe des Betrachters steckt über `locked`,
 * Dateiart und Texte schon darin.
 */
export function contentHashOf(input: {
  lang: string;
  detail: TourDetail;
  route: AppNavRoute | null;
  images: string[];
  audio: AppPackageAudio[];
}): string {
  const { detail, route } = input;
  const tour = {
    ...detail,
    stops: detail.stops.map((s) => ({ ...s, audioUrl: stableUrl(s.audioUrl), teaserUrl: stableUrl(s.teaserUrl) })),
  };
  const payload = {
    v: 1,
    lang: input.lang,
    tour,
    route: route && {
      routeHash: route.routeHash,
      lineHash: route.lineHash,
      profile: route.profile,
      distanceM: route.distanceM,
      steps: route.steps,
      stopAlongM: route.stopAlongM,
      viaAlongM: route.viaAlongM,
    },
    images: input.images,
    audio: input.audio.map((a) => ({ ...a, url: stableUrl(a.url) })),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 32);
}

/** Manifest aus Tour-Detail und gespeicherter Route zusammensetzen (rein, ohne Datenbank). */
export function assemblePackage(input: {
  lang: string;
  detail: TourDetail;
  stored: StoredNavRoute | null;
  lineHash: string | null;
}): AppTourPackage {
  const { lang, detail } = input;
  const route = input.stored && input.lineHash ? navRouteOf(detail, input.stored, input.lineHash) : null;
  const images = imagesOf(detail);
  const audio = audioOf(detail);
  const mapPoints: LngLat[] = route
    ? route.geometry
    : detail.stops.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lng as number, s.lat as number]);
  const stopPoints = detail.stops.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lng as number, s.lat as number] as LngLat);
  return {
    lang,
    tier: detail.canSeePro ? "pro" : "public",
    tour: detail,
    route,
    bbox: packageBbox([...mapPoints, ...stopPoints]),
    images,
    audio,
    contentHash: contentHashOf({ lang, detail, route, images, audio }),
    attribution: OSM_ATTRIBUTION,
  };
}

export type PackageResult =
  | { kind: "ok"; pkg: AppTourPackage; fromCache: boolean }
  | { kind: "not_found" }
  | { kind: "unavailable"; code: string };

/**
 * Paket für diesen Betrachter. `canSeePro` kommt vom Aufrufer (Bearer-Token); die
 * Entwurfs-Vorschau gibt es über die App nicht. `store` ist austauschbar (Prüfskripte).
 */
export async function loadTourPackage(args: {
  slug: string;
  lang: string;
  canSeePro: boolean;
  store?: NavRouteStore;
  compute?: Parameters<typeof getTourNavRoute>[0]["compute"];
}): Promise<PackageResult> {
  const detail = await getTourDetailFor(args.slug, args.lang, args.canSeePro, async () => false);
  if (!detail) return { kind: "not_found" };

  const sb = createServiceClient();
  const { data: row, error } = await sb.from("tours").select("id").eq("slug", args.slug).maybeSingle();
  if (error) throw error;
  if (!row) return { kind: "not_found" };

  const nav = await getTourNavRoute({
    detail,
    tourId: row.id as string,
    store: args.store ?? supabaseNavRouteStore(sb),
    compute: args.compute,
  });
  if (!nav.ok && nav.reason === "routing") return { kind: "unavailable", code: nav.code };
  const pkg = assemblePackage({
    lang: args.lang,
    detail,
    stored: nav.ok ? nav.stored : null,
    lineHash: nav.ok ? nav.lineHash : null,
  });
  return { kind: "ok", pkg, fromCache: nav.ok ? nav.fromCache : false };
}
