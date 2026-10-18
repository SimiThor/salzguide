import type { EmailOtpType } from "@supabase/supabase-js";

// Was Anmelde-Mail, Bestätigungsseite und Rücksprung gemeinsam wissen müssen.
// Eine Stelle, damit die drei nicht auseinanderlaufen (siehe auth/callback/route.ts).

/**
 * Die Seite, auf der ein Mail-Link landet, relativ zur Sprache.
 *
 * Sie meldet NICHT an, sie zeigt nur einen Knopf. Warum, steht in auth/callback/route.ts:
 * Mail-Prüfer (Outlook/Hotmail Safe Links) rufen Links selbst auf und verbrauchten damit
 * den einmaligen Anmeldelink, bevor der Mensch ihn öffnen konnte.
 */
export const CONFIRM_PATH = "auth/confirm";

/** Query-Parameter, mit dem das Login einen gescheiterten Rücksprung erklärt. */
export const AUTH_ERROR_PARAM = "auth_error";

/**
 * Welche Nachweis-Arten der Rücksprung annimmt. `email` ist die Art, die Supabases eigene
 * Mailvorlage mit {{ .TokenHash }} benutzt; die übrigen liefert generateLink().
 */
export const OTP_TYPES: readonly EmailOtpType[] = [
  "magiclink",
  "signup",
  "email",
  "invite",
  "recovery",
  "email_change",
];
