import Stripe from "stripe";

// Umschalter Test-/Produktions-Stripe-KONTO (zwei getrennte Konten bei Stripe, nicht nur
// zwei Keys desselben Kontos). In Vercel per ENV umlegbar, ohne Deploy: "true" -> die
// STRIPE_*_TEST-Variablen, sonst das echte Produktionskonto. Default = Produktion, damit
// ein vergessenes/leeres Flag nie versehentlich auf Test läuft.
export function stripeTestMode(): boolean {
  return process.env.STRIPE_TEST_MODE === "true";
}

// Serverseitiger Stripe-Client. Der Secret Key liegt NUR in der ENV und verlässt nie
// den Server. Ist kein Key gesetzt (z.B. lokal ohne Stripe), ist `stripe` null -> alle
// Aufrufer prüfen das und antworten sauber statt zu crashen.
const secret = stripeTestMode()
  ? process.env.STRIPE_SECRET_KEY_TEST
  : process.env.STRIPE_SECRET_KEY;

export const stripe: Stripe | null = secret
  ? new Stripe(secret, { typescript: true })
  : null;

// Das Webhook-Signing-Secret gehört zum Endpunkt IM jeweiligen Konto - Test- und
// Produktionskonto haben dafür unterschiedliche Werte, auch wenn beide auf denselben
// /api/stripe/webhook zeigen.
export function stripeWebhookSecret(): string | undefined {
  return stripeTestMode()
    ? process.env.STRIPE_WEBHOOK_SECRET_TEST
    : process.env.STRIPE_WEBHOOK_SECRET;
}

// Die AKTIVE Preis-ID = einzige Quelle der Wahrheit für Betrag & Währung. Sie zeigt auf
// ein Stripe-Price-Objekt; Betrag/Währung kommen IMMER von Stripe (nie aus dem Client,
// nie hardcodiert). Preis ändern/testen = neue Price in Stripe anlegen und diese ID
// setzen -> Anzeige UND Zahlung passen sich automatisch überall an. Test- und Produktionskonto
// haben eigene Produkte/Preise, deshalb eigene ID je Konto.
export function proPriceId(): string | null {
  const id = (
    stripeTestMode() ? process.env.STRIPE_PRO_PRICE_ID_TEST : process.env.STRIPE_PRO_PRICE_ID
  )?.trim();
  return id && id.startsWith("price_") ? id : null;
}

// Stripes Kasse in der Sprache des Käufers anzeigen.
//
// Unsere Sprachcodes (i18n/locales.ts) sind zufällig genau Stripes Sprachcodes — aber nur
// zufällig. Deshalb steht hier Stripes Liste und nicht unsere: Kommt bei uns eine Sprache
// dazu, die Stripe nicht kann (z.B. "sr"), fällt der Checkout auf "auto" zurück (Stripe
// wählt dann nach Browser-Sprache) statt die Session mit einem Fehler abzulehnen. Ein
// abgelehnter Checkout wäre eine verlorene Zahlung wegen einer Übersetzung.
const STRIPE_LOCALES = new Set([
  "bg", "cs", "da", "de", "el", "en", "en-GB", "es", "es-419", "et", "fi", "fil", "fr",
  "fr-CA", "hr", "hu", "id", "it", "ja", "ko", "lt", "lv", "ms", "mt", "nb", "nl", "pl",
  "pt", "pt-BR", "ro", "ru", "sk", "sl", "sv", "th", "tr", "vi", "zh", "zh-HK", "zh-TW",
]);

export function stripeLocale(locale: string): Stripe.Checkout.SessionCreateParams.Locale {
  return STRIPE_LOCALES.has(locale)
    ? (locale as Stripe.Checkout.SessionCreateParams.Locale)
    : "auto";
}

// Produktions-Compliance (AT/EU): automatische Steuer + Rechnung + Pflicht-Adresse.
// Per ENV schaltbar, da es im Stripe-Dashboard eingerichtet sein muss (Stripe Tax).
export function stripeTaxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === "true";
}
