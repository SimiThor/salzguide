import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { emailEnabled, sendEmail } from "./email";
import { LEGAL } from "./legal";
import { mailTexts } from "./mail-i18n";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";
import { logOps, opsSubject } from "./ops";
import { safeLocale } from "@/i18n/locales";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Anmeldelink. Eine Mail, ein Weg, unser Design.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// VORHER kam diese Mail von Supabase, aus deren Standardvorlage: englisch („Follow this link
// to login"), in Supabases Gestaltung, von Supabases Absender. Sie war damit die einzige
// unserer Mails, die weder nach uns aussah noch in der Sprache des Empfängers ankam, und
// ausgerechnet die erste, die ein neuer Mensch je von uns bekommt.
//
// WIE ES JETZT LÄUFT, und der Trick ist Supabases eigener (derselbe wie beim Auto-Login nach
// dem Kauf): `generateLink` erzeugt den Anmeldelink samt `hashed_token`, OHNE eine Mail zu
// verschicken. Das Token geht in eine Adresse auf unseren eigenen Rücksprung, die Mail bauen
// und verschicken wir selbst, wie jede andere auch. Am Anmeldevorgang ändert das nichts: Es
// ist dasselbe Token, das Supabase sonst in die eigene Vorlage geschrieben hätte.
//
// DER NOTAUSGANG IST PFLICHT, nicht Vorsicht. Diese Mail ist der EINZIGE Weg in ein Konto
// (Google ausgenommen). Fällt Resend aus, fehlt der Schlüssel oder antwortet die Admin-API
// nicht, sperrt ein Fehler hier jeden aus, der kein Passwort hat. Deshalb schickt in genau
// diesem Fall wieder Supabase seine Standardmail: hässlich und englisch, aber sie kommt an.
//
// WAS DIE BREMSE ERSETZT: Mit Supabases Versand ging auch Supabases Rate-Limit. Der Ersatz
// steht in Migration 0055 (hit_rate_limit) und zählt pseudonymisiert nach Adresse und IP.

/**
 * Was der Aufrufer wissen muss. Bewusst drei Fälle und kein `boolean`:
 * „zu oft" ist etwas anderes als „kaputt" und verdient einen anderen Satz auf dem Bildschirm.
 */
export type LoginLinkResult = "sent" | "rate" | "failed";

// Fenster und Obergrenzen. Absichtlich grosszügig genug, dass ein Mensch, dessen Mail im
// Spam gelandet ist, es zweimal erneut versuchen kann, und eng genug, dass niemand ein
// fremdes Postfach damit zuschüttet.
const WINDOW_SECONDS = 900; // 15 Minuten
const MAX_PER_EMAIL = 4;
const MAX_PER_IP = 15;

/**
 * Zähl-Schlüssel, pseudonymisiert (SHA-256 + Server-Secret als Salz).
 *
 * Ohne das stünde in `rate_limits` eine Liste aller Adressen, die sich je anmelden wollten,
 * mit Zeitstempel. Diese Tabelle soll zählen können, nicht wissen, wer wer ist.
 */
function subject(kind: "mail" | "ip", value: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  const hash = createHash("sha256").update(`${kind}:${value}:${salt}`).digest("hex").slice(0, 32);
  return `login-${kind}:${hash}`;
}

/**
 * Darf diese Adresse (und diese IP) gerade noch eine Mail auslösen?
 *
 * FÄLLT OFFEN AUS, wenn die Funktion fehlt (Code ist deployt, Migration 0055 noch nicht) oder
 * die Datenbank hakt. Andersherum wäre eine hakende Datenbank eine gesperrte Anmeldung für
 * alle, und das ist der schlimmere Fehler: Ein Limit soll Missbrauch bremsen, nicht den
 * Login abschalten.
 */
