"use server";

import { requireAdmin } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import { RELAUNCH_NOTICE_KEY } from "./settings";
import { sendEmail } from "./email";
import { LEGAL } from "./legal";
import { siteUrl } from "./site-url";

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

// ── Ankündigung ──────────────────────────────────────────────────────────────

export type AnnounceResult = { ok: boolean; error?: string; sent?: number; failed?: number };

/** Wie viele Mails ein Klick höchstens verschickt. Schützt vor einem Timeout mitten im Lauf. */
const ANNOUNCE_BATCH = 100;

/**
 * Die Umzugs-Ankündigung an alle verschicken, die sie noch nicht haben.
 *
 * WARUM JEDE ZEILE EINZELN MARKIERT WIRD, direkt nach ihrem Versand:
 * Bricht der Lauf in der Mitte ab (Timeout, Resend-Limit, Netz), schickt der nächste Klick
 * genau den Rest — nicht alles nochmal. Bei 100 zahlenden Kunden ist „aus Versehen zweimal
 * angeschrieben" kein Schönheitsfehler, sondern der erste Eindruck der neuen Plattform.
 *
 * Deshalb auch: erst senden, DANN markieren. Andersherum gälte eine Mail als verschickt,
 * die nie ankam — und dieser Mensch erführe nie vom Umzug.
 */
export async function sendMigrationAnnouncement(): Promise<AnnounceResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { data, error } = await gate.supabase
    .from("pro_migrations")
    .select("email")
    .is("announced_at", null)
    .limit(ANNOUNCE_BATCH);
  if (error) return { ok: false, error: "db" };

  const rows = (data ?? []) as { email: string }[];
  if (rows.length === 0) return { ok: true, sent: 0, failed: 0 };

  const login = `${siteUrl()}/de/profil`;
  // Service-Client fürs Markieren: Der Lauf darf nicht daran scheitern, dass die
  // Admin-Session unterwegs abläuft — sonst wären Mails raus und nicht vermerkt.
  const svc = createServiceClient();

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const ok = await sendEmail({
      to: row.email,
      subject: "SalzGuide ist neu – dein Pro bleibt",
      replyTo: LEGAL.email,
      text:
        `Hallo,\n\n` +
        `wir haben SalzGuide komplett neu gebaut: schneller, mit einer richtigen Karte und ` +
        `Toni, unserem KI-Guide, der jeden Spot kennt.\n\n` +
        `Dein Pro nehmen wir mit. Unbegrenzt, ohne dass du nochmal zahlst.\n\n` +
        `So kommst du rein – es dauert 20 Sekunden:\n` +
        `1. ${login} öffnen\n` +
        `2. Diese E-Mail-Adresse eingeben (${row.email})\n` +
        `3. Auf den Link tippen, den wir dir schicken\n\n` +
        `Ein Passwort brauchst du nicht mehr. Es gibt keins, und du musst dir keins merken: ` +
        `Du bekommst jedes Mal einen Link per Mail. Wer lieber mit Google reingeht, kann das ` +
        `auch – Hauptsache dieselbe Adresse, daran erkennen wir dich.\n\n` +
        `Sobald du drin bist, ist dein Pro da. Falls nicht, schreib uns einfach auf diese ` +
        `Mail zurück, wir kümmern uns.\n\n` +
        `Anton & Simon\n${LEGAL.company}`,
    });

    if (!ok) {
      // NICHT markieren: Der nächste Lauf soll es nochmal versuchen. Wer den Umzug nie
      // erfährt, steht irgendwann ratlos vor einer fremden Seite.
      failed++;
      continue;
    }
    const { error: markErr } = await svc
      .from("pro_migrations")
      .update({ announced_at: new Date().toISOString() })
      .eq("email", row.email);
    if (markErr) {
      // Mail ist raus, Vermerk fehlt -> der nächste Lauf schriebe nochmal. Laut loggen,
      // damit es jemand sieht, statt es still zu schlucken.
      console.error("sendMigrationAnnouncement: nicht vermerkt", row.email, markErr.message);
    }
    sent++;
  }

  return { ok: true, sent, failed };
}

// ── Login-Hinweis ────────────────────────────────────────────────────────────

/**
 * Den Umzugs-Hinweis am Login ein- und ausschalten.
 *
 * Er gilt für ALLE, nicht nur für Alt-Käufer: Eine Erkennung an der eingegebenen E-Mail
 * wäre ein Orakel („ist diese Person zahlender Kunde?"). Und weil er alle sieht, muss man
 * ihn auch wieder loswerden können — in ein paar Monaten kennt niemand mehr die alte Seite,
 * und dann ist der Satz nur noch Ballast für Leute, die uns zum ersten Mal besuchen.
 */
export async function setRelaunchNotice(on: boolean): Promise<MigrationResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: RELAUNCH_NOTICE_KEY, value: on ? "on" : "off", updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: "db" };
  return { ok: true };
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
