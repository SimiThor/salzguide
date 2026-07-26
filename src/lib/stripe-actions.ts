"use server";

import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { stripe, proPriceId, stripeTaxEnabled, stripeLocale } from "./stripe";
import { siteUrl } from "./site-url";
import {
  PRO_CLAIM_COOKIE,
  PRO_CLAIM_MAX_AGE,
  hashClaim,
  newClaimSecret,
} from "./pro-purchase";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Weg zur Kasse. Für Gäste OHNE Konto davor.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Bis 07/2026 verlangte diese Funktion eine Anmeldung („error: auth"), und die Anmeldung
// ist ein Magic-Link. Zwischen „ich will das" und „ich bezahle" lag also ein Postfach.
// Wer dort abbricht, hat sich nicht gegen Pro entschieden, sondern gegen den Weg dorthin.
//
// Jetzt entsteht das Konto NACH der Zahlung, aus der E-Mail, die Stripe im Checkout ohnehin
// als Pflichtfeld erhebt (siehe lib/pro-purchase.ts). Für den Menschen sind es zwei Tipper:
// Häkchen, Knopf — dann Stripe, wo Apple/Google Pay ein Tap sind.
//
// Was hier NICHT weicher wird:
//   · Der BETRAG kommt aus der Stripe-Price-ID (Server). Nie aus dem Client.
//   · Die §-18-FAGG-Zustimmung wird serverseitig erzwungen, nicht nur im Formular geprüft.
//   · Die Rücksprung-Adresse kommt aus siteUrl(), nie aus einem Header des Aufrufers.

/**
 * Kurzzeit-Bremse gegen automatisiertes Anlegen von Checkout-Sessions.
 *
 * Der Kauf-Knopf ist jetzt ohne Anmeldung erreichbar, und damit auch für Skripte. Ein Limit
 * pro IP kostet echte Käufer nichts (wer kauft achtmal in zehn Minuten?) und nimmt einem
 * Skript die Möglichkeit, unser Stripe-Konto mit Leerläufen zu überziehen.
 *
 * Bewusst KEIN Turnstile am Kauf-Knopf: Ein Roboter-Check, der hängt oder blockt, kostet
 * hier eine Zahlung. Am Login (wo er einen Mailversand schützt) ist der Tausch richtig,
 * an der Kasse nicht.
 */
const CHECKOUT_WINDOW_SECONDS = 600;
const CHECKOUT_MAX_PER_WINDOW = 8;

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

  // Eingeloggt: an das bestehende Konto binden (wie bisher). Gast: Konto entsteht nach der
  // Zahlung. Beide Wege enden in derselben Stripe-Checkout-Session.
  let customerId: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_pro, stripe_customer_id, email")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.is_pro) return { ok: false, error: "already_pro" };
    customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      try {
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
      } catch {
        return { ok: false, error: "stripe_error" };
      }
    }
  } else if (!(await withinCheckoutLimit())) {
    return { ok: false, error: "rate" };
  }

  try {
    // Alle Sprachen sind mit Präfix erreichbar (/de, /en, /it …) -> Rücksprung immer in der
    // Sprache des Käufers.
    const lp = `/${locale}`;
    // NICHT der Origin-Header: Der kommt vom Client und bestimmt hier, wohin Stripe den
    // Käufer nach der Zahlung zurückschickt. Auf Vercel liefert siteUrl() denselben Wert,
    // nur eben aus einer Quelle, die niemand von aussen setzen kann.
    const origin = siteUrl();

    // Der Kauf-Nachweis. Der Klartext geht als httpOnly-Cookie in den Browser des Käufers,
    // nur der Hash reist mit der Stripe-Session. Beim Rücksprung müssen beide zusammen
    // passen, bevor jemand ohne bewiesenes Postfach eingeloggt wird — die zurückkehrende
    // session_id allein (URL, Verlauf, geteilter Link) reicht ausdrücklich nicht.
    const claimSecret = user ? null : newClaimSecret();

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // Stripes Kasse in der Sprache des Käufers. Vorher stand sie immer auf Englisch —
      // an der teuersten Stelle des Wegs.
      locale: stripeLocale(locale),
      // §18-FAGG-Zustimmung als Nachweis in den Metadaten festhalten (Audit-Trail).
      metadata: {
        withdrawal_waiver_consent: "true",
        withdrawal_waiver_at: new Date().toISOString(),
        ...(user ? { supabase_user_id: user.id } : {}),
        ...(claimSecret ? { claim_hash: hashClaim(claimSecret) } : {}),
      },
      // Hinweis direkt am Bezahl-Button (dokumentiert die sofortige Ausführung).
      custom_text: {
        submit: {
          message:
            "Mit dem Kauf verlangst du die sofortige Bereitstellung von SalzGuide Pro und bestätigst, dass dein Widerrufsrecht damit erlischt (§ 18 FAGG).",
        },
      },
      // Der Rücksprung geht auf eine Route, nicht auf die Seite: Nur ein Route-Handler darf
      // Cookies setzen, und genau das ist hier die Arbeit (freischalten + einloggen). Er
      // leitet danach ohne session_id in der Adresse weiter.
      success_url: `${origin}${lp}/pro/aktivieren?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${lp}/pro?checkout=cancel`,
    };

    if (user && customerId) {
      params.customer = customerId;
      params.client_reference_id = user.id;
    } else {
      // Gast: Stripe legt den Kunden selbst an (nötig für Rechnung/Steuer) und erhebt die
      // E-Mail als Pflichtfeld. `customer_update` gibt es hier NICHT — Stripe erlaubt es
      // nur zusammen mit einem übergebenen `customer`.
      params.customer_creation = "always";
    }

    // Produktions-Compliance (AT/EU): erst einschalten, wenn Stripe Tax eingerichtet ist.
    if (stripeTaxEnabled()) {
      params.automatic_tax = { enabled: true };
      params.invoice_creation = { enabled: true };
      params.billing_address_collection = "required";
      if (user && customerId) params.customer_update = { address: "auto", name: "auto" };
    }

    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) return { ok: false, error: "no_url" };

    // Erst jetzt, wenn die Session wirklich existiert: Nachweis in den Browser legen.
    if (claimSecret) {
      const store = await cookies();
      store.set(PRO_CLAIM_COOKIE, claimSecret, {
        httpOnly: true,
        sameSite: "lax", // muss den Rücksprung von stripe.com überleben (Top-Level-GET)
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: PRO_CLAIM_MAX_AGE,
      });
    }

    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "stripe_error" };
  }
}

