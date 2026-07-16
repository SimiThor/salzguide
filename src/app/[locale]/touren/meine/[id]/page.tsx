import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getUserTourDetail } from "@/lib/user-tours";
import TourView from "@/components/tours/TourView";

// Gespeicherte User-Runde. RLS stellt sicher, dass nur der Eigentümer sie laden kann;
// nicht öffentlich indexierbar. Audio wird beim Laden frisch gegatet + signiert.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MyTourPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const tour = await getUserTourDetail(id, locale);
  if (!tour) notFound();
  return <TourView tour={tour} />;
}
