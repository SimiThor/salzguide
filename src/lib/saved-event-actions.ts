"use server";

import { createClient } from "./supabase/server";
import { trackEvent, serverEventContext, isOperatorUser } from "./analytics";

export type ToggleEventResult = { saved?: boolean; needLogin?: boolean };

// Event in der Merkliste an-/abspeichern (eigene Tabelle saved_events). Verlangt Login.
export async function toggleSavedEvent(
  eventId: string,
): Promise<ToggleEventResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needLogin: true };

  // Nur echte, veröffentlichte Events speicherbar.
  const { data: ev } = await supabase
    .from("events")
    .select("id, category")
    .eq("id", eventId)
    .eq("status", "published")
    .maybeSingle();
  if (!ev) return {};

  const { data: existing } = await supabase
    .from("saved_events")
    .select("id")
    .eq("user_id", user.id)
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing) {
    await supabase.from("saved_events").delete().eq("id", existing.id);
    return { saved: false };
  }

  await supabase
    .from("saved_events")
    .insert({ user_id: user.id, event_id: eventId });
  // Nur echte Nutzer zählen — der eingeloggte Betreiber (Admin) wird ausgenommen.
  if (!(await isOperatorUser(supabase, user.id))) {
    const ctx = await serverEventContext();
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
  return { saved: true };
}
