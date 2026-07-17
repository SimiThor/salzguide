"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { siteUrl } from "@/lib/site-url";
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

// In Produktion die FESTE Site-URL nutzen (nicht den angreifer-steuerbaren Origin-Header)
// -> keine Host-Header-Injection in Login-/OAuth-Redirects. Lokal bleibt der Origin-Header
// für Dev-Bequemlichkeit. Zusätzlich MUSS die Supabase-Redirect-Allowlist eng sein (docs/34).
//
// Die feste Site-URL kommt aus lib/site-url.ts und NICHT mehr direkt aus der Umgebung:
// Stand die Variable dort auf localhost, verschickte diese Funktion klaglos Anmeldelinks
// auf localhost, und niemand kam mehr auf die echte Seite. Supabase fing das nicht ab,
// weil localhost für die lokale Entwicklung auf der Redirect-Allowlist steht.
async function authOrigin(): Promise<string> {
  // Dev: der Origin-Header, damit ein Login auch über 192.168.x.x klappt (Handy im WLAN).
  if (process.env.NODE_ENV !== "production") {
    return (await headers()).get("origin") ?? siteUrl();
  }
  return siteUrl();
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

export type MagicLinkState = { ok: boolean; error?: string } | null;

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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/${locale}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      data: { newsletter_opt_in: newsletter },
    },
  });

  if (error) {
    console.error("signInWithOtp error:", error.message, "redirect:", `${origin}/${locale}/auth/callback`);
    return { ok: false, error: error.message };
  }
  return { ok: true };
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
