import "server-only";
import { createHash } from "node:crypto";
import { createServiceClient } from "./supabase/service";
import { emailEnabled, sendEmail } from "./email";
import { LEGAL } from "./legal";
import { mailTexts } from "./mail-i18n";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";
import { logOps, opsSubject } from "./ops";
import { safeLocale } from "@/i18n/locales";
import { withinLimit, type LoginLinkResult } from "./login-link";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Anmelde-Code für die iOS-App (docs/41, Abschnitt 5). Eine Mail, NUR mit dem Code.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM EIN CODE UND KEIN LINK: Mail-Prüfer (Outlook Safe Links) öffnen Links vorab und
// verbrauchen das Einmal-Token. Einen Code tippt man ab, da kann kein Scanner etwas einlösen.
// Die App löst ihn mit `verifyOTP(email:token:type: .email)` ein.
//
// DAS KONTINGENT TEILT SICH MIT DEM WEB: `withinLimit` ist dieselbe Funktion mit denselben
// Schlüsseln (`login-mail:<hash>`, `login-ip:<hash>`) wie bei sendLoginLink. Die App hat kein
// Turnstile; hätte sie ein eigenes Kontingent, bekäme ein Mail-Bomber Web- PLUS App-Menge.
//
// KEIN NOTAUSGANG ÜBER SUPABASE (anders als login-link.ts): Supabases eigene Mail enthält
// nur einen Link. Fällt unser Versand aus, antwortet die Route mit "unavailable", und die
// App zeigt das als Ausfall. Wer dann nicht weiterkommt, hat den Web-Link und Google.

/** Wie sendLoginLink, plus "invalid": Supabase hat die Adresse selbst abgelehnt (kein Ausfall). */
export type LoginCodeResult = LoginLinkResult | "invalid";

// Zusatzgrenzen NUR für den App-Pfad (Web-Schlüssel bleiben unberührt). Die App hat kein
// Turnstile; ohne diese Grenzen verteilt jemand mit einem IPv6-Block (jede Adresse eine eigene
// IP) oder vielen Absendern das Web-Limit auf beliebig viele Schlüssel.
const IP6_WINDOW_SECONDS = 900; // wie das Web-IP-Limit
const IP6_MAX = 15;
const GLOBAL_WINDOW_SECONDS = 3600;
const GLOBAL_MAX = 200; // Deckel für ALLE App-Code-Mails pro Stunde, schützt das Resend-Kontingent

/**
 * Eine Zählung über hit_rate_limit. FÄLLT OFFEN AUS, auch beim globalen Deckel: genau wie
 * withinLimit im Web (login-link.ts) wird bei einem Fehler der Zählung durchgelassen, weil ein
 * Limit Missbrauch bremsen soll und nicht den Login abschalten, wenn die Zählung selbst hakt.
 */
async function hit(subj: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data } = await createServiceClient().rpc("hit_rate_limit", {
      p_subject: subj,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    return data !== false;
  } catch {
    return true;
  }
}

/**
 * Das /64-Präfix einer IPv6-Adresse (ein Anschluss bekommt meist ein ganzes /64, also wäre
 * jede Adresse darin sonst ein eigener IP-Schlüssel). Null bei IPv4, IPv4-in-IPv6 und Unlesbarem.
 */
export function ipv6Prefix64(ip: string): string | null {
  const raw = ip.split("%")[0].toLowerCase();
  if (!raw.includes(":") || raw.includes(".")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":");
}

function ip6Subject(prefix: string): string {
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
  const hash = createHash("sha256").update(`ip6:${prefix}:${salt}`).digest("hex").slice(0, 32);
  return `login-app-ip6:${hash}`;
}

// Strenger als email-valid.ts (das bleibt für das Web unverändert): keine "..", Domain-Teile
// beginnen und enden alphanumerisch, Local-Part ohne Punkt am Rand.
export function strictAppAddress(email: string): boolean {
  const [local, domain, ...rest] = email.split("@");
  if (rest.length || !local || !domain) return false;
  if (local.startsWith(".") || local.endsWith(".") || email.includes("..")) return false;
  return domain.split(".").every((l) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l));
}

