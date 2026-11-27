import "server-only";
import { createServiceClient } from "./supabase/service";
import { retireGuestAccount, type AppleStore } from "./apple-purchase-core";
import { supabaseAppleStore } from "./apple-purchase";
import { logOps } from "./ops";

// Gast-Konten (anonyme Anmeldung, Kauf ohne Konto in der iOS-App) nachts aufräumen (Anton 27.11.2026: "dass es nicht
// undurchsichtig wird"). Sicherheitsnetz zum sofortigen Austragen beim Anmelden (POST /api/app/v1/me/retire-guest):
// fängt abgebrochene Käufe, gelöschte Apps und Geräte ab, die sich nie mehr melden.
//
// NACHTS NUR GAST-KONTEN OHNE JEDE VERBINDUNG ZU EINEM KAUF (abgebrochene Käufe, Skripte). Prüfung 27.11.2026: Supabase
// setzt last_sign_in_at/updated_at bei Gast-Konten nur bei der Anlage, nicht bei täglicher Nutzung (Token-Erneuerung).
// Ein Gast-Gerät, das einen Kauf teilt (Regel 2b) oder selbst gekauft hat, sähe nach 30 Tagen "unbenutzt" aus, obwohl es
// täglich läuft; es zu löschen nähme dem Gerät Pro und Pro-Offline-Kopien. Solche Konten bleiben: Mit-Inhaber gehen
// beim Anmelden (retire-guest) oder werden bei mehr als vier Geräten verdrängt, Käufer holt Regel 2a ins echte Konto.

export const GUEST_IDLE_DAYS = 30;
const MAX_PER_RUN = 200;

export type GuestCleanupResult = { checked: number; retired: number; failed: number };

type AuthUser = { id: string; is_anonymous?: boolean; created_at?: string; last_sign_in_at?: string | null; updated_at?: string };

/** Ist dieses Gast-Konto lange genug unbenutzt? Zählt der jüngste von Anlage, letzter Anmeldung und letzter Änderung. */
export function guestIsIdle(user: AuthUser, now: Date, idleDays = GUEST_IDLE_DAYS): boolean {
  if (user.is_anonymous !== true) return false;
  const times = [user.created_at, user.last_sign_in_at ?? undefined, user.updated_at]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return false;
  return now.getTime() - Math.max(...times) > idleDays * 86_400_000;
}

export async function pruneIdleGuests(
  deps: { listUsers?: (page: number) => Promise<AuthUser[]>; store?: AppleStore; now?: Date } = {},
): Promise<GuestCleanupResult> {
  const now = deps.now ?? new Date();
  const store = deps.store ?? supabaseAppleStore();
  const listUsers =
    deps.listUsers ??
    (async (page: number) => {
      const { data, error } = await createServiceClient().auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      return (data?.users ?? []) as AuthUser[];
    });
  const result: GuestCleanupResult = { checked: 0, retired: 0, failed: 0 };
  try {
    for (let page = 1; page <= 50 && result.checked < MAX_PER_RUN; page++) {
      const users = await listUsers(page);
      for (const user of users) {
        if (result.checked >= MAX_PER_RUN) break;
        if (!guestIsIdle(user, now)) continue;
        // Steht in irgendeiner Kauf-Zeile (Besitzer oder Mit-Inhaber): nie nachts (siehe oben).
        if ((await store.listHeldPurchases(user.id)).length > 0) continue;
        result.checked++;
        try {
          if ((await retireGuestAccount(store, user.id)) === "retired") result.retired++;
        } catch {
          result.failed++;
        }
      }
      if (users.length < 1000) break;
    }
  } catch (e) {
    result.failed++;
    console.error("[guests] Liste der Konten nicht lesbar", e instanceof Error ? e.message : e);
  }
  if (result.failed > 0) {
    await logOps("apple_anon_cleanup_failed", {
      message: `Nächtliches Aufräumen der Gast-Konten: ${result.failed} nicht gelöscht.`,
      group: "guests:nightly",
      detail: { geprueft: result.checked, geloescht: result.retired },
    });
  }
  return result;
}
