import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { fulfillPaidCheckout, revokePro } from "@/lib/pro-purchase";

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
  if (!stripe) return new Response("stripe not configured", { status: 503 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("no webhook secret", { status: 503 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  const raw = await req.text(); // ROHE Bytes für die Signaturprüfung (nicht parsen!)
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      // NUR bei tatsächlich BEZAHLT freischalten — die Prüfung sitzt in fulfillPaidCheckout.
      // Ein unbezahltes Event ist hier kein Fehler, sondern schlicht nichts zu tun.
      const result = await fulfillPaidCheckout(event.data.object as Stripe.Checkout.Session);
      if (!result.ok && result.reason === "error") {
        // 500 -> Stripe stellt erneut zu. Genau dafür sind die Wiederholungen da.
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
  } catch {
    // Fehler -> 500, damit Stripe das Event automatisch erneut zustellt.
    return new Response("handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