/**
 * Erzeugt den Code OHNE eine Mail zu verschicken (derselbe Trick wie beim Web-Link).
 *
 * NEUE ADRESSEN: `generateLink` legt das Konto an, falls es die Adresse noch nicht gibt, und
 * liefert dann ein Signup-Token (verification_type "signup"; Falle aus login-link.ts). Für den
 * Code ist das egal: `email_otp` steht in beiden Fällen in der Antwort, und supabase-swift
 * `verifyOTP(type: .email)` löst auch den Signup-Code ein (bewiesen in
 * scripts/app-login-code-check.ts). Deshalb wird hier, anders als beim Link, KEINE Token-Art
 * weitergereicht.
 *
 * Gibt nie den Grund nach aussen: Ob die Adresse schon ein Konto hatte, soll niemand erfahren.
 */
export async function createLoginCode(
  email: string,
): Promise<{ ok: true; code: string } | { ok: false; reason: "failed" | "invalid" }> {
  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const code = data?.properties?.email_otp;
    // Eine ABGELEHNTE Adresse (email_address_invalid, validation_failed) ist ein Eingabefehler und
    // kein Ausfall: kein Alarm, die Route antwortet 400.
    // NUR diese beiden Codes. Jedes andere 400/422 (z. B. signup_disabled) ist eine kaputte
    // Konfiguration und muss als Ausfall alarmieren; als "invalid" würde es versteckt und
    // machten neue und bestehende Adressen unterscheidbar.
    if (error && (error.code === "email_address_invalid" || error.code === "validation_failed")) {
      return { ok: false, reason: "invalid" };
    }
    if (error || !code || !/^\d{6,8}$/.test(code)) {
      // Nur die Meldung, nie Adresse oder Code. Die Länge (6-8 Stellen, Länge ist eine
      // Dashboard-Einstellung, docs/41 Abschnitt 5) ist eine
      // Dashboard-Einstellung und wird bewusst NICHT hart verlangt: Steht sie noch auf 8, soll
      // der Login laufen statt mit 503 und kritischem Alarm bei jedem Versuch zu scheitern.
      console.error("[login-code] Code nicht erzeugbar", error?.message ?? "kein numerischer Code");
      return { ok: false, reason: "failed" };
    }
    return { ok: true, code };
  } catch (e) {
    console.error("[login-code] Code nicht erzeugbar", e);
    return { ok: false, reason: "failed" };
  }
}

/** Die Mail selbst: Überschrift, zwei Sätze, der Code in der Kachel. Rahmen aus mail-layout.ts. */
async function renderLoginCodeMail(locale: string, code: string) {
  const t = (await mailTexts(locale)).loginCode;
  const content: MailContent = {
    locale,
    subject: t.subject,
    headline: t.headline,
    body: t.body,
    // Bewusst ohne cta: Ein Knopf wäre ein Link, und genau den gibt es hier nicht.
    tile: { label: t.codeLabel, value: code },
    note: t.note,
  };
  return {
    subject: t.subject,
    html: await renderMailShell(content),
    text: await renderMailShellText(content),
  };
}

/** Für die Vorschau im Admin: die echte Render-Funktion mit einem Platzhalter-Code. */
export function previewLoginCodeMail(locale: string, code = "123456") {
  return renderLoginCodeMail(locale, code);
}

/**
 * Den Code verschicken. Reihenfolge wie beim Web: erst die Bremse, dann das Token, dann die
 * Mail. Drei Fälle statt boolean, damit die App "zu oft" und "kaputt" unterschiedlich sagt.
 */
