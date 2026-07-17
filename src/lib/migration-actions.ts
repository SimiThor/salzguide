"use server";

import { requireAdmin } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import { RELAUNCH_NOTICE_KEY } from "./settings";
import { sendEmail } from "./email";
import { LEGAL } from "./legal";
import { siteUrl } from "./site-url";
import {
  MAIL_KEYS,
  getRelaunchMailTexts,
  renderRelaunchMail,
  renderRelaunchText,
  resolveSpots,
  type RelaunchMailTexts,
} from "./relaunch-mail";

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
  // EINMAL vor der Schleife auflösen, nicht pro Mail: Die Spot-Zahl ist für alle dieselbe,
  // und 100 Zählabfragen wären 100 Gelegenheiten, dass eine davon scheitert.
  const texts = await resolveSpots(await getRelaunchMailTexts());
  // Service-Client fürs Markieren: Der Lauf darf nicht daran scheitern, dass die
  // Admin-Session unterwegs abläuft — sonst wären Mails raus und nicht vermerkt.
  const svc = createServiceClient();

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const ok = await sendEmail({
      to: row.email,
      subject: texts.subject,
      replyTo: LEGAL.email,
      text: renderRelaunchText(texts, row.email, login),
      html: renderRelaunchMail(texts, row.email, login),
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

// ── Mailtext bearbeiten, ansehen, testen ─────────────────────────────────────

/**
 * Die Vorschau: exakt das HTML, das rausgeht.
 *
 * Nicht „ungefähr so": Dieselbe Funktion, dieselben Texte. Eine Vorschau, die etwas anderes
 * zeigt als die Mail, ist schlimmer als keine — man verlässt sich darauf und verschickt
 * etwas anderes an 100 zahlende Kunden.
 */
export async function previewRelaunchMail(
  texts?: RelaunchMailTexts,
): Promise<{ ok: boolean; error?: string; html?: string; subject?: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  // Ungespeicherte Eingaben mitschicken können: Man will sehen, was man gerade tippt,
  // nicht was gestern gespeichert wurde.
  const t = texts ?? (await getRelaunchMailTexts());
  const clean: RelaunchMailTexts = {
    subject: String(t.subject ?? "").slice(0, 200).trim() || (await getRelaunchMailTexts()).subject,
    headline: String(t.headline ?? "").slice(0, 200).trim(),
    body: String(t.body ?? "").slice(0, 4000),
    cta: String(t.cta ?? "").slice(0, 80).trim(),
  };
  // Auch die Vorschau löst {spots} auf: Sie soll zeigen, was rausgeht, und nicht den
  // Platzhalter. Im Eingabefeld daneben steht er weiterhin, dort gehört er hin.
  const shown = await resolveSpots(clean);
  return {
    ok: true,
    subject: shown.subject,
    // Die eigene Adresse als Beispiel: So sieht man, wo sie in der Mail steht.
    html: renderRelaunchMail(shown, "du@example.at", `${siteUrl()}/de/profil`),
  };
}

/** Die Texte speichern. Leere Felder fallen später auf die Standardtexte zurück. */
export async function saveRelaunchMailTexts(texts: RelaunchMailTexts): Promise<MigrationResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const rows = [
    { key: MAIL_KEYS.subject, value: String(texts.subject ?? "").slice(0, 200).trim() },
    { key: MAIL_KEYS.headline, value: String(texts.headline ?? "").slice(0, 200).trim() },
    { key: MAIL_KEYS.body, value: String(texts.body ?? "").slice(0, 4000) },
    { key: MAIL_KEYS.cta, value: String(texts.cta ?? "").slice(0, 80).trim() },
  ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));

  const { error } = await createServiceClient().from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

/**
 * Die Mail an den Admin selbst schicken, zum Probelesen.
 *
 * Der Grund, warum das ein eigener Knopf ist: Die Alternative wäre „trag dich in die Liste
 * ein, sende, nimm dich wieder raus" — und dabei vergisst man das Rausnehmen, oder man
 * erwischt beim Senden gleich alle 100. Diese Mail geht NUR an die eigene Adresse und
 * markiert nichts.
 */
export async function sendTestAnnouncement(): Promise<AnnounceResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { data: me } = await gate.supabase
    .from("profiles")
    .select("email")
    .eq("id", gate.userId)
    .maybeSingle();
  const to = me?.email;
  if (!to) return { ok: false, error: "no_email" };

  const texts = await resolveSpots(await getRelaunchMailTexts());
  const login = `${siteUrl()}/de/profil`;
  const ok = await sendEmail({
    to,
    subject: `[Test] ${texts.subject}`,
    replyTo: LEGAL.email,
    text: renderRelaunchText(texts, to, login),
    html: renderRelaunchMail(texts, to, login),
  });
  return ok ? { ok: true, sent: 1, failed: 0 } : { ok: false, error: "send_failed" };
}
