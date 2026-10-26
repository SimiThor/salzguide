import "server-only";

import { getTranslations } from "next-intl/server";
import { assemblePackage } from "./tour-package";
import { getTourNavRoute, type NavRouteStore } from "./tour-nav-route";
import { TAG_KEYS, TAG_EMOJI, TAG_LABELS_DE, type TagKey } from "./tour-tags";
import { getPublishedAreas } from "./tours";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppBuilderArea, AppBuilderInterest, AppMyTourSummary, AppTourPackage } from "./app-api-types";
import { MY_TOUR_PREFIX } from "./tour-chain";
import { loadUserTourDetail, type UserTourSummary } from "./user-tours-core";
import type { runChain } from "./routing/run";

// Gemeinsames fuer den Runden-Bauer der App (GET/POST /builder) und "Meine Runden"
// (/my-tours): Grenzen, Eingabepruefung, Zuordnung. Die Arbeit selbst steckt in
// tour-generate-core.ts und user-tours-core.ts (dieselben Kerne wie im Web).

/** Hoechstlaenge des freien Texts (das Web hat keine; die App kappt, der Text geht in einen KI-Prompt). */
export const BUILDER_MAX_FREE_TEXT = 200;
/** Hoechstzahl eigener Runden je Konto (das Web hat keine). Haelt die Tabelle und die Liste klein. */
export const BUILDER_MAX_TOURS = 50;
/** Bauen kostet Claude und Routendienst: 3 Laeufe in 10 Minuten und 10 am Tag je Konto. */
export const BUILDER_BURST = { windowSeconds: 600, max: 3 } as const;
export const BUILDER_DAILY = { windowSeconds: 86_400, max: 10 } as const;
const MAX_INTERESTS = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const BUILDER_INTERESTS: AppBuilderInterest[] = TAG_KEYS.map((key) => ({ key, emoji: TAG_EMOJI[key] }));

/** Gebiete mit gesetztem Startpunkt, wie /touren/bauen. */
export async function builderAreas(lang: string): Promise<AppBuilderArea[]> {
  const areas = await getPublishedAreas(lang);
  return areas.filter((a) => a.startLat != null && a.startLng != null).map((a) => ({ id: a.id, name: a.name }));
}

export type BuilderInput = { areaId: string; interestKeys: TagKey[]; freeText: string };

/** Body pruefen. null = ungueltig (Route antwortet 400 invalid). */
export function parseBuilderBody(body: Record<string, unknown>): BuilderInput | null {
  if (Object.keys(body).some((k) => !["areaId", "interests", "freeText", "lang"].includes(k))) return null;
  const areaId = body.areaId;
  if (typeof areaId !== "string" || !UUID.test(areaId)) return null;
  const raw = body.interests;
  if (!Array.isArray(raw) || raw.length > MAX_INTERESTS) return null;
  const keys: TagKey[] = [];
  for (const k of raw) {
    if (typeof k !== "string" || !(TAG_KEYS as readonly string[]).includes(k)) return null;
    if (!keys.includes(k as TagKey)) keys.push(k as TagKey);
  }
  let freeText = "";
  if (body.freeText !== undefined) {
    if (typeof body.freeText !== "string" || body.freeText.length > 1000) return null;
    // Steuerzeichen raus, Leerraum zusammenziehen, kappen: Der Text landet in einem KI-Prompt.
    freeText = body.freeText
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, BUILDER_MAX_FREE_TEXT);
  }
  return { areaId, interestKeys: keys, freeText };
}

/** Beschriftung der gewaehlten Interessen in der Sprache der Anfrage (Tours.chip.*, wie im Web). */
export async function interestLabels(lang: string, keys: TagKey[]): Promise<string[]> {
  try {
    const t = await getTranslations({ locale: lang, namespace: "Tours" });
    return keys.map((k) => t(`chip.${k}`));
  } catch {
    return keys.map((k) => TAG_LABELS_DE[k]);
  }
}

export function toMyTourSummary(s: UserTourSummary): AppMyTourSummary {
  return { ...s, slug: `${MY_TOUR_PREFIX}${s.id}` };
}

/** Kein Ablegen: Eigene Runden haben keine Zeile in tour_nav_routes, die Route wird je Abruf gerechnet. */
const NO_STORE: NavRouteStore = { get: async () => null, put: async () => {} };

export type MyPackageResult =
  | { kind: "ok"; pkg: AppTourPackage }
  | { kind: "not_found" }
  | { kind: "unavailable"; code: string };

/**
 * Offline-Paket einer eigenen Runde. Dieselbe Form wie das der kuratierten (assemblePackage):
 * Die App nutzt ihren Offline-Code unveraendert. `client` ist der Bearer-Client des
 * Eigentuemers; fuer jeden anderen ist die Runde "nicht gefunden".
 */
export async function loadMyTourPackage(args: {
  client: SupabaseClient;
  id: string;
  lang: string;
  canSeePro: () => Promise<boolean>;
  compute?: typeof runChain;
}): Promise<MyPackageResult> {
  const detail = await loadUserTourDetail(args.client, args.id, args.lang, args.canSeePro);
  if (!detail) return { kind: "not_found" };
  const nav = await getTourNavRoute({ detail, tourId: args.id, store: NO_STORE, compute: args.compute });
  if (!nav.ok && nav.reason === "routing") return { kind: "unavailable", code: nav.code };
  return {
    kind: "ok",
    pkg: assemblePackage({
      lang: args.lang,
      detail,
      stored: nav.ok ? nav.stored : null,
      lineHash: nav.ok ? nav.lineHash : null,
    }),
  };
}