export async function sendLoginCode(opts: {
  email: string;
  /** Sprache des Empfängers (Pflicht, wie bei jeder Mail). */
  locale: string;
  /** Client-IP für das zweite Limit. Null = kein IP-Limit. */
  ip: string | null;
}): Promise<LoginCodeResult> {
  const locale = safeLocale(opts.locale);

  // Billige Prüfung vor jeder Zählung: Eine offensichtlich kaputte Adresse verbrennt kein Limit.
  if (!strictAppAddress(opts.email)) return "invalid";

  // App-eigene IPv6-Grenze vor dem geteilten Web-Kontingent und vor generateLink.
  const prefix = opts.ip ? ipv6Prefix64(opts.ip) : null;
  if (prefix && !(await hit(ip6Subject(prefix), IP6_WINDOW_SECONDS, IP6_MAX))) {
    await logOps("login_rate_limited", {
      message: "Die Bremse für Anmeldelinks hat gegriffen.",
      subject: opsSubject("ip", prefix),
      group: "login:rate",
    });
    return "rate";
  }
  if (!(await withinLimit(opts.email, opts.ip))) {
    // Gleiche Meldung und gleicher Fingerabdruck wie im Web: Es zählt die Menge, nicht der Fall.
    await logOps("login_rate_limited", {
      message: "Die Bremse für Anmeldelinks hat gegriffen.",
      subject: opts.ip ? opsSubject("ip", opts.ip) : null,
      group: "login:rate",
    });
    return "rate";
  }

  // DER GLOBALE DECKEL ZÄHLT ZULETZT, nach IPv6-Eimer und Web-Schlüsseln. hit_rate_limit zählt
  // auch abgelehnte Aufrufe mit; stünde er vorn, füllte EIN Rechner ihn mit ~200 Anfragen und
  // sperrte alle App-Nutzer eine Stunde aus. So zählen nur Anfragen, die Pro-IP- und
  // Pro-Adress-Grenze schon bestanden haben.
  if (!(await hit("login-app:global", GLOBAL_WINDOW_SECONDS, GLOBAL_MAX))) {
    // Eigene Gruppe: Ein globaler Deckel heisst "viele Absender zugleich" und gehört getrennt
    // von der Einzel-IP-Bremse sichtbar.
    await logOps("login_rate_limited", {
      message: "Der globale Deckel für App-Anmeldecodes hat gegriffen.",
      group: "login:app-global",
    });
    return "rate";
  }

  // Ohne Resend-Schlüssel gibt es keinen Versand. Dann gar nicht erst ein Token erzeugen
  // (das für eine neue Adresse sogar ein Konto anlegte), das niemand je zu sehen bekommt.
  if (!emailEnabled()) {
    await failed("kein Versandschlüssel");
    return "failed";
  }

  const created = await createLoginCode(opts.email);
  if (!created.ok) {
    if (created.reason === "invalid") return "invalid";
    await failed("Code nicht erzeugbar");
    return "failed";
  }

  try {
    const mail = await renderLoginCodeMail(locale, created.code);
    const ok = await sendEmail({
      to: opts.email,
      subject: mail.subject,
      replyTo: LEGAL.email,
      text: mail.text,
      html: mail.html,
    });
    if (ok) return "sent";
    // Nicht doppelt melden: sendEmail hat die Ablehnung schon als mail_send_failed bzw.
    // mail_channel_down gemeldet (email.ts).
  } catch (e) {
    console.error("[login-code] Code-Mail fehlgeschlagen", e);
    await failed("Ausnahme beim Versand");
  }
  return "failed";
}

// Gleiche Art und gleiche Gruppe wie der Web-Ausfall: Es ist derselbe Kanal (Resend), und
// "weg" heisst für die App-Nutzer dasselbe wie für das Web. `detail.weg` trennt die Quellen.
async function failed(grund: string): Promise<void> {
  await logOps("login_mail_failed", {
    message: "Der Anmelde-Code konnte nicht zugestellt werden.",
    group: "login:failed",
    detail: { weg: "app-code", grund },
  });
}
