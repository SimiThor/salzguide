import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTourDetail } from "@/lib/tours";
import { alternatesFor, ogFor } from "@/lib/metadata";
import TourView from "@/components/tours/TourView";
import { getProPrice, formatProPrice } from "@/lib/pro";

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
  const tour = await getTourDetail(slug, locale); // Audio ist bereits serverseitig gegated
  if (!tour) notFound();
  // Preis serverseitig aus Stripe (eine Quelle, gecacht). Damit steht der Kauf auf dieser
  // Seite statt hinter einem Sprung auf /pro: Wer hier liest, hat die Runde schon gewählt.
  const proPrice = formatProPrice(await getProPrice(), locale);
  return <TourView tour={tour} proPrice={proPrice} />;
}
