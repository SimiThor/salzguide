import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendLoginLink } from "@/lib/login-link";
import { authOrigin } from "@/lib/site-url";
import { safeLocale } from "@/i18n/locales";
import { safeTourSlug } from "@/lib/url";
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

  // Wohin nach dem Rücksprung? Standard ist /pro. Kam der Kauf aus einer laufenden Runde,
  // steht ihr Slug in den Metadaten der Stripe-Session, und dann geht es DORTHIN zurück.
  //
  // WARUM DAS ZÄHLT: Der Kauf im Fahrbetrieb passiert auf einem Rad, mitten in der Runde.
  // Landet der Käufer danach auf /pro, sind Karte, Route und Ortung weg, und er muss die
  // Navigation am Straßenrand neu starten. Bis 25.08.2026 war genau das der einzige Ausgang.
  //
  // Der Slug wird trotzdem nochmal geprüft, obwohl ihn createCheckoutSession schon geprüft
  // hat: Was hier ankommt, kam über einen fremden Dienst zurück, und eine zweite Prüfung an
  // der Stelle, an der der Wert BENUTZT wird, kostet nichts.
  let zurueckZu: string | null = null;

  /** Ab hier ist die session_id nicht mehr in der Adresse. */
  const done = async (state: ProCheckoutState): Promise<Response> => {
    (await cookies()).delete(PRO_CLAIM_COOKIE);
    const ziel = zurueckZu
      ? `/${locale}/touren/${zurueckZu}/navigation?checkout=${state}`
      : `/${locale}/pro?checkout=${state}`;
    return NextResponse.redirect(new URL(ziel, origin));
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

  zurueckZu = safeTourSlug(session.metadata?.return_tour);

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
  const sent = result.email
    ? await sendAccessLink(result.email, locale, request.url, zurueckZu)
    : false;
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
    // Die Token-Art kommt aus der Antwort und wird NICHT auf "magiclink" festgenagelt.
    // Supabase legt bei `generateLink` ein Konto an, falls es die Adresse noch nicht gibt —
    // und liefert dann ein Signup-Token. Wer das als Magic-Link einzulösen versucht, bekommt
    // „otp_expired", und der frisch bezahlte Käufer landete ohne erkennbaren Grund auf dem
    // Umweg über sein Postfach. Hier kann das eigentlich nicht passieren (das Konto haben wir
    // eine Zeile vorher selbst angelegt), aber die Antwort weiss es besser als eine Annahme.
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: data.properties.verification_type ?? "magiclink",
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
 * Genau dieselbe Mail wie bei jeder Anmeldung, weil es derselbe Vorgang ist: lib/login-link.ts
 * ist die eine Stelle, die Anmeldelinks verschickt. (Hier stand einmal, das sei bewusst
 * Supabases Standardmail, weil eine eigene Vorlage eine zweite Stelle zum Pflegen wäre. Das
 * Argument stimmt weiter, nur zeigt es inzwischen in die andere Richtung: Es GIBT jetzt genau
 * eine eigene Stelle, und die kennt auch die Sprache des Käufers.)
 *
 * Kein Turnstile davor: Die Adresse kommt nicht aus einem Formular, sondern von Stripe, und
 * es gibt sie nur, weil jemand bezahlt hat. Ein Bot müsste erst zahlen. Das Limit aus
 * login-link.ts greift trotzdem, und das ist hier auch gut so: Wer die Rücksprung-Adresse
 * neu lädt, löst sonst jedes Mal eine weitere Mail aus.
 *
 * GIBT ZURÜCK, OB DIE MAIL RAUSGING, und das ist kein Detail: Der Aufrufer entscheidet
 * daran, ob der Käufer „schau in dein Postfach" liest oder an einen Menschen verwiesen wird.
 * Stand hier `Promise<void>`, war das Ergebnis immer `undefined` — also immer falsch — und
 * jeder Gast, dessen Adresse schon ein Konto hatte, sah nach dem Bezahlen „da hat etwas
 * gehakt", obwohl sein Link längst unterwegs war. TypeScript liess es durch, weil der
 * Ausdruck `void | false` ergibt und nicht blankes `void`.
 */
async function sendAccessLink(
  email: string,
  locale: string,
  requestUrl: string,
  // Runde, aus der der Kauf kam. Der Link aus der Mail führt dann dorthin zurück und nicht
  // auf /pro: Wer am Lenker gekauft hat, will weiterhören, nicht eine Verkaufsseite lesen.
  returnTour: string | null,
): Promise<boolean> {
  try {
    const result = await sendLoginLink({
      email,
      locale,
      next: returnTour
        ? `/${locale}/touren/${returnTour}/navigation?checkout=success`
        : `/${locale}/pro?checkout=success`,
      origin: await authOrigin(requestUrl),
    });
    if (result !== "sent") {
      console.error("[pro] Zugangs-Mail nicht versendet:", result);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[pro] Zugangs-Mail nicht versendet", e);
    return false;
  }
}
