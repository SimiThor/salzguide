import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { safeLocale } from "@/i18n/locales";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Rechnungslink aus der Kaufbestätigungsmail. Er löst beim KLICK auf, nicht beim Kauf.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM ERST BEIM KLICK: Die Kaufbestätigung muss sofort und genau einmal raus (§ 7 Abs. 3
// FAGG, siehe pro-purchase-mail.ts) — Stripe erstellt die Rechnung aber erst NACH dem
// Checkout, asynchron. Zum Mail-Zeitpunkt gibt es die Rechnungsadresse also meist noch
// nicht. Deshalb steht in der Mail ein Link auf DIESE Route, und sie fragt im Moment des
// Klicks bei Stripe nach. Nebeneffekt, der den Umweg doppelt rechtfertigt: Stripes eigene
// Adressen können ablaufen oder rotieren, hier gibt es bei jedem Klick eine frische.
//
// DER SCHLÜSSEL ist pro_purchases.invoice_token (Migration 0063), NICHT die session_id:
// Die ist der Schlüssel zum Auto-Login und darf nicht dauerhaft in einer Mail stehen, die
// weitergeleitet oder Monate später aus dem Postfach geöffnet wird (siehe Kopf von
// ../aktivieren/route.ts). Das Token hier kann genau eines: die eigene Rechnung zeigen.
// Deshalb auch keine Cookies und kein Verbrauchen — der Link darf beliebig oft klappen,
// eine Rechnung schaut man auch im März fürs Finanzamt noch an.
//
// ERST DIE DATENBANK, DANN STRIPE: Ohne Treffer in pro_purchases wird Stripe gar nicht
// gefragt. Sonst wäre die Route ein offener Proxy, mit dem sich fremde Stripe-Objekte
// abklopfen liessen; so prallt jedes Raten an einer UUID-Spalte ab.
//
// DIE KETTE beim Auflösen, in dieser Reihenfolge:
//   1. Rechnung fertig  -> hosted_invoice_url (die Seite mit Ansehen + PDF-Download).
//   2. Noch nicht fertig, oder es gibt nie eine (invoice_creation hängt an
//      STRIPE_TAX_ENABLED, siehe stripe-actions.ts) -> receipt_url des Charge. Den gibt es
//      ab dem Moment der Zahlung, und die Mail geht nur bei „paid" raus.
//   3. Beides (noch) nicht -> /pro?invoice=pending, „probier's gleich nochmal".
// Ein zurückerstatteter Kauf bleibt absichtlich auflösbar: Der Beleg gehört in die
// Unterlagen, gerade nach einem Widerruf.

export const runtime = "nodejs"; // Stripe-SDK braucht Node (kein Edge)
export const dynamic = "force-dynamic";

/**
 * So sieht ein invoice_token aus (randomUUID / gen_random_uuid). Alles andere fliegt vor
 * der Datenbank raus — nicht nur Hygiene: Die Spalte ist vom Typ uuid, ein Nicht-UUID-Text
 * würde schon am Cast scheitern und als Fehler statt als „kein Treffer" enden.
 */
const INVOICE_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale: rawLocale } = await params;
  const locale = safeLocale(rawLocale);
  const { searchParams, origin } = new URL(request.url);

  /** Die zwei Sackgassen zeigen ihre Erklärung auf /pro (invoice=pending|missing). */
  const done = (state: "pending" | "missing"): Response =>
    NextResponse.redirect(new URL(`/${locale}/pro?invoice=${state}`, origin));

  const token = searchParams.get("token") ?? "";
  if (!INVOICE_TOKEN_RE.test(token)) return done("missing");

  const { data: row } = await createServiceClient()
    .from("pro_purchases")
    .select("stripe_session_id")
    .eq("invoice_token", token)
    .maybeSingle();
  const sessionId = (row?.stripe_session_id as string | undefined) ?? null;
  if (!sessionId) return done("missing");

  // Ohne Stripe keine Auskunft, aber auch kein Drama: „pending" ist ehrlich, der nächste
  // Klick trifft eine konfigurierte Umgebung. Der Kauf selbst wäre daran nie gescheitert
  // (der Kaufweg meldet stripe_not_configured, siehe webhook/route.ts).
  if (!stripe) {
    console.error("[pro] Rechnungslink ohne Stripe-Konfiguration", sessionId);
    return done("pending");
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["invoice", "payment_intent.latest_charge"],
    });

    // 1. Die Rechnung. `invoice` ist ohne expand nur eine ID; mit expand das Objekt samt
    //    hosted_invoice_url — die fehlt, solange Stripe die Rechnung nicht finalisiert hat.
    const invoice = session.invoice;
    if (invoice && typeof invoice !== "string" && invoice.hosted_invoice_url) {
      return NextResponse.redirect(invoice.hosted_invoice_url);
    }

    // 2. Der Zahlungsbeleg. Über den PaymentIntent an den Charge, beide können laut Typ
    //    auch blosse IDs sein, deshalb die typeof-Prüfungen.
    const paymentIntent = session.payment_intent;
    const charge =
      paymentIntent && typeof paymentIntent !== "string"
        ? paymentIntent.latest_charge
        : null;
    if (charge && typeof charge !== "string" && charge.receipt_url) {
      return NextResponse.redirect(charge.receipt_url);
    }

    // 3. Beides noch nicht da (frisch bezahlt, Stripe noch am Schreiben).
    return done("pending");
  } catch (e) {
    // resource_missing heisst: Diese Session gibt es unter dem AKTUELLEN Schlüssel nicht —
    // praktisch immer ein Test-Kauf, nachdem der Server wieder auf Live steht (oder
    // umgekehrt). Das wird nie mehr etwas, also „missing" und nicht ein ewiges „gleich
    // fertig". Alles andere (Netz, Stripe-Ausfall) ist morgen vorbei -> „pending".
    // Kein logOps: Es ist kein Geld verloren und niemand ausgesperrt, die Pflicht erfüllt
    // die Mail selbst, und Antworten auf die Mail ist der Weg zu uns (Mail.reply).
    const code = (e as { code?: string } | null)?.code;
    console.error("[pro] Rechnungslink nicht auflösbar", sessionId, e);
    return done(code === "resource_missing" ? "missing" : "pending");
  }
}
