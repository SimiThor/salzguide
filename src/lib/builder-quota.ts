import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUILDER_BURST, BUILDER_DAILY, BUILDER_MAX_TOURS } from "./builder-limits";
import { userRateLimit } from "./user-rate-limit";
import { countUserTours } from "./user-tours-core";
import { createServiceClient } from "./supabase/service";
import { logOps } from "./ops";

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
  // Obergrenze über ALLE Runden-Bauten am Tag (wie bei Toni, ai-chat-core): schützt das Claude-Guthaben, das sich
  // SalzGuide mit Steiner Studio teilt. Erhöhen über BUILDER_GLOBAL_DAILY_CAP in Vercel. Fail-closed.
  const cap = builderGlobalDailyCap();
  try {
    const { data, error } = await createServiceClient().rpc("hit_rate_limit", {
      // Je Wiener Kalendertag (beginnt um Mitternacht neu), wie die Toni-Grenzen in ai-chat-core.
      p_subject: `ai:builder-global-day:${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date())}`,
      p_window_seconds: 2 * 86_400,
      p_max: cap,
    });
    if (error || typeof data !== "boolean") return "unavailable";
    if (!data) {
      await logOps("ai_global_cap_hit", {
        message: `Tagesgrenze aller Runden-Bauten (${cap}) erreicht. Der Bauer pausiert bis morgen.`,
        group: "ai:builder_global_cap",
        detail: { grenze: cap },
      });
      return "rate_limit";
    }
  } catch {
    return "unavailable";
  }
  return "ok";
}

export const BUILDER_GLOBAL_DAILY_DEFAULT = 25;

export function builderGlobalDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.BUILDER_GLOBAL_DAILY_CAP);
  return Number.isInteger(raw) && raw > 0 ? raw : BUILDER_GLOBAL_DAILY_DEFAULT;
}
