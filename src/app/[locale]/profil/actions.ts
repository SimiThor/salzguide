"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendLoginLink } from "@/lib/login-link";
import { authOrigin } from "@/lib/site-url";
import { routing } from "@/i18n/routing";

// locale aus dem (manipulierbaren) Formularfeld auf eine bekannte Sprache festnageln
// -> keine getürkten Pfade/Redirect-URLs aus einem gefälschten locale-Wert.
function safeLocale(v: FormDataEntryValue | null): string {
  const s = String(v ?? "");
  return (routing.locales as readonly string[]).includes(s)
    ? s
    : routing.defaultLocale;
}

// Rücksprungziel nach dem Login. Nur EIGENE relative Pfade zulassen ("/…", aber NICHT
// "//…" oder "/\…" oder mit Whitespace) -> kein Open-Redirect. Fallback: Profil.
function safeNext(v: FormDataEntryValue | null, locale: string): string {
  const raw = String(v ?? "");
  return /^\/(?![/\\])[^\s]*$/.test(raw) ? raw : `/${locale}/profil`;
}

// Strikte E-Mail-Validierung (Defense-in-Depth). Die Eingabe geht ohnehin nur an die
// GoTrue-Auth-API (parametrisiert) und via gebundenem Trigger-Insert in die DB -> KEINE
// SQL-Injection möglich. Diese Prüfung wehrt zusätzlich ab: Fehlformate, E-Mail-Header-
// Injection (CR/LF/Steuerzeichen), Homograph-/Whitespace-Tricks und übergroße Payloads.
// Regex bewusst LINEAR (negierte Zeichenklassen, kein verschachtelter Quantor) -> kein ReDoS.
// Praxissicherer ASCII-Zeichensatz: deckt real zustellbare E-Mails (Gmail/Outlook/… lassen
// im Local-Part nur ASCII zu, IDN-Domains kommen als Punycode xn--). Blockt HTML-/Injection-
// Metazeichen (< > " ' ; ( ) [ ] \ etc.), Whitespace und Steuerzeichen implizit.
const EMAIL_RE =
  /^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}$/;
// Steuerzeichen/CRLF explizit verbieten (Defense-in-Depth, ohne von der Regex abzuhängen).
const CONTROL_RE = /[\x00-\x1f\x7f]/;
function isValidEmail(email: string): boolean {
  return (
    email.length >= 6 &&
    email.length <= 254 && // RFC 5321 Obergrenze
    EMAIL_RE.test(email) &&
    !CONTROL_RE.test(email)
  );
}

/**
 * Was der Login-Screen vom Server zurückbekommt.
 *
 * `error` ist eine feste, kurze Liste von Codes ("email" | "captcha" | "rate" | "send") und
 * NIE die Original-Meldung von Supabase. Die stand hier vorher drin und ging damit an den
 * Browser: Sätze wie „Email rate limit exceeded" verraten Fremden, wie unser Mail-Kontingent
 * eingestellt ist und wo die Grenzen liegen — kostenlose Aufklärung für jeden, der die Seite
 * abklopft. Die echte Meldung gehört ins Server-Log, der Mensch bekommt einen Satz, mit dem
 * er etwas anfangen kann.
 *
 * `email` kommt bei Erfolg zurück, damit der Screen die Adresse zeigen kann, an die wirklich
 * gesendet wurde (getrimmt und kleingeschrieben) — das deckt Tippfehler auf.
 */
export type MagicLinkState =
  | { ok: true; email: string }
  | { ok: false; error: string }
  | null;

