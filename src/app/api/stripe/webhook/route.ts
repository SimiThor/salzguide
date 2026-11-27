import type Stripe from "stripe";
import { stripe, stripeWebhookSecret } from "@/lib/stripe";
import { fulfillPaidCheckout, proPaymentAccounts, reopenDisputedClaims, revokePro } from "@/lib/pro-purchase";
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
      // Vollständige Rückerstattung -> Pro entziehen (fair & sauber), je Zahlung, und nur, wenn kein
      // anderer bezahlter Kauf (Web oder Apple) das Pro trägt (stripe-refund-core.ts).
      const c = event.data.object as Stripe.Charge;
      if (c.refunded) {
        const customerId = idOf(c.customer);
        if (customerId) await revokePro(customerId, idOf(c.payment_intent));
      }
    } else if (event.type === "charge.dispute.created") {
      // Streitfall eröffnet. Bei einer reinen Anfrage der Bank (warning_*) fließt kein Geld, bei
      // einer Rückbuchung holt die Bank es mit charge.dispute.funds_withdrawn. Darum hier nur melden.
      const d = event.data.object as Stripe.Dispute;
      const pay = await disputedPayment(d);
      if (pay.ours) {
        await logOps("stripe_dispute", {
          message: d.status.startsWith("warning_")
            ? `Anfrage der Bank zu einem Pro-Kauf (Grund: ${d.reason}). Noch kein Geld abgebucht, Pro bleibt. Im Stripe-Dashboard beantworten.`
            : `Rückbuchung zu einem Pro-Kauf eröffnet (Grund: ${d.reason}). Pro wird entzogen, sobald die Bank das Geld abbucht.`,
          detail: { dispute: d.id, charge: pay.chargeId, kunde: pay.customerId, konten: pay.userIds.join(","), betrag: d.amount },
          group: "stripe:dispute",
          path: "/api/stripe/webhook",
        });
      }
    } else if (event.type === "charge.dispute.funds_withdrawn") {
      // Die Bank hat das Geld zurückgeholt (auch eine eskalierte Anfrage): wie eine Erstattung
      // behandeln (Anton 27.11.2026: nie Pro ohne Bezahlung), außer ein anderer bezahlter Kauf trägt
      // Pro. Nur für SalzGuide-Zahlungen; das Stripe-Konto teilt sich die alte WordPress-Seite.
      // Den Streitfall FRISCH lesen: Stripe garantiert keine Reihenfolge und stellt nach einem 500
      // erneut zu. Ist er inzwischen gewonnen (oder als Anfrage geschlossen), nichts entziehen.
      const d = await stripe.disputes.retrieve((event.data.object as Stripe.Dispute).id);
      const pay = await disputedPayment(d);
      const stillLost = d.status === "needs_response" || d.status === "under_review" || d.status === "lost";
      // Auch ohne Kunden-ID: Der Anspruch wird über die Zahlung (payment_intent) gefunden.
      if (pay.ours && stillLost) await revokePro(pay.customerId ?? "", pay.paymentIntent);
      if (pay.ours && stillLost) {
        await logOps("stripe_dispute", {
          message: "Rückbuchung: Die Bank hat das Geld abgebucht. Pro entzogen, außer ein anderer bezahlter Kauf trägt es.",
          detail: { dispute: d.id, charge: pay.chargeId, kunde: pay.customerId, konten: pay.userIds.join(","), betrag: d.amount },
          group: "stripe:dispute",
          path: "/api/stripe/webhook",
        });
      }
    } else if (event.type === "charge.dispute.closed") {
      const d = event.data.object as Stripe.Dispute;
      const pay = await disputedPayment(d);
      if (pay.ours && (d.status === "won" || d.status === "warning_closed")) {
        // Das Geld ist (wieder) bei uns. War die Zahlung nicht zusätzlich erstattet, gilt der
        // Anspruch wieder. Pro setzt ein Mensch (wurde es entzogen, steht das Konto in der Meldung).
        if (!pay.refunded && pay.paymentIntent) {
          await reopenDisputedClaims(pay.paymentIntent);
          // Rennen gegen eine Erstattung genau dazwischen: Zahlung noch einmal lesen. Ist sie jetzt
          // erstattet, den Anspruch wieder schließen (sonst trüge ein Anspruch ohne Geld Pro).
          const again = await stripe.charges.retrieve(pay.chargeId);
          if (again.refunded) await revokePro(pay.customerId ?? "", pay.paymentIntent);
        }
        await logOps("stripe_dispute", {
          message:
            d.status === "won"
              ? "Rückbuchung gewonnen, das Geld ist zurück. Falls Pro entzogen wurde: im Admin für die genannten Konten wieder setzen."
              : "Anfrage der Bank geschlossen, es wurde nichts abgebucht. Nichts zu tun, außer Pro fehlt bei den genannten Konten.",
          detail: { dispute: d.id, charge: pay.chargeId, kunde: pay.customerId, konten: pay.userIds.join(","), status: d.status },
          group: "stripe:dispute_closed",
          path: "/api/stripe/webhook",
        });
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

/** ID aus einem Stripe-Feld schälen (String oder aufgelöstes Objekt). */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Die Zahlung hinter einem Streitfall: Kunde, payment_intent, und ob sie ein SalzGuide-Pro-Kauf ist. */
async function disputedPayment(d: Stripe.Dispute) {
  const charge = await stripe!.charges.retrieve(idOf(d.charge) as string);
  const paymentIntent = idOf(charge.payment_intent);
  const accounts = paymentIntent ? await proPaymentAccounts(paymentIntent) : { known: false, userIds: [] };
  return {
    ours: accounts.known,
    chargeId: charge.id,
    customerId: idOf(charge.customer),
    paymentIntent,
    userIds: accounts.userIds,
    refunded: charge.refunded,
  };
}
