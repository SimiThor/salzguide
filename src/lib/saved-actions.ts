"use server";

import { createClient } from "./supabase/server";
import { getOrCreateDefaultList } from "./saved";
import { findSavableSpot, recordSpotSave } from "./saved-core";

export type ToggleResult = { saved?: boolean; needLogin?: boolean };

// Spot in der Merkliste an-/abspeichern. Verlangt Login.
export async function toggleSaved(slug: string): Promise<ToggleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { needLogin: true };

  const spot = await findSavableSpot(supabase, slug);
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
  await recordSpotSave(supabase, user.id, slug, spot.subtype);
  return { saved: true };
}
