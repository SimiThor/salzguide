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
  resolveTokens,
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

export type AnnounceResult = {
  ok: boolean;
  error?: string;
  sent?: number;
  failed?: number;
  /** Noch offene Zeilen nach diesem Lauf. > 0 heisst: nochmal drücken. */
  remaining?: number;
};

/** Wie viele Mails ein Klick höchstens verschickt. Schützt vor einem Timeout mitten im Lauf. */
const ANNOUNCE_BATCH = 100;

/**
 * Wie lange ein Lauf höchstens arbeitet, bevor er von sich aus aufhört.
 *
 * WARUM DAS NICHT OPTIONAL IST: Der Versand ist seit 07/2026 auf Resends Limit von zwei
 * Mails pro Sekunde gebremst (lib/email.ts). 100 Mails brauchen damit mindestens 55
 * Sekunden, mit Claim-Abfragen und Rendern eher zwei Minuten. Die Plattform bricht eine
 * Server-Action nach `maxDuration` hart ab — mitten im Satz, ohne Rückgabe.
 *
 * Und ein Abbruch GENAU zwischen Claim und Versand ist der eine Fall, den das Muster unten
 * nicht heilen kann: Die Zeile gilt dann als verschickt, die Mail kam nie an. Ein Budget,
 * das deutlich unter dem Zeitlimit der Seite (maxDuration = 300 in der migration/page.tsx)
 * liegt, sorgt dafür, dass der Lauf immer selbst entscheidet, wann er aufhört — an einer
 * Stelle, an der nichts halb erledigt ist.
 *
 * Was übrig bleibt, bleibt unmarkiert und geht beim nächsten Klick raus. `remaining` sagt
 * dem Admin, dass noch etwas offen ist.
 */
const ANNOUNCE_BUDGET_MS = 240_000;

/** Reicht die verbleibende Zeit sicher für noch eine Mail (Pause + Versand + Claim)? */
const PER_MAIL_RESERVE_MS = 15_000;

/**
 * Die Umzugs-Ankündigung an alle verschicken, die sie noch nicht haben.
 *
 * WARUM JEDE ZEILE EINZELN VOR ihrem Versand beansprucht wird (Claim per bedingtem
 * Update, wie mailProGift es vormacht): Ein Lauf über bis zu 100 Mails dauert Minuten.
 * Klicken in diesem Fenster zwei Admin-Sitzungen (oder derselbe Admin nach einem
 * scheinbaren Hänger nochmal), sähen ohne Claim BEIDE Läufe dieselben unmarkierten
 * Zeilen – und jeder zahlende Kunde bekäme die Mail doppelt. Das ist kein
 * Schönheitsfehler, sondern der erste Eindruck der neuen Plattform.
 *
 * Der Preis der Reihenfolge „erst markieren, dann senden": Stirbt die Funktion GENAU
 * zwischen Claim und Versand (Timeout), gilt eine Mail als verschickt, die nie ankam –
 * ein einzelner Mensch, sichtbar im Log. Scheitert der Versand NORMAL, wird der Claim
 * sofort wieder gelöst und der nächste Lauf versucht es erneut. Das Doppel-Mail-Risiko
 * traf dagegen potenziell alle 100 auf einmal.
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
  // EINMAL vor der Schleife auflösen, nicht pro Mail: Die Zahlen sind für alle dieselben,
  // und 100 Zählabfragen wären 100 Gelegenheiten, dass eine davon scheitert.
  const texts = await resolveTokens(await getRelaunchMailTexts());
  // Service-Client fürs Markieren: Der Lauf darf nicht daran scheitern, dass die
  // Admin-Session unterwegs abläuft — sonst wären Mails raus und nicht vermerkt.
  const svc = createServiceClient();

  const deadline = Date.now() + ANNOUNCE_BUDGET_MS;

  let sent = 0;
  let failed = 0;
  let stoppedEarly = false;
  for (const row of rows) {
    // Vor JEDER Mail prüfen, ob die Zeit noch reicht — und zwar VOR dem Claim, damit keine
    // Zeile markiert zurückbleibt, deren Mail nie losging.
    if (Date.now() + PER_MAIL_RESERVE_MS > deadline) {
      stoppedEarly = true;
      console.warn(
        `[migration] Zeitbudget aufgebraucht nach ${sent} Mails – Rest bleibt offen für den nächsten Lauf.`,
      );
      break;
    }

    // Claim: Zeile bedingt markieren. Kommt nichts zurück, hat ein paralleler Lauf sie
    // schon – überspringen statt doppelt mailen (Muster wie mailProGift).
    const { data: claimed, error: claimErr } = await svc
      .from("pro_migrations")
      .update({ announced_at: new Date().toISOString() })
      .eq("email", row.email)
      .is("announced_at", null)
      .select("email");
    if (claimErr) {
      console.error("sendMigrationAnnouncement: Claim fehlgeschlagen", row.email, claimErr.message);
      failed++;
      continue;
    }
    if (!(claimed ?? []).length) continue; // schon von einem anderen Lauf verschickt

    const ok = await sendEmail({
      to: row.email,
      subject: texts.subject,
      replyTo: LEGAL.email,
      text: await renderRelaunchText(texts, row.email, login),
      html: await renderRelaunchMail(texts, row.email, login),
    });

    if (!ok) {
      // Claim wieder lösen: Der nächste Lauf soll es nochmal versuchen. Wer den Umzug
      // nie erfährt, steht irgendwann ratlos vor einer fremden Seite.
      const { error: unclaimErr } = await svc
        .from("pro_migrations")
        .update({ announced_at: null })
        .eq("email", row.email);
      if (unclaimErr)
        console.error(
          "sendMigrationAnnouncement: Mail scheiterte UND Claim hängt – Zeile gilt fälschlich als verschickt",
          row.email,
          unclaimErr.message,
        );
      failed++;
      continue;
    }
    sent++;
  }

  // Wie viel ist noch offen? Head-Zählung (überträgt keine Zeilen). Nur nötig, wenn der
  // Lauf abgebrochen hat oder die Liste voll war — sonst ist der Rest per Definition leer.
  let remaining = 0;
  if (stoppedEarly || rows.length === ANNOUNCE_BATCH) {
    const { count } = await svc
      .from("pro_migrations")
      .select("email", { count: "exact", head: true })
      .is("announced_at", null);
    remaining = count ?? 0;
  }

  return { ok: true, sent, failed, remaining };
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
  const shown = await resolveTokens(clean);
  return {
    ok: true,
    subject: shown.subject,
    // Die eigene Adresse als Beispiel: So sieht man, wo sie in der Mail steht.
    html: await renderRelaunchMail(shown, "du@example.at", `${siteUrl()}/de/profil`),
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

  const texts = await resolveTokens(await getRelaunchMailTexts());
  const login = `${siteUrl()}/de/profil`;
  const ok = await sendEmail({
    to,
    subject: `[Test] ${texts.subject}`,
    replyTo: LEGAL.email,
    text: await renderRelaunchText(texts, to, login),
    html: await renderRelaunchMail(texts, to, login),
  });
  return ok ? { ok: true, sent: 1, failed: 0 } : { ok: false, error: "send_failed" };
}
