import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authOrigin } from "@/lib/site-url";
import { safeLocale } from "@/i18n/locales";
import {
  PRO_CLAIM_COOKIE,
  claimMatches,
  consumeAutoLogin,
  fulfillPaidCheckout,
  markProNoticeSeen,
} from "@/lib/pro-purchase";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Rücksprung von Stripe. Hier wird aus einer Zahlung ein Zugang.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM EINE ROUTE UND KEINE SEITE: Hier müssen Cookies gesetzt werden (die Sitzung des
// frisch angelegten Kontos), und das kann in Next.js nur ein Route-Handler oder eine Server
// Action — nicht das Rendern einer Seite. Deshalb kommt Stripes success_url hierher, und von
// hier geht es per Weiterleitung auf /pro?checkout=… weiter.
//
// Der zweite Grund ist die Adresszeile: Die `session_id` ist der Schlüssel zum Auto-Login.
// Sie darf nicht in einer Adresse stehenbleiben, die im Verlauf landet, geteilt oder aus
// Neugier neu geladen wird. Nach der Weiterleitung ist sie weg.
//
// DIE DREI SCHRANKEN DES AUTO-LOGINS, alle drei müssen halten:
//   1. Stripe selbst sagt „paid" (wir fragen Stripe, wir glauben nicht der Adresszeile).
//   2. Das Konto ist DURCH diesen Kauf entstanden (kind === "created"). Ein Konto, das es
//      vorher gab, wird nie über einen Kauf betreten — die E-Mail an der Kasse ist getippt,
//      nicht bewiesen.
//   3. Der Kauf-Nachweis im Cookie passt zum Hash in der Stripe-Session. Es muss derselbe
//      Browser sein, der bezahlt hat.
// Dazu: genau EIN Einlösen (consumeAutoLogin), danach ist der Weg zu.
//
// Fällt eine Schranke, ist der Kauf trotzdem gültig — der Anspruch hängt an der E-Mail
// (pro_purchases). Dann geht es über das Postfach weiter, so wie jede Anmeldung hier.

export const runtime = "nodejs"; // Stripe-SDK braucht Node (kein Edge)
export const dynamic = "force-dynamic";

/** Stripe-Session-IDs sehen so aus. Alles andere fragen wir nicht erst bei Stripe nach. */
const SESSION_ID_RE = /^cs_[A-Za-z0-9_-]{10,120}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale: rawLocale } = await params;
  const locale = safeLocale(rawLocale);
  const { searchParams, origin } = new URL(request.url);

  /** Ab hier ist die session_id nicht mehr in der Adresse. */
  const done = async (state: ProCheckoutState): Promise<Response> => {
    (await cookies()).delete(PRO_CLAIM_COOKIE);
    return NextResponse.redirect(new URL(`/${locale}/pro?checkout=${state}`, origin));
  };

  const sessionId = searchParams.get("session_id") ?? "";
  if (!stripe || !SESSION_ID_RE.test(sessionId)) return done("help");

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (e) {
    console.error("[pro] Checkout-Session nicht abrufbar", sessionId, e);
    return done("help");
  }

  const result = await fulfillPaidCheckout(session);
  if (!result.ok) {
    // "unpaid" ist kein Fehler: Manche Zahlungsarten (SEPA, Klarna) bestätigen erst später.
    // Der Webhook (checkout.session.async_payment_succeeded) schaltet dann frei.
    return done(result.reason === "unpaid" ? "processing" : "help");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Der Kauf gehört dem, der hier schon eingeloggt ist -> nichts weiter zu tun.
  if (user && (result.kind === "member" || result.userId === user.id)) {
    await markProNoticeSeen(user.id);
    return done("success");
  }

  // In diesem Browser ist jemand ANDERES eingeloggt (zweiter Tab, zwischenzeitliche
  // Anmeldung). Die Sitzung hier auszutauschen wäre ein stiller Konto-Wechsel unter den
  // Händen des Menschen — Pro liegt auf dem gekauften Konto, der Einstieg läuft über die Mail.
  const someoneElseIsLoggedIn = !!user;

  if (
    result.kind === "created" &&
    !result.autoLoginUsed &&
    !someoneElseIsLoggedIn &&
    claimMatches((await cookies()).get(PRO_CLAIM_COOKIE)?.value, result.claimHash) &&
    (await consumeAutoLogin(session.id))
  ) {
    if (await signInBuyer(supabase, result.email)) {
      await markProNoticeSeen(result.userId);
      return done("success");
    }
  }

  // Weg über das Postfach: derselbe Anmeldelink wie überall. Der Anspruch steht bezahlt in
  // pro_purchases und wird beim Anmelden eingelöst (Trigger aus Migration 0053) — auch Tage
  // später und auch, wenn diese Mail im Spam landet und der Mensch sich selbst anmeldet.
  //
  // Wenn die Mail NICHT rausgeht, darf hier nicht „schau in dein Postfach" stehen: Dann
  // wartet jemand auf etwas, das nie kommt. Dieser Fall gehört zu einem Menschen (help).
  const sent = result.email ? await sendAccessLink(supabase, result.email, locale, request.url) : false;
  return done(sent ? "mail" : "help");
}

/** Die Zustände, die /pro nach einem Checkout anzeigen kann. */
type ProCheckoutState = "success" | "mail" | "processing" | "help";

/**
 * Den Käufer einloggen, ohne dass er etwas anklicken muss.
 *
 * Der Trick ist Supabases eigener: `generateLink` erzeugt einen Anmeldelink samt
 * `hashed_token`, ohne eine Mail zu verschicken; `verifyOtp` löst dieses Token direkt ein
 * und legt die Sitzungs-Cookies. Es ist also derselbe Mechanismus wie beim Magic-Link — nur
 * dass wir den Beweis nicht per Mail einsammeln, sondern das Cookie aus dem Checkout ihn
 * schon geliefert hat (siehe Kopf dieser Datei).
 *
 * Rückgabe false = eingeloggt wird nicht, der Aufrufer schickt eine Mail. Keine Ausnahme
 * darf hier nach oben: Der Kauf ist bezahlt und verbucht, ein Fehler beim Einloggen ist
 * eine Unbequemlichkeit, kein verlorenes Geld.
 */
async function signInBuyer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[pro] Anmeldelink nicht erzeugbar", error?.message);
      return false;
    }
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (verifyError) {
      console.error("[pro] Auto-Login fehlgeschlagen", verifyError.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[pro] Auto-Login fehlgeschlagen", e);
    return false;
  }
}

/**
 * Den Anmeldelink an die bezahlte Adresse schicken.
 *
 * Bewusst Supabases Standard-Anmeldemail und keine eigene: Es ist derselbe Vorgang wie eine
 * Anmeldung, also soll auch dieselbe Mail kommen. Eine zweite, eigene Vorlage wäre eine
 * zweite Stelle, an der Absender, Zustellbarkeit und neun Übersetzungen gepflegt werden
 * müssten.
 *
 * Kein Turnstile davor: Die Adresse kommt nicht aus einem Formular, sondern von Stripe, und
 * es gibt sie nur, weil jemand bezahlt hat. Ein Bot müsste erst zahlen.
 */
async function sendAccessLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
  locale: string,
  requestUrl: string,
): Promise<void> {
  try {
    const next = `/${locale}/pro?checkout=success`;
    const origin = await authOrigin(requestUrl);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/${locale}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) console.error("[pro] Zugangs-Mail nicht versendet", error.status, error.message);
  } catch (e) {
    console.error("[pro] Zugangs-Mail nicht versendet", e);
  }
}
