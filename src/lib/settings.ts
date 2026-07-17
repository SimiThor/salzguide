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

/** Schlüssel des Umzugs-Hinweises am Login. Eine Stelle, damit Lesen und Schreiben nicht auseinanderlaufen. */
export const RELAUNCH_NOTICE_KEY = "relaunch_notice";

/**
 * Steht der Umzugs-Hinweis am Login an?
 *
 * Der Hinweis erscheint für ALLE, nicht nur für Alt-Käufer — eine Erkennung an der E-Mail
 * wäre ein Orakel („ist diese Person zahlender Kunde?"), siehe Migration 0041.
 *
 * Fail-closed: Im Zweifel AUS. Ein Hinweis, der wegen eines Fehlers erscheint, verwirrt
 * jeden Neuen, der die alte Plattform nie gesehen hat — und genau die sind die Mehrheit.
 */
export async function getRelaunchNotice(): Promise<boolean> {
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("value")
      .eq("key", RELAUNCH_NOTICE_KEY)
      .maybeSingle();
    return data?.value === "on";
  } catch {
    return false;
  }
}
