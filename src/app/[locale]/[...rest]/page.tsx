import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

// Catch-all für unbekannte Pfade unter einer gültigen Sprache (next-intl-Muster):
// Ohne ihn liefe /de/gibtsnicht an der lokalisierten not-found.tsx vorbei in Nexts
// nackte englische Standard-404. Echte Routen gewinnen immer, weil Next spezifischere
// Segmente vor dem Catch-all auflöst. setRequestLocale VOR notFound(), damit die
// 404-Seite in der richtigen Sprache übersetzt.
//
// ACHTUNG STATUS: Diese Route liefert 200, nicht 404 – und das ist in Next nicht zu
// ändern. Durch das loading.tsx auf [locale] streamt Next die Antwort, die Statuszeile
// ist verschickt, bevor irgendein notFound() läuft; auch notFound() in generateMetadata
// (streamt seit 15.2 mit, vercel/next.js#77235 "closed as not planned") und beim Build
// vorgerenderte notFound-Pfade (werden als 200 gespeichert, sobald eine not-found.tsx-
// Grenze sie fängt) retten den Status nicht. Next schiebt als Ausgleich selbst ein
// <meta name="robots" content="noindex"> in gestreamte 404s.
//
// Die ECHTE 404 liefert deshalb der Proxy: unbekannte Pfade gehen per Rewrite an den
// Route Handler src/app/404/route.ts (nur Route Handler dürfen den Status setzen),
// entschieden über die Erlaubnis-Liste in src/lib/public-routes.ts. Hier landet nur
// noch, was der Proxy durchlässt: der Sicherheitsnetz-Fall einer Route, die in der
// Erlaubnis-Liste vergessen wurde – lieber hübsch mit 200+noindex als hart 404 für
// eine echte Seite.
export default async function CatchAllPage({
  params,
}: {
  params: Promise<{ locale: string; rest: string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  notFound();
}
