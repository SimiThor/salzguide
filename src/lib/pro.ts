import { unstable_cache } from "next/cache";
import { bcp47 } from "@/i18n/locales";
import { stripe, proPriceId } from "./stripe";

// Roh-Preis (kleinste Währungseinheit) direkt aus Stripe -> Single Source of Truth.
// Anzeige == Zahlung. Gecacht (1 h), damit nicht jede Seite Stripe anfragt.
export type ProPrice = { amountMinor: number; currency: string };

export const getProPrice = unstable_cache(
  async (): Promise<ProPrice | null> => {
    const id = proPriceId();
    if (!stripe || !id) return null;
    try {
      const price = await stripe.prices.retrieve(id);
      if (!price.active || price.unit_amount == null) return null;
      return { amountMinor: price.unit_amount, currency: price.currency };
    } catch {
      return null;
    }
  },
  ["pro-price-v1"],
  { revalidate: 3600, tags: ["pro-price"] },
);

// Preis lokalisiert formatieren (z.B. "19,90 €" / "€19.90"). Fällt sauber zurück, wenn
// Stripe (noch) nicht konfiguriert ist.
export function formatProPrice(
  price: ProPrice | null,
  locale: string,
  fallback = "",
): string {
  if (!price) return fallback;
  try {
    return new Intl.NumberFormat(bcp47(locale), {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(price.amountMinor / 100);
  } catch {
    return `${(price.amountMinor / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
  }
}
