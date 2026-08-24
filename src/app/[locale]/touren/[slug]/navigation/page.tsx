import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTourDetail } from "@/lib/tours";
import BikeNavScreen from "@/components/tours/nav/BikeNavScreen";
import { getTestSBikeTour, TEST_SBIKE_SLUG } from "@/lib/test-sbike-tour";

// Eigener Navigation-Screen NUR für S-Bike-Runden (docs/40). 404 nicht bloss bei einer
// fehlenden Tour, sondern auch bei `mode === "walk"`: Eine Geh-Tour hat keine Etappen-
// Navigation, und ein geteilter Link darf sie nicht versehentlich hineinbooten.
//
// TESTHAKEN (lib/test-sbike-tour.ts): die eigene, erfundene Testrunde in Parsch hat
// keine DB-Zeile und wird hier synthetisch gebaut statt über getTourDetail gelesen.
export default async function TourNavigationPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const tour =
    slug === TEST_SBIKE_SLUG
      ? await getTestSBikeTour(locale)
      : await getTourDetail(slug, locale);
  if (!tour || tour.mode !== "bike") notFound();
  return <BikeNavScreen tour={tour} />;
}
