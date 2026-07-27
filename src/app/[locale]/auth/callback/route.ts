import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { claimVerifiedLogin } from "@/lib/pro-purchase";
import { safeLocale } from "@/i18n/locales";

// Magic-Link-Rücksprung: Nachweis gegen Sitzung tauschen, dann weiterleiten.
//
// ZWEI SORTEN LINK KOMMEN HIER AN, und beide müssen funktionieren:
//
//   `token_hash` + `type` — unsere eigene Anmelde-Mail (lib/login-link.ts). Der Nachweis
//       steht direkt in der Adresse und wird mit verifyOtp eingelöst. Das ist der Weg, den
//       Supabase für selbstgebaute Anmeldemails vorsieht.
//   `code` — der PKCE-Weg. Den benutzt Supabases eigene Mail, also der Notausgang, wenn
//       unser Versand nicht klappt, und der Google-Login.
//
// Der Rest (Newsletter, Sprache merken, geliehene Sitzungen kappen) ist für beide gleich und
// steht deshalb NACH der Verzweigung, nicht doppelt darin.
const OTP_TYPES: readonly EmailOtpType[] = [
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  // Die Art kommt aus der Adresse und ist damit von aussen setzbar. Gegen die bekannte Liste
  // prüfen, statt sie durchzureichen: Ein Fremdwert ginge sonst roh an die Auth-API.
  const rawType = searchParams.get("type") ?? "";
  const otpType = OTP_TYPES.find((t) => t === rawType);
  const { locale } = await params;
  // Wohin, wenn `next` fehlt oder unbrauchbar ist: auf die Karte, nicht auf „/" — dort
  // liegt seit 07/2026 die Verkaufs-Startseite, und wer sich gerade eingeloggt hat, ist
  // kein neuer Besucher mehr. Betrifft nur den blanken Magic-Link (LoginGate schickt
  // immer ein `next` mit) — also genau den Weg, den man am seltensten nachtestet.
  const fallback = `/${locale}/explore`;

  // Open-Redirect-Schutz (bulletproof): `next` gegen unsere Origin auflösen und die
  // RESULTIERENDE Origin prüfen. So entscheidet der WHATWG-Parser selbst — deckt
  // "//evil", "/\evil", Tab/Newline-Tricks und absolute URLs ab, ohne String-Raten.
  // Nur wenn das Ziel exakt auf unserer Origin liegt, wird der Pfad übernommen.
  const rawNext = searchParams.get("next") ?? fallback;
  let nextPath = fallback;
  try {
    const u = new URL(rawNext, origin);
    if (u.origin === origin) nextPath = u.pathname + u.search;
  } catch {
    /* ungültig -> fallback */
  }

  if (code || (tokenHash && otpType)) {
    const supabase = await createClient();
    const { data, error } =
      tokenHash && otpType
        ? await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash })
        : await supabase.auth.exchangeCodeForSession(code!);
    if (!error) {
      // Die Sprache merken, in der sich dieser Mensch anmeldet.
      //
      // WOZU: Es ist der einzige verlässliche Zeitpunkt, an dem wir Konto UND Sprache
      // gleichzeitig in der Hand haben. Jede spätere Mail (Kaufbestätigung, geschenktes Pro)
      // entsteht ohne offene Seite und ohne Sprache in der Adresse — der Stripe-Webhook
      // kommt von Stripes Servern, der Admin-Klick vom Schreibtisch in Salzburg. Ohne diesen
      // Vermerk stünde `profiles.locale` für immer auf dem Standard 'de', und ein Koreaner
      // bekäme deutsche Post.
      //
      // Ein Fehler hier darf den Login NICHT aufhalten: Wer sich anmeldet, kommt herein, auch
      // wenn der Vermerk danebengeht. Dann ist die nächste Mail in der falschen Sprache, und
      // das ist deutlich billiger als eine gescheiterte Anmeldung.
      if (data?.user) {
        try {
          await supabase
            .from("profiles")
            .update({ locale: safeLocale(locale) })
            .eq("id", data.user.id);
        } catch (e) {
          console.error("locale merken:", e instanceof Error ? e.message : e);
        }
      }

      // Newsletter-Einwilligung einlösen (`nl=1` hat der Login an diesen Link gehängt).
      //
      // WARUM ERST HIER: Das Häkchen im Formular ist eine Behauptung („mir gehört diese
      // Adresse"), der Klick auf den Link in DIESEM Postfach ist der Beweis. Erst beide
      // zusammen ergeben eine nachweisbare Einwilligung (Art. 7 Abs. 1 DSGVO, § 174 TKG).
      // Wer eine fremde Adresse einträgt, kommt hier nie an — genau das ist der Sinn.
      //
      // Nur von „nein" auf „ja": Das `.eq("newsletter_opt_in", false)` ist die halbe Miete.
      // Ohne das überschriebe jeder spätere Login den Zeitpunkt der Einwilligung, und der
      // Nachweis „seit wann" wäre wertlos.
      //
      // Ein Fehler hier darf den Login NICHT aufhalten: Wer sich anmeldet, kommt herein,
      // auch wenn das Häkchen verloren geht. Deshalb try/catch ohne Konsequenz.
      if (searchParams.get("nl") === "1" && data?.user) {
        try {
          await supabase
            .from("profiles")
            .update({ newsletter_opt_in: true, newsletter_opt_in_at: new Date().toISOString() })
            .eq("id", data.user.id)
            .eq("newsletter_opt_in", false);
        } catch (e) {
          console.error("newsletter opt-in:", e instanceof Error ? e.message : e);
        }
      }

      // Geliehene Sitzungen aus einem Gast-Kauf kappen.
      //
      // Wer als Gast kauft, bekommt sofort eine Sitzung, ohne sein Postfach bewiesen zu
      // haben — der Nachweis war das Cookie aus dem Checkout (siehe pro/aktivieren). Das ist
      // der richtige Tausch, hat aber eine offene Kante: Wer an Stripes Kasse eine fremde
      // Adresse eintippt, sitzt danach in einem Konto, das diese fremde Adresse trägt.
      //
      // HIER wird das Postfach bewiesen — anders kommt niemand durch diese Route. Ab jetzt
      // gilt nur noch diese Sitzung, alle älteren fliegen raus. Für den Käufer selbst ist
      // das unsichtbar: Seine neue Sitzung ist die, die bleibt.
      if (data?.user && (await claimVerifiedLogin(data.user.id))) {
        try {
          // scope "others" lässt die gerade entstandene Sitzung ausdrücklich stehen.
          await supabase.auth.signOut({ scope: "others" });
        } catch (e) {
          // Ein Login darf hieran nicht scheitern.
          console.error("signOut(others):", e instanceof Error ? e.message : e);
        }
      }

      // Der Login bringt den Menschen nur noch dorthin, wo er hinwollte.
      //
      // Die einmalige Begrüssung "dein Pro ist da" hing bis 0044 hier: Wer als Alt-Käufer
      // hereinkam, wurde aufs Profil umgeleitet und in derselben Bewegung als informiert
      // markiert — auch wenn er den Gruss nie zu Gesicht bekam. Und für geschenktes Pro
      // gab es überhaupt keinen Weg, weil da niemand durch diese Route kommt.
      //
      // Jetzt entscheidet ein Zustand in der Datenbank, und ProNotice zeigt den Gruss
      // dort, wo der Mensch gerade ist (siehe lib/pro-notice-actions.ts). Die Begründung
      // aus Migration 0041 bleibt damit gewahrt: Persönliches erst NACH dem Login, nie
      // davor, sonst wäre es ein Orakel für fremde Adressen.
      return NextResponse.redirect(new URL(nextPath, origin));
    }
  }

  const errUrl = new URL(nextPath, origin);
  errUrl.searchParams.set("auth_error", "1");
  return NextResponse.redirect(errUrl);
}
