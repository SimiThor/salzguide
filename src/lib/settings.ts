import "server-only";
import { createServiceClient } from "./supabase/service";

// Aktuelles KI-Chat-Profilbild („Toni"). Wird von der Admin-Einstellungsseite und
// (client-seitig separat) vom Avatar gelesen. app_settings ist öffentlich lesbar;
// hier über den Service-Client robust auch ohne Session.
export async function getToniAvatarUrl(): Promise<string | null> {
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", "toni_avatar_url")
      .maybeSingle();
    return (data?.value as string | null) || null;
  } catch {
    return null;
  }
}