/**
 * Fixed-Window-Zähler pro IP. Nutzt den vorhandenen Zähler aus Migration 0018
 * (`hit_ai_burst`, Tabelle `ai_burst`): eine Zeile pro Subjekt, atomar in einem Statement.
 * Der Name kommt vom ersten Anwendungsfall, der Mechanismus ist allgemein — dafür eine
 * zweite, gleich gebaute Tabelle anzulegen wäre dieselbe Sache doppelt.
 *
 * FÄLLT NACH OFFEN AUS. Anders als beim KI-Endpunkt, wo ein Aussetzer im Zweifel blockt:
 * Hier kostet ein blockierter Zweifelsfall eine Zahlung. Die Bremse ist gegen Skripte, nicht
 * gegen Kunden.
 */
async function withinCheckoutLimit(): Promise<boolean> {
  try {
    const h = await headers();
    const ip =
      h.get("x-real-ip")?.trim() ||
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";
    if (!ip) return true;
    // IP nie im Klartext ablegen (Datensparsamkeit) — derselbe Kniff wie in api/ai/chat.
    const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "salzguide";
    const subject = `checkout:${createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 24)}`;
    const { data, error } = await createServiceClient().rpc("hit_ai_burst", {
      p_subject: subject,
      p_window_seconds: CHECKOUT_WINDOW_SECONDS,
      p_max: CHECKOUT_MAX_PER_WINDOW,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
