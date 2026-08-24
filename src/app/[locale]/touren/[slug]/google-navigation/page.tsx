import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import GoogleBikeNavScreen from "@/components/tours/nav/google/GoogleBikeNavScreen";
import { getTestSBikeTour, TEST_SBIKE_SLUG } from "@/lib/test-sbike-tour";

// ═══ TESTHAKEN – NICHT DAUERHAFT (siehe lib/test-sbike-tour.ts) ═══
// Google-Maps-Testversion der S-Bike-Navigation, geschwisterlich neben der bestehenden
// Mapbox-Navigation (touren/[slug]/navigation/page.tsx), aber bewusst NUR für die eine
// Testrunde erreichbar (nicht für jede `mode==="bike"`-Tour wie das Original): Diese Seite
// ist ein technischer Prototyp zum Vergleichen, kein zweites Produktivfeature, und soll nicht
// versehentlich an einer echten Runde auftauchen, sobald es die einmal gibt.
export default async function GoogleTourNavigationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  if (slug !== TEST_SBIKE_SLUG) notFound();
  const tour = await getTestSBikeTour(locale);
  if (!tour) notFound();
  return <GoogleBikeNavScreen tour={tour} />;
}