async function withinLimit(email: string, ip: string | null): Promise<boolean> {
  const svc = createServiceClient();
  const hit = async (subj: string, max: number): Promise<boolean> => {
    try {
      const { data } = await svc.rpc("hit_rate_limit", {
        p_subject: subj,
        p_window_seconds: WINDOW_SECONDS,
        p_max: max,
      });
      return data !== false;
    } catch {
      return true; // siehe oben: fail-open
    }
  };
  // Beide zählen IMMER, auch wenn die erste schon blockt: Sonst könnte man das IP-Limit
  // umgehen, indem man dieselbe Adresse absichtlich ins Limit fährt.
  const [mailOk, ipOk] = await Promise.all([
    hit(subject("mail", email), MAX_PER_EMAIL),
    ip ? hit(subject("ip", ip), MAX_PER_IP) : Promise.resolve(true),
  ]);
  return mailOk && ipOk;
}

/**
 * Dieselbe Mail für die Vorschau im Admin, mit einem Link, der nirgendwo hinführt.
 *
 * Bewusst die ECHTE Render-Funktion und keine Nachbildung: Eine Vorschau, die ihren eigenen
 * Text hat, zeigt irgendwann etwas anderes als das, was rausgeht, und niemand merkt es.
 * Erzeugt kein Token und verschickt nichts.
 */
export function previewLoginMail(locale: string, email: string) {
  return renderLoginMail(locale, email, "#");
}

/** Die Mail selbst. Nur Worte und ein Knopf, der Rahmen kommt aus mail-layout.ts. */
async function renderLoginMail(locale: string, email: string, url: string) {
  const t = (await mailTexts(locale)).login;
  const content: MailContent = {
    locale,
    subject: t.subject,
    headline: t.headline,
    body: t.body,
    // Der eine Knopf, um den es geht. Ohne ihn ist die Mail sinnlos.
    cta: { label: t.cta, url },
    // Die Adresse zurückzeigen deckt Tippfehler auf: Wer drei Adressen hat, sieht hier
    // sofort, mit welcher er gerade hereinkommt.
    tile: { label: t.tileLabel, value: email },
    note: t.note,
  };
  return {
    subject: t.subject,
    html: await renderMailShell(content),
    text: await renderMailShellText(content),
  };
}

/**
 * Den Anmeldelink verschicken. Die EINZIGE Stelle, die das tut.
 *
 * `next` ist ein relativer Pfad auf unserer Seite und MUSS vom Aufrufer geprüft sein (er
 * baut hier die Adresse, auf der jemand nach dem Anmelden landet).
 */
export async function sendLoginLink(opts: {
  email: string;
  /** Sprache des Empfängers. Bestimmt die Mail UND den Pfad, auf dem er zurückkommt. */
  locale: string;
  /** Wohin es nach dem Anmelden geht, relativ ("/de/profil"). */
  next: string;
  /** Basis-Adresse für den Rücksprung, aus authOrigin(). */
  origin: string;
  /** Newsletter-Einwilligung reist als `nl=1` mit und wird erst im Rücksprung gespeichert. */
  newsletter?: boolean;
  /** Client-IP für das zweite Limit. Null = kein IP-Limit (lokal). */
  ip?: string | null;
}): Promise<LoginLinkResult> {
  const locale = safeLocale(opts.locale);
  const email = opts.email;

  if (!(await withinLimit(email, opts.ip ?? null))) {
    // Dass die Bremse greift, ist ein ERFOLG und deshalb keine Fehlermeldung. Interessant
    // wird sie erst als Welle: Wer massenhaft Anmeldelinks anfordert, will ein fremdes
    // Postfach zuschütten und nebenbei unser Resend-Kontingent verbrennen. Die Schwelle
    // dafür (zwanzig im Fenster) steht im Katalog.
    //
    // Ein Fingerabdruck für ALLE Treffer: Es geht um die Menge, nicht um den Einzelfall.
    // Nach Adresse zu gruppieren hiesse, dass ein Angreifer mit tausend Adressen tausend
    // Fingerabdrücke erzeugt und keiner davon je eine Schwelle erreicht.
    await logOps("login_rate_limited", {
      message: "Die Bremse für Anmeldelinks hat gegriffen.",
      subject: opts.ip ? opsSubject("ip", opts.ip) : null,
      group: "login:rate",
    });
    return "rate";
  }

  // Ohne Resend-Schlüssel (lokal, frischer Klon) gibt es keinen eigenen Versand. Dann sofort
  // den Supabase-Weg gehen, statt erst ein Token zu erzeugen, das niemand je zu sehen bekommt.
  if (emailEnabled()) {
    const url = await buildLinkUrl(opts, locale);
    if (url) {
      try {
        const mail = await renderLoginMail(locale, email, url);
        const ok = await sendEmail({
          to: email,
          subject: mail.subject,
          replyTo: LEGAL.email,
          text: mail.text,
          html: mail.html,
        });
        if (ok) return "sent";
        console.error("[login] Anmelde-Mail nicht angenommen, weiche auf Supabase aus");
      } catch (e) {
        console.error("[login] Anmelde-Mail fehlgeschlagen, weiche auf Supabase aus", e);
      }
    }
  }

  // Der Notausgang. Klappt AUCH der nicht, kommt niemand mehr ohne Google in sein Konto —
  // der einzige Ausfall dieser App, der zahlende Kunden buchstäblich aussperrt. Deshalb ist
  // das die einzige Meldestelle im Auth-Bereich, die sofort eine Mail auslöst (Schwelle 1).
  //
  // Gemeldet wird NUR hier, nicht schon beim gescheiterten Eigenversand darüber: Solange
  // der Notausgang trägt, ist nichts passiert, was jemanden wecken müsste.
  if (await sendViaSupabase(opts, locale)) return "sent";

  await logOps("login_mail_failed", {
    message: "Weder der eigene Versand noch Supabase konnten den Anmeldelink zustellen.",
    group: "login:failed",
  });
  return "failed";
}

