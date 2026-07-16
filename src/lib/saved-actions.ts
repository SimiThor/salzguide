"use server";

import { createClient } from "./supabase/server";
import { getOrCreateDefaultList } from "./saved";
import { trackEvent, serverEventContext, isOperatorUser } from "./analytics";

export type ToggleResult = { saved?: boolean; needLogin?: boolean };

// Spot in der Merkliste an-/abspeichern. Verlangt Login.
export async function toggleSaved(slug: string): Promise<ToggleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needLogin: true };

  const { data: spot } = await supabase
    .from("spots")
    .select("id, subtype")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!spot) return {};

  const listId = await getOrCreateDefaultList(supabase, user.id);
  if (!listId) return {};

  const { data: existing } = await supabase
    .from("saved_items")
    .select("id")
    .eq("list_id", listId)
    .eq("spot_id", spot.id)
    .maybeSingle();

  if (existing) {
    await supabase.from("saved_items").delete().eq("id", existing.id);
    return { saved: false };
  }

  await supabase.from("saved_items").insert({ list_id: listId, spot_id: spot.id });
  // Nur echte Nutzer zählen — der eingeloggte Betreiber (Admin) wird ausgenommen.
  if (!(await isOperatorUser(supabase, user.id))) {
    const ctx = await serverEventContext();
    await trackEvent({
      type: "spot_save",
      kind: "spot",
      target: slug,
      category: (spot.subtype as string | null) ?? null,
      device: ctx.device,
      country: ctx.country,
      locale: ctx.locale,
    });
  }
  return { saved: true };
}
