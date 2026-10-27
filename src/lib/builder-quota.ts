import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUILDER_BURST, BUILDER_DAILY, BUILDER_MAX_TOURS } from "./builder-limits";
import { userRateLimit } from "./user-rate-limit";
import { countUserTours } from "./user-tours-core";

export type BuilderQuota = "ok" | "limit" | "rate_limit" | "unavailable";

/**
 * Darf dieses Konto jetzt eine Runde bauen lassen? EINE Pruefung fuer die Web-Aktion
 * generateTour und POST /api/app/v1/builder, mit EINEM Zaehler je Konto (Web und App zusammen,
 * wie Toni): zuerst die Obergrenze gespeicherter Runden (zaehlt nicht gegen die Laeufe), dann
 * 3 Laeufe in 10 Minuten und 10 am Tag. Faellt eine Zaehlung aus, gilt "nein" (fail-closed).
 * Erst danach darf Claude aufgerufen werden. `client` traegt die Identitaet des Kontos (RLS).
 */
export async function enforceBuilderQuota(client: SupabaseClient, userId: string): Promise<BuilderQuota> {
  const have = await countUserTours(client);
  if (have === null) return "unavailable";
  if (have >= BUILDER_MAX_TOURS) return "limit";
  if (!(await userRateLimit(userId, "builder-burst", BUILDER_BURST.windowSeconds, BUILDER_BURST.max, true)))
    return "rate_limit";
  if (!(await userRateLimit(userId, "builder-daily", BUILDER_DAILY.windowSeconds, BUILDER_DAILY.max, true)))
    return "rate_limit";
  return "ok";
}
