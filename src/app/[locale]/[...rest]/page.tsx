import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

// Catch-all für unbekannte Pfade unter einer gültigen Sprache (next-intl-Muster):
// Ohne ihn liefe /de/gibtsnicht an der lokalisierten not-found.tsx vorbei in Nexts
// nackte englische Standard-404. Echte Routen gewinnen immer, weil Next spezifischere
// Segmente vor dem Catch-all auflöst. setRequestLocale VOR notFound(), damit die
// 404-Seite in der richtigen Sprache übersetzt.
export default async function CatchAllPage({
  params,
}: {
  params: Promise<{ locale: string; rest: string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  notFound();
}
