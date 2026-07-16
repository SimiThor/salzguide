import Stripe from "stripe";

// Serverseitiger Stripe-Client. Der Secret Key liegt NUR in der ENV und verlässt nie
// den Server. Ist kein Key gesetzt (z.B. lokal ohne Stripe), ist `stripe` null -> alle
// Aufrufer prüfen das und antworten sauber statt zu crashen.
const secret = process.env.STRIPE_SECRET_KEY;

export const stripe: Stripe | null = secret
  ? new Stripe(secret, { typescript: true })
  : null;

// Die AKTIVE Preis-ID = einzige Quelle der Wahrheit für Betrag & Währung. Sie zeigt auf
// ein Stripe-Price-Objekt; Betrag/Währung kommen IMMER von Stripe (nie aus dem Client,
// nie hardcodiert). Preis ändern/testen = neue Price in Stripe anlegen und diese ID
// setzen -> Anzeige UND Zahlung passen sich automatisch überall an.
export function proPriceId(): string | null {
  const id = process.env.STRIPE_PRO_PRICE_ID?.trim();
  return id && id.startsWith("price_") ? id : null;
}

// Produktions-Compliance (AT/EU): automatische Steuer + Rechnung + Pflicht-Adresse.
// Per ENV schaltbar, da es im Stripe-Dashboard eingerichtet sein muss (Stripe Tax).
export function stripeTaxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === "true";
}
