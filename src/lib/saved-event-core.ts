import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOperatorUser, trackEvent } from "./analytics";
import { isRealSite } from "./ops";
import type { SaveEventContext, SetSavedOutcome } from "./saved-core";

// Merkliste für Events, App-Seite (PUT/DELETE /api/app/v1/events/{id}/saved). Das Web hat
// toggleSavedEvent in saved-event-actions.ts ("use server"): Jeder Export dieser Datei wäre
// ein öffentlicher POST-Endpunkt, deshalb steht der idempotente Kern hier und das Web bleibt
// unverändert (docs/41 Abschnitt 2).
//
// Alles läuft über den ÜBERGEBENEN Client im Namen des Nutzers: Die RLS (events_public_read,
// saved_events_own) entscheidet.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEventId(id: string): boolean {
  return UUID.test(id);
}

/**
 * IDEMPOTENT: `saved = true` legt den Eintrag an, falls er fehlt; `false` entfernt ihn.
 * Speichern nur für veröffentlichte Events (wie das Web); Entfernen geht immer, auch wenn
 * das Event inzwischen nicht mehr veröffentlicht ist. Das `event_save`-Ereignis fällt nur
 * bei einem tatsächlich neuen Eintrag an.
 */
export async function setSavedEventFor(
  client: SupabaseClient,
  userId: string,
  eventId: string,
  saved: boolean,
  ctx: SaveEventContext,
): Promise<SetSavedOutcome> {
  if (!saved) {
    const { error } = await client
      .from("saved_events")
      .delete()
      .eq("user_id", userId)
      .eq("event_id", eventId);
    return error ? "failed" : "ok";
  }

  const { data: ev, error: evError } = await client
    .from("events")
    .select("id, category")
    .eq("id", eventId)
    .eq("status", "published")
    .maybeSingle();
  if (evError) return "failed";
  if (!ev) return "not_found";

  const { data: existing, error: readError } = await client
    .from("saved_events")
    .select("id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (readError) return "failed";
  if (existing) return "ok";

  const { error } = await client
    .from("saved_events")
    .insert({ user_id: userId, event_id: eventId });
  // 23505 = unique (user_id, event_id): Eine parallele Anfrage war schneller.
  if (error) return error.code === "23505" ? "ok" : "failed";

  if (isRealSite() && !(await isOperatorUser(client, userId))) {
    await trackEvent({
      type: "event_save",
      kind: "event",
      target: eventId,
      category: (ev.category as string | null) ?? null,
      device: ctx.device,
      country: ctx.country,
      locale: ctx.locale,
    });
  }
  return "ok";
}
