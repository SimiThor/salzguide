import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTourDetail } from "@/lib/tours";
import BikeNavScreen from "@/components/tours/nav/BikeNavScreen";
import { getProPrice, formatProPrice } from "@/lib/pro";

// Eigener Navigation-Screen NUR für S-Bike-Runden (docs/40). 404 nicht bloss bei einer
// fehlenden Tour, sondern auch bei `mode === "walk"`: Eine Geh-Tour hat keine Etappen-
// Navigation, und ein geteilter Link darf sie nicht versehentlich hineinbooten.
export default async function TourNavigationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const tour = await getTourDetail(slug, locale);
  if (!tour || tour.mode !== "bike") notFound();
  // Preis serverseitig aus Stripe (eine Quelle, gecacht). Damit kann der Kauf im Sheet
  // stattfinden, statt den Gast mitten in der Fahrt auf /pro zu schicken: Dort waeren Karte,
  // Route, Ortung und Wake Lock weg, und die Navigation muesste neu gestartet werden.
  const proPrice = formatProPrice(await getProPrice(), locale);
  return <BikeNavScreen tour={tour} proPrice={proPrice} />;
}
