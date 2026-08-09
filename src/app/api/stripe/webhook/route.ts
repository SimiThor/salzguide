import type Stripe from "stripe";
import { stripe, stripeWebhookSecret } from "@/lib/stripe";
import { fulfillPaidCheckout, revokePro } from "@/lib/pro-purchase";
import { logOps, subjectFromRequest } from "@/lib/ops";
import { errorMessage } from "@/lib/ops-scrub";

// Stripe-Webhook: der verlässliche Weg zur Freischaltung. Sicherheit:
// - SIGNATUR wird gegen STRIPE_WEBHOOK_SECRET geprüft (nur echte Stripe-Events).
// - Freigeschaltet wird über den Service-Client (umgeht den Profil-Spaltenschutz), NIE
//   vom Client. Idempotent (mehrfaches Event -> gleicher Zustand, kein Schaden).
//
// Die Arbeit selbst steht in lib/pro-purchase.ts, weil sie sich der Rücksprung-Route teilt:
// Der Käufer soll sofort weiterkommen (Route), und er soll auch dann Pro bekommen, wenn er
// den Tab zumacht oder seine Zahlung erst Stunden später bestätigt wird (dieser Webhook).
// Zwei Wege, ein Ergebnis — der Primärschlüssel pro_purchases.stripe_session_id sorgt dafür.
export const runtime = "nodejs"; // Stripe-SDK braucht Node-Runtime (kein Edge)
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Fehlt hier etwas, kann NIEMAND kaufen — und weil ein Käufer, der nicht kaufen kann,
  // sich selten meldet, ist das ein Ausfall, der sich totstellt. Deshalb gemeldet, statt
  // still ein 503 zurückzugeben.
  const secret = stripeWebhookSecret();
  if (!stripe || !secret) {
    await logOps("stripe_not_configured", {
      message: !stripe
        ? "STRIPE_SECRET_KEY (bzw. _TEST im Testmodus) fehlt. Käufe können nicht verarbeitet werden."
        : "STRIPE_WEBHOOK_SECRET (bzw. _TEST im Testmodus) fehlt. Bezahlte Käufe werden nicht freigeschaltet.",
      group: "stripe:config",
      path: "/api/stripe/webhook",
    });
    return new Response("stripe not configured", { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  const raw = await req.text(); // ROHE Bytes für die Signaturprüfung (nicht parsen!)
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
  } catch (e) {
    // Einzelne sind harmlos (ein alter Endpunkt in Stripe, ein Testereignis). Erst eine
    // Häufung ist ein Signal — entweder passt unser Secret nicht mehr zum Endpunkt, oder
    // jemand schickt uns selbstgebaute Zahlungsereignisse. Die Schwelle dafür steht im
    // Katalog, nicht hier.
    await logOps("stripe_bad_signature", {
      message: "Webhook mit ungültiger Signatur abgewiesen.",
      error: e,
      // Ohne diese zwei Felder war am 09.08.2026 nicht zu unterscheiden, ob Stripe selbst
      // gegen ein falsches Secret lief (Endpoint-Umzug!) oder jemand Ereignisse nachbaut:
      // logOps wirft errorMessage(e) weg, sobald eine feste message übergeben wird. Stripes
      // Fehlertexte („No signatures found matching…", „Timestamp outside the tolerance
      // zone") tragen keine Rohdaten. Der Signatur-Header selbst bleibt draussen.
      //
      // stripeAbsender ist nur in EINE Richtung beweiskräftig: Der User-Agent ist frei
      // wählbar. false entlarvt einen Fremden sicher; true ist bloss eine Behauptung, der
      // Beweis steht im Stripe-Dashboard (fehlgeschlagene Zustellungen).
      detail: {
        grund: errorMessage(e),
        stripeAbsender: (req.headers.get("user-agent") ?? "").startsWith("Stripe/"),
      },
      path: "/api/stripe/webhook",
      subject: subjectFromRequest(req),
      group: "stripe:bad_signature",
    });
    return new Response("invalid signature", { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      // NUR bei tatsächlich BEZAHLT freischalten — die Prüfung sitzt in fulfillPaidCheckout.
      // Ein unbezahltes Event ist hier kein Fehler, sondern schlicht nichts zu tun.
      const session = event.data.object as Stripe.Checkout.Session;
      const result = await fulfillPaidCheckout(session);
      if (!result.ok && result.reason === "error") {
        // 500 -> Stripe stellt erneut zu. Genau dafür sind die Wiederholungen da.
        //
        // Trotzdem gemeldet, und nicht erst nach dem letzten Versuch: Wir sehen Stripes
        // Wiederholungen nicht (die laufen bei Stripe, nicht bei uns), wir sehen nur den
        // einzelnen Fehlschlag. Wer auf „den letzten" warten wollte, wartet ewig. Löst es
        // sich beim zweiten Versuch von selbst, war es eine Mail zu viel — das ist der
        // richtige Preis dafür, dass ein liegengebliebener Kauf niemals unbemerkt bleibt.
        await logOps("stripe_webhook_failed", {
          message: "Freischaltung nach dem Webhook fehlgeschlagen. Stripe stellt erneut zu.",
          detail: { stripeSession: session.id, ereignis: event.type },
          group: "stripe:fulfillment",
          path: "/api/stripe/webhook",
        });
        return new Response("fulfillment failed", { status: 500 });
      }
    } else if (event.type === "charge.refunded") {
      // Vollständige Rückerstattung -> Pro entziehen (fair & sauber).
      const c = event.data.object as Stripe.Charge;
      if (c.refunded) {
        const customerId =
          typeof c.customer === "string" ? c.customer : (c.customer?.id ?? null);
        if (customerId) await revokePro(customerId);
      }
    }
  } catch (e) {
    // Fehler -> 500, damit Stripe das Event automatisch erneut zustellt.
    await logOps("stripe_webhook_failed", {
      message: `Unbehandelter Fehler beim Verarbeiten von „${event.type}".`,
      error: e,
      detail: { ereignis: event.type },
      group: "stripe:handler",
      path: "/api/stripe/webhook",
    });
    return new Response("handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
