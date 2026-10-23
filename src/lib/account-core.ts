import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Kerne der Profil-Einstellungen für Web (setNewsletter in account-actions.ts, rememberLocale in
// locale-actions.ts, beide "use server") und App-API (PATCH /api/app/v1/me). Hier und nicht in
// den Action-Dateien, weil jeder Export dort ein öffentlicher POST-Endpunkt wäre (docs/41
// Abschnitt 2). Der ÜBERGEBENE Client trägt die Identität: Die RLS lässt nur die eigene Zeile
// durch, `newsletter_opt_in` und `locale` sind nicht vom Privilegien-Trigger (0016) geschützt.

// WICHTIG FÜR ALLE AUFRUFER: `userId` muss die per auth.getUser() bestätigte ID des Handelnden
// sein, nie ein Wert aus dem Request. Admins dürfen über die RLS jedes Profil ändern; eine
// fremde ID hier wäre für einen Admin-Token ein Schreibzugriff auf fremde Profile.

/** Spalten für newsletter_opt_in(+_at), mit Nachweis-Zeitstempel (siehe applyNewsletter). */
function newsletterColumns(optIn: boolean) {
  return {
    newsletter_opt_in: optIn,
    newsletter_opt_in_at: optIn ? new Date().toISOString() : null,
  };
}

/**
 * Sprache und/oder Newsletter in EINEM Update setzen (App: PATCH /me). Gleiche Spalten und
 * Regeln wie applyNewsletter/applyProfileLocale. `locale` muss vorher geprüft sein.
 */
export async function applyProfilePatch(
  client: SupabaseClient,
  userId: string,
  patch: { locale?: string; newsletter?: boolean },
): Promise<{ error: string | null }> {
  const columns: Record<string, unknown> = {};
  if (patch.locale !== undefined) columns.locale = patch.locale;
  if (patch.newsletter !== undefined) Object.assign(columns, newsletterColumns(patch.newsletter));
  if (Object.keys(columns).length === 0) return { error: null };
  const { error } = await client.from("profiles").update(columns).eq("id", userId);
  return { error: error ? error.message : null };
}

/**
 * Newsletter-Einwilligung setzen oder widerrufen.
 *
 * Der Zeitstempel MUSS mitgeführt werden. Art. 7 Abs. 1 DSGVO verlangt, dass wir eine
 * Einwilligung nachweisen können, und „ja" ohne „seit wann" ist kein Nachweis. Beim Widerruf
 * zurück auf null: Der Zeitpunkt gehört zu einer BESTEHENDEN Einwilligung. Bleibt er stehen,
 * sieht ein Widerruf später aus wie eine gültige Zustimmung von damals.
 */
export async function applyNewsletter(
  client: SupabaseClient,
  userId: string,
  optIn: boolean,
): Promise<{ error: string | null }> {
  const { error } = await client
    .from("profiles")
    .update(newsletterColumns(optIn))
    .eq("id", userId);
  return { error: error ? error.message : null };
}

/**
 * Die Sprache am Konto vermerken (`profiles.locale` bestimmt die Sprache unserer Mails).
 * `locale` MUSS vorher geprüft sein (safeLocale im Web, feste Liste in der App-API).
 */
export async function applyProfileLocale(
  client: SupabaseClient,
  userId: string,
  locale: string,
): Promise<{ error: string | null }> {
  const { error } = await client.from("profiles").update({ locale }).eq("id", userId);
  return { error: error ? error.message : null };
}