/**
 * Das Token holen und daraus unsere eigene Rücksprung-Adresse bauen.
 *
 * Die Token-Art kommt aus der ANTWORT und wird nicht auf "magiclink" festgenagelt: Supabase
 * legt bei `generateLink` ein Konto an, falls es die Adresse noch nicht gibt, und liefert dann
 * ein Signup-Token. Wer das als Magic-Link einzulösen versucht, bekommt „otp_expired" — für
 * jeden neuen Menschen wäre die allererste Anmeldung kaputt. (Dieselbe Falle steht in
 * pro/aktivieren/route.ts beschrieben, dort ist sie schon einmal zugeschnappt.)
 *
 * Null = hat nicht geklappt, der Aufrufer nimmt den Notausgang.
 */
async function buildLinkUrl(
  opts: { email: string; next: string; origin: string; newsletter?: boolean },
  locale: string,
): Promise<string | null> {
  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({
      type: "magiclink",
      email: opts.email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[login] Anmeldelink nicht erzeugbar", error?.message);
      return null;
    }
    const url = new URL(`${opts.origin}/${locale}/auth/callback`);
    url.searchParams.set("token_hash", tokenHash);
    url.searchParams.set("type", data.properties.verification_type ?? "magiclink");
    url.searchParams.set("next", opts.next);
    if (opts.newsletter) url.searchParams.set("nl", "1");
    return url.toString();
  } catch (e) {
    console.error("[login] Anmeldelink nicht erzeugbar", e);
    return null;
  }
}

/**
 * Der Notausgang: Supabase schickt seine eigene Mail.
 *
 * Englisch und in fremder Gestaltung, aber sie kommt an, und der Link darin funktioniert.
 * Läuft über den PKCE-Weg, deshalb trägt er `code` statt `token_hash` — der Rücksprung
 * versteht beides (siehe auth/callback/route.ts).
 */
async function sendViaSupabase(
  opts: { email: string; next: string; origin: string; newsletter?: boolean },
  locale: string,
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const redirect =
      `${opts.origin}/${locale}/auth/callback?next=${encodeURIComponent(opts.next)}` +
      (opts.newsletter ? "&nl=1" : "");
    const { error } = await supabase.auth.signInWithOtp({
      email: opts.email,
      options: { emailRedirectTo: redirect },
    });
    if (error) {
      console.error("[login] Auch Supabase-Versand fehlgeschlagen", error.status, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[login] Auch Supabase-Versand fehlgeschlagen", e);
    return false;
  }
}
