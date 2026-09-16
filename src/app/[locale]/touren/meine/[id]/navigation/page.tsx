import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getUserTourDetail } from "@/lib/user-tours";
import BikeNavScreen from "@/components/tours/nav/BikeNavScreen";
import { getProPrice, formatProPrice } from "@/lib/pro";

// Navigation einer gespeicherten eigenen Runde (KI-Builder, immer zu Fuss). Derselbe
// Bildschirm wie bei den kuratierten Runden; nur die Quelle der Daten und der Rueckweg
// sind andere. RLS laesst nur den Eigentuemer laden, deshalb nicht indexierbar, wie die
// Uebersicht daneben.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MyTourNavigationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const tour = await getUserTourDetail(id, locale);
  if (!tour) notFound();
  const proPrice = formatProPrice(await getProPrice(), locale);
  return <BikeNavScreen tour={tour} proPrice={proPrice} backHref={`/touren/meine/${id}`} />;
}
