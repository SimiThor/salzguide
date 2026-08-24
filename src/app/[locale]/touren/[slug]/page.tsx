import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTourDetail } from "@/lib/tours";
import { alternatesFor, ogFor } from "@/lib/metadata";
import TourView from "@/components/tours/TourView";
import { getTestSBikeTour, TEST_SBIKE_SLUG } from "@/lib/test-sbike-tour";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const tour = await getTourDetail(slug, locale);
  if (!tour) return {};
  return {
    title: tour.title,
    description: tour.subtitle ?? undefined,
    alternates: alternatesFor(locale, `/touren/${slug}`),
    ...ogFor({
      locale,
      path: `/touren/${slug}`,
      title: tour.title,
      description: tour.subtitle,
      image: tour.coverUrl,
    }),
  };
}

export default async function TourPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  // TESTHAKEN (lib/test-sbike-tour.ts): eigene, erfundene S-Bike-Runde ohne DB-Zeile.
  const tour =
    slug === TEST_SBIKE_SLUG
      ? await getTestSBikeTour(locale)
      : await getTourDetail(slug, locale); // Audio ist bereits serverseitig gegated
  if (!tour) notFound();
  return <TourView tour={tour} />;
}
