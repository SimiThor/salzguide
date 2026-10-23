import "server-only";
import { createServiceClient } from "./supabase/service";

/**
 * Kern der Konto-Löschung (DSGVO Art. 17) für Web (deleteMyAccount in account-actions.ts,
 * "use server") und App-API (DELETE /api/app/v1/me). Steht hier, weil ein Export wie dieser in
 * der Action-Datei jedes Konto per POST löschbar machte (docs/41 Abschnitt 2).
 *
 * Die ID MUSS vom Aufrufer bereits beim Auth-Server bestätigt sein (auth.getUser). Diese
 * Funktion fragt nichts mehr.
 *
 * Räumt nur, was das Web auch räumt: ai_usage hängt per Text-Subject (kein FK) am User und
 * wird ausdrücklich entfernt; der Rest (profiles, saved_lists/-items, saved_events,
 * ai_conversations/-messages) fällt über on delete cascade an auth.users. Die IP-Schlüssel in
 * rate_limits sind pseudonym und nicht am Konto verknüpft (docs/34, data-retention.ts).
 */
export async function deleteAccountCore(userId: string): Promise<{ error: string | null }> {
  const service = createServiceClient();
  await service.from("ai_usage").delete().eq("subject", `u:${userId}`);
  const { error } = await service.auth.admin.deleteUser(userId);
  return { error: error ? error.message : null };
}