// Magic-Link senden (Login/Signup ohne Passwort) + optionale Newsletter-Einwilligung
export async function sendMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  // Raw-Länge VOR dem Trim kappen -> kein Verarbeiten absurd großer Payloads.
  const rawEmail = String(formData.get("email") ?? "");
  if (rawEmail.length > 320) return { ok: false, error: "email" };
  const email = rawEmail.trim().toLowerCase();
  const locale = safeLocale(formData.get("locale"));
  const newsletter = formData.get("newsletter") === "on";

  if (!isValidEmail(email)) return { ok: false, error: "email" };

  // Bot-Schutz: Turnstile-Token verifizieren, BEVOR eine Mail ausgelöst wird (schützt das
  // Supabase-Mail-Kontingent). Ohne konfigurierte Keys ist das Gate aus (Dev).
  const reqHeaders = await headers();
  const remoteip =
    reqHeaders.get("x-real-ip") ??
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(captchaToken, remoteip))) {
    return { ok: false, error: "captcha" };
  }

  const nextPath = safeNext(formData.get("next"), locale);
  const origin = await authOrigin();

  // ── Newsletter: die Einwilligung reist mit dem Link, sie wird hier NICHT gespeichert ──
  //
  // Vorher hing sie als `data: { newsletter_opt_in }` an signInWithOtp. Das hatte zwei
  // Löcher, und beide sind rechtliche, nicht kosmetische:
  //
  //   1. Supabase wertet `data` NUR aus, wenn der Mensch neu ist. Wer schon ein Konto hatte
  //      und beim nächsten Login das Häkchen setzte, hakte ins Leere: Der Trigger lief nicht
  //      mehr, die Einwilligung fiel still unter den Tisch. Man bestellt etwas und bekommt
  //      es nie.
  //   2. GoTrue legt die Zeile in auth.users schon beim VERSENDEN an, nicht erst beim
  //      Klicken. Der Trigger schrieb die Einwilligung also fest, bevor irgendwer bewiesen
  //      hatte, dass ihm die Adresse gehört. Wer eine fremde Adresse eintippte und das
  //      Häkchen setzte, meldete damit einen fremden Menschen zum Newsletter an.
  //
  // Jetzt hängt die Einwilligung als `nl=1` am Rücksprung-Link und wird erst im Callback
  // gespeichert — also erst, nachdem jemand den Link in DIESEM Postfach geöffnet hat. Das
  // ist ein echtes Double-Opt-in (§ 174 TKG / Art. 7 DSGVO: nachweisbare Einwilligung), und
  // es kostet keinen zusätzlichen Schritt, weil der Link ohnehin geklickt werden muss.
  //
  // Die Mail baut und verschickt lib/login-link.ts: unser Rahmen, unsere Worte, in der
  // Sprache, in der dieses Formular gerade dasteht. `locale` ist oben schon festgenagelt.
  const result = await sendLoginLink({
    email,
    locale,
    next: nextPath,
    origin,
    newsletter,
    ip: remoteip,
  });

  // "zu oft probiert" darf der Mensch erfahren: Es sagt ihm, dass Warten hilft, statt ihn
  // dieselbe Adresse zehnmal neu eintippen zu lassen. Und es verrät nichts über fremde
  // Konten — die Grenze hängt an Adresse und IP des Absenders, nicht daran, ob es das Konto
  // gibt. Alles andere ist "send": ein Fehler, den der Mensch nicht beheben kann.
  if (result === "rate") return { ok: false, error: "rate" };
  if (result === "failed") return { ok: false, error: "send" };
  return { ok: true, email };
}

// Login/Signup via Google (OAuth, PKCE). Supabase generiert die Google-URL + legt den
// PKCE-Verifier als Cookie ab; der Callback tauscht den Code gegen die Session.
//
// KONTO-ZUSAMMENFÜHRUNG (bewusst über Supabase-Standard gelöst): Meldet sich jemand mit
// Google an, dessen E-Mail bereits als normales (Magic-Link-)Profil existiert – oder
// umgekehrt –, verknüpft Supabase beide Identitäten zu EINEM Nutzer, sofern die E-Mail
// verifiziert ist (Google liefert immer `email_verified`, Magic-Link-Mails sind bestätigt).
// Ergebnis: dieselbe user.id -> dieselbe `profiles`-Zeile (Pro-Status bleibt). Kein
// Duplikat, keine Übernahme fremder Konten (Angreifer bräuchte Zugriff auf Postfach ODER
// Google-Konto der Ziel-E-Mail). Voraussetzung: „Link accounts with same email" bleibt in
// Supabase aktiv (Standard). [[salzguide-deploy]]
export async function signInWithGoogle(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const nextPath = safeNext(formData.get("next"), locale);
  const origin = await authOrigin();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/${locale}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      // Immer Konto-Auswahl erzwingen -> kein stilles Einloggen mit einem falschen/fremden
      // Google-Konto, das noch im Browser aktiv ist.
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    console.error("signInWithOAuth error:", error?.message);
    redirect(`/${locale}/profil?auth_error=1`);
  }
  // Weiterleitung zu Google (außerhalb try/catch: redirect() wirft intern NEXT_REDIRECT).
  redirect(data.url);
}

export async function signOut(formData: FormData) {
  const locale = safeLocale(formData.get("locale"));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/profil`);
}
