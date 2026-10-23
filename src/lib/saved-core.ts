import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateDefaultList } from "./saved";
import { isOperatorUser, serverEventContext, trackEvent } from "./analytics";
import { isRealSite } from "./ops";

// Gemeinsamer Kern der Merkliste für Web (toggleSaved, "use server") und App-API
// (PUT/DELETE /api/app/v1/saved/{slug}). Steht hier und nicht in saved-actions.ts, weil jeder
// Export einer "use server"-Datei ein öffentlicher POST-Endpunkt wäre (docs/41 Abschnitt 2).
//
// Alles läuft über den ÜBERGEBENEN Client im Namen des Nutzers: Die RLS (0017 für Pro-Spots,
// 0001 für saved_items) entscheidet, nicht diese Datei.

/** Veröffentlichter, für DIESEN Client sichtbarer Spot. Pro-Spots blendet die RLS für Nicht-Pro aus. */
export async function findSavableSpot(
  client: SupabaseClient,
  slug: string,
): Promise<{ id: string; subtype: string | null } | null> {
  const { data: spot } = await client
    .from("spots")
    .select("id, subtype")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!spot) return null;
  return { id: spot.id as string, subtype: (spot.subtype as string | null) ?? null };
}

export type SaveEventContext = {
  device: string;
  country: string | null;
  locale: string | null;
};

/**
 * Das `spot_save`-Ereignis, genau wie das Web es schreibt. Nur echte Nutzer zählen: der
 * eingeloggte Betreiber (Admin) wird ausgenommen. Ohne `ctx` kommt Gerät/Land/Sprache aus den
 * Anfrage-Headern (Web); die App übergibt ihren eigenen Kontext, weil ihr User-Agent kein
 * "iPhone" enthält und classifyDevice sie sonst als Desktop zählte (docs/41 Abschnitt 4.3).
 */
export async function recordSpotSave(
  client: SupabaseClient,
  userId: string,
  slug: string,
  subtype: string | null,
  ctx?: SaveEventContext,
): Promise<void> {
  if (await isOperatorUser(client, userId)) return;
  const c = ctx ?? (await serverEventContext());
  await trackEvent({
    type: "spot_save",
    kind: "spot",
    target: slug,
    category: subtype,
    device: c.device,
    country: c.country,
    locale: c.locale,
  });
}

export type SetSavedOutcome = "ok" | "not_found" | "failed";

/**
 * IDEMPOTENT: `saved = true` legt den Eintrag an, falls er fehlt; `false` entfernt ihn, falls
 * er da ist. Zweimal dasselbe ändert nichts und meldet beide Male "ok". Das Ereignis fällt nur
 * bei einem tatsächlich neuen Eintrag an, damit Wiederholungen der App (Netz-Retry) nicht
 * doppelt zählen.
 */
export async function setSavedFor(
  client: SupabaseClient,
  userId: string,
  slug: string,
  saved: boolean,
  ctx?: SaveEventContext,
): Promise<SetSavedOutcome> {
  const spot = await findSavableSpot(client, slug);
  if (!spot) return "not_found";

  if (!saved) {
    // Beim Entfernen keine Liste anlegen. Entfernt wird aus ALLEN eigenen Listen (die RLS
    // begrenzt auf die eigenen), damit auch eine doppelte Standardliste (Rennen vor 0073)
    // oder künftige weitere Listen den Spot nicht festhalten.
    const { error: delError } = await client
      .from("saved_items")
      .delete()
      .eq("spot_id", spot.id);
    return delError ? "failed" : "ok";
  }

  const listId = await getOrCreateDefaultList(client, userId);
  if (!listId) return "failed";

  const { data: existing, error: readError } = await client
    .from("saved_items")
    .select("id")
    .eq("spot_id", spot.id)
    .limit(1);
  if (readError) return "failed";
  // In irgendeiner eigenen Liste schon gemerkt (RLS: nur eigene): nichts zu tun.
  if (existing && existing.length > 0) return "ok";

  const { error } = await client.from("saved_items").insert({ list_id: listId, spot_id: spot.id });
  // 23505 = unique (list_id, spot_id): Eine parallele Anfrage war schneller. Das Ziel ist
  // erreicht, also ok, aber ohne zweites Ereignis.
  if (error) return error.code === "23505" ? "ok" : "failed";

  // Nur auf der echten Seite zählen: ein lokaler `next start` oder ein Preview teilt sich das
  // Supabase-Projekt mit der Produktion und darf dort keine Analytics schreiben.
  if (isRealSite()) await recordSpotSave(client, userId, slug, spot.subtype, ctx);
  return "ok";
}
