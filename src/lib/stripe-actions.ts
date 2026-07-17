"use server";

import type Stripe from "stripe";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { stripe, proPriceId, stripeTaxEnabled } from "./stripe";
import { siteUrl } from "./site-url";

// Stripe-Checkout-Session für die einmalige Pro-Freischaltung anlegen.
// Sicherheit: nur eingeloggt; der Betrag kommt AUSSCHLIESSLICH aus der Stripe-Price-ID
// (Server), NIE aus dem Client -> kein Manipulieren des Preises möglich. Der Stripe-
// Customer wird fest mit dem Supabase-User verknüpft (metadata + stripe_customer_id).
export async function createCheckoutSession(
  locale: string,
  consent: boolean,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!stripe) return { ok: false, error: "unconfigured" };
  const priceId = proPriceId();
  if (!priceId) return { ok: false, error: "no_price" };

  // §18 FAGG: ohne ausdrückliche Zustimmung zur sofortigen Ausführung + Verzicht aufs
  // Widerrufsrecht wird KEINE zahlungspflichtige Session erstellt (serverseitig erzwungen).
  if (consent !== true) return { ok: false, error: "consent" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_pro, stripe_customer_id, email")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.is_pro) return { ok: false, error: "already_pro" };

  // Stripe-Customer holen oder anlegen (mit Supabase-User-ID in den Metadaten).
  let customerId = profile?.stripe_customer_id ?? null;
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? profile?.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      // Verknüpfung am Profil sichern (Service-Client umgeht den Spaltenschutz-Trigger).
      await createServiceClient()
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // Alle Sprachen sind mit Präfix erreichbar (/de, /en, /it …) -> Rücksprung immer
    // in der Sprache des Käufers (nicht mehr nur en, sonst landen it/nl/… auf /de).
    const lp = `/${locale}`;
    // NICHT der Origin-Header: Der kommt vom Client und bestimmt hier, wohin Stripe den
    // Käufer nach der Zahlung zurückschickt. Auf Vercel liefert siteUrl() denselben Wert,
    // nur eben aus einer Quelle, die niemand von aussen setzen kann. Der alte Notnagel
    // zeigte ausserdem auf salzguide.com, also die alte WordPress-Seite.
    const origin = siteUrl();

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user.id,
      // §18-FAGG-Zustimmung als Nachweis in den Metadaten festhalten (Audit-Trail).
      metadata: {
        supabase_user_id: user.id,
        withdrawal_waiver_consent: "true",
        withdrawal_waiver_at: new Date().toISOString(),
      },
      // Hinweis direkt am Bezahl-Button (dokumentiert die sofortige Ausführung).
      custom_text: {
        submit: {
          message:
            "Mit dem Kauf verlangst du die sofortige Bereitstellung von SalzGuide Pro und bestätigst, dass dein Widerrufsrecht damit erlischt (§ 18 FAGG).",
        },
      },
      success_url: `${origin}${lp}/pro?checkout=success`,
      cancel_url: `${origin}${lp}/pro?checkout=cancel`,
    };

    // Produktions-Compliance (AT/EU): erst einschalten, wenn Stripe Tax eingerichtet ist.
    if (stripeTaxEnabled()) {
      params.automatic_tax = { enabled: true };
      params.invoice_creation = { enabled: true };
      params.billing_address_collection = "required";
      params.customer_update = { address: "auto", name: "auto" };
    }

    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) return { ok: false, error: "no_url" };
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "stripe_error" };
  }
}
