import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTourDetail } from "@/lib/tours";
import BikeNavScreen from "@/components/tours/nav/BikeNavScreen";
import { getProPrice, formatProPrice } from "@/lib/pro";

// Der Navigations-Bildschirm einer Runde (docs/40), am Rad wie zu Fuss. Bis 16.09.2026
// gab es ihn nur fuer mode="bike", eine Geh-Runde antwortete hier mit 404 und ihr grosser
// Knopf spielte bloss den ersten Stopp. Jetzt entscheidet `tour.mode` im Bildschirm ueber
// Routing-Profil, Zahlentabelle und Kamera, die Seite ist fuer beide dieselbe.
export default async function TourNavigationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const tour = await getTourDetail(slug, locale);
  if (!tour) notFound();
  // Preis serverseitig aus Stripe (eine Quelle, gecacht). Damit kann der Kauf im Sheet
  // stattfinden, statt den Gast mitten in der Fahrt auf /pro zu schicken: Dort waeren Karte,
  // Route, Ortung und Wake Lock weg, und die Navigation muesste neu gestartet werden.
  const proPrice = formatProPrice(await getProPrice(), locale);
  return <BikeNavScreen tour={tour} proPrice={proPrice} />;
}
