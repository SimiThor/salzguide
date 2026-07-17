"use server";

import { requireAdmin } from "./admin-guard";

// Die Freischalt-Liste für die Käufer der alten WordPress-Plattform pflegen.
//
// Die eigentliche Arbeit macht die Datenbank: `handle_new_user` (Migration 0040) prüft bei
// JEDER Anmeldung, ob die Adresse auf der Liste steht, und setzt Pro in derselben
// Transaktion, in der das Profil entsteht. Hier wird nur eingetragen und entfernt.

export type MigrationResult = { ok: boolean; error?: string; added?: number; skipped?: number };

const EMAIL_RE = /^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}$/;
const MAX_PASTE = 2000;

/**
 * Aus einem hineinkopierten Block Adressen machen: eine pro Zeile, auch Komma oder
 * Semikolon getrennt (so exportieren Plugins gern), klein geschrieben, ohne Dubletten.
 *
 * Gibt gültige UND ungültige zurück — der Admin soll VOR dem Speichern sehen, was gleich
 * passiert. 100 Adressen einzufügen und zu hoffen ist keine Verwaltung.
 */
export async function parseEmails(
  raw: string,
): Promise<{ valid: string[]; invalid: string[] }> {
  const parts = String(raw ?? "")
    .slice(0, 200_000)
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p)) continue; // Dublette im Einfügen selbst: still schlucken, kein Fehler.
    seen.add(p);
    if (p.length >= 6 && p.length <= 254 && EMAIL_RE.test(p)) valid.push(p);
    else invalid.push(p.slice(0, 60));
  }
  return { valid: valid.slice(0, MAX_PASTE), invalid: invalid.slice(0, 20) };
}

/** Adressen eintragen. Schon vorhandene werden übersprungen, nicht überschrieben. */
export async function addProMigrations(
  raw: string,
  note: string,
): Promise<MigrationResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { valid } = await parseEmails(raw);
  if (valid.length === 0) return { ok: false, error: "empty" };

  const cleanNote = String(note ?? "")
    .slice(0, 200)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();

  // Wer schon draufsteht, bleibt wie er ist: Ein zweites Einfügen darf ein bereits
  // EINGELÖSTES claimed_at nicht zurücksetzen — sonst bekäme derselbe Mensch beim nächsten
  // Login ein zweites Mal Pro und die Fortschrittszahl wäre gelogen.
  const { error, count } = await gate.supabase
    .from("pro_migrations")
    .upsert(
      valid.map((email) => ({
        email,
        note: cleanNote || null,
        created_by: gate.userId,
      })),
      { onConflict: "email", ignoreDuplicates: true, count: "exact" },
    );

  if (error) {
    console.error("addProMigrations:", error.message);
    return { ok: false, error: "db" };
  }
  const added = count ?? 0;
  return { ok: true, added, skipped: valid.length - added };
}

/** Einen Eintrag entfernen. Bereits eingelöste lassen wir stehen – siehe unten. */
export async function removeProMigration(email: string): Promise<MigrationResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  // Eingelöste NICHT löschbar: Die Zeile ist dann der Beleg, warum dieser Mensch Pro hat.
  // Wer ihm das Pro nehmen will, tut das in der Nutzerliste — dort wird es protokolliert.
  const { error } = await gate.supabase
    .from("pro_migrations")
    .delete()
    .eq("email", String(email ?? "").toLowerCase())
    .is("claimed_at", null);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}
