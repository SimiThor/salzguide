import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";

// Stripe-Webhook: setzt nach erfolgreicher Zahlung serverseitig Pro. Sicherheit:
// - SIGNATUR wird gegen STRIPE_WEBHOOK_SECRET geprüft (nur echte Stripe-Events).
// - Pro wird über den Service-Client gesetzt (umgeht den Profil-Spaltenschutz), NIE
//   vom Client. Idempotent (mehrfaches Event -> gleicher Zustand, kein Schaden).
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
      const s = event.data.object as Stripe.Checkout.Session;
      // NUR bei tatsächlich BEZAHLT freischalten. Bewusst KEIN `status==="complete"`:
      // 100%-Gutscheine ("no_payment_required") oder verzögerte Zahlungen ("unpaid")
      // dürfen kein Gratis-Pro auslösen.
      if (s.payment_status === "paid") {
        const userId =
          (s.metadata?.supabase_user_id as string | undefined) ??
          (s.client_reference_id ?? undefined);
        const customerId =
          typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null);
        await grantPro(userId ?? null, customerId);
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

async function findProfileId(
  svc: ReturnType<typeof createServiceClient>,
  userId: string | null,
  customerId: string | null,
): Promise<string | null> {
  if (userId) return userId;
  if (!customerId) return null;
  const { data } = await svc
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function grantPro(userId: string | null, customerId: string | null): Promise<void> {
  const svc = createServiceClient();
  const id = await findProfileId(svc, userId, customerId);
  if (!id) {
    // Bezahlt, aber kein passendes Profil (z.B. Zahlung außerhalb der App / gelöschter
    // User). Sichtbar loggen statt still schlucken.
    console.error("[stripe] paid session without matching profile", { userId, customerId });
    return;
  }
  // Idempotent: schon per Stripe freigeschaltet -> nichts tun (pro_since nicht neu bumpen).
  const { data: cur } = await svc
    .from("profiles")
    .select("is_pro, pro_source")
    .eq("id", id)
    .maybeSingle();
  if (cur?.is_pro && cur?.pro_source === "stripe") return;
  await svc
    .from("profiles")
    .update({
      is_pro: true,
      pro_since: new Date().toISOString(),
      pro_source: "stripe",
      ...(customerId ? { stripe_customer_id: customerId } : {}),
    })
    .eq("id", id);
}

async function revokePro(customerId: string): Promise<void> {
  const svc = createServiceClient();
  // Nur von Stripe stammendes Pro entziehen (migrierte/Comp-Pro nicht anfassen).
  await svc
    .from("profiles")
    .update({ is_pro: false })
    .eq("stripe_customer_id", customerId)
    .eq("pro_source", "stripe");
}
