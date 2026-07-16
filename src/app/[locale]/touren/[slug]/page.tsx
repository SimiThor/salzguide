import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getTourDetail } from "@/lib/tours";
import TourView from "@/components/tours/TourView";

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
    alternates: {
      canonical: `/${locale}/touren/${slug}`,
      languages: { de: `/de/touren/${slug}`, en: `/en/touren/${slug}` },
    },
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
  return <TourView tour={tour} />;
}
