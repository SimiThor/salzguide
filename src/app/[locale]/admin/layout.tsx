import { redirect } from "next/navigation";
import { getAdminUserId } from "@/lib/admin-guard";
import { getOpenSupportCount } from "@/lib/admin";
import { countPendingEventDrafts } from "@/lib/event-review";
import AdminNav from "@/components/admin/AdminNav";
import MailChannelBanner from "@/components/admin/MailChannelBanner";

// Der Admin-Rahmen: Wächter + Navigation.
//
// WARUM DIE NAVIGATION HIER STEHT UND NICHT IN JEDER SEITE:
// Sie stand vorher zehnmal einzeln, jede Seite mit einem handgepflegten `active`. Für den
// Support-Zähler hätten alle zehn ihn holen und durchreichen müssen — dieselbe Kopiererei,
// die beim Admin-Wächter gerade erst beseitigt wurde. Hier ist es EINE Abfrage, und der
// Zähler kann nicht auf einer Seite fehlen, weil jemand sie vergessen hat.
//
// Nicht gecacht (siehe unten): Ein Zähler, der eine alte Zahl zeigt, ist schlimmer als
// keiner — man verlässt sich darauf und übersieht dann jemanden, der wartet.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const adminId = await getAdminUserId();
  if (!adminId) redirect(`/${locale}/profil`);

  // Erst NACH dem Wächter: Wer nicht rein darf, soll auch nichts auslösen.
  // Nebeneinander statt nacheinander: Es sind zwei kleine Abfragen, die nichts voneinander
  // wissen, und sie stehen vor JEDER Admin-Seite.
  const [supportCount, pendingEvents] = await Promise.all([
    getOpenSupportCount(),
    countPendingEventDrafts(),
  ]);

  return (
    // pb mit --sg-nav-h: Im Admin rendert die Rechts-Fusszeile bewusst nicht (kein
    // Kunden-Kontext), die bringt sonst überall den Platz über der Tab-Leiste mit. Ohne
    // dieses Padding lag die fixe Leiste am Handy über dem Seitenende — der letzte Knopf
    // jeder Admin-Seite war abgeschnitten. Hier EINMAL statt in zwanzig Seiten, aus
    // demselben Grund, aus dem die Navigation oben steht (siehe Kommentar am Layout).
    // Der sichtbare Abschluss-Weissraum kommt aus --sg-page-bottom (globals.css), wie
    // auf jeder anderen Seite — vorher stand hier ein eigenes md:pb-16 neben dem
    // md:pb-12 des Footers, zwei Zahlen für denselben Abstand.
    //
    // break-words: Der Admin zeigt fremden Text, den niemand vorher kürzt: Fehlermeldungen,
    // Links, Mail-Adressen, IDs. Ein einziges Wort ohne Leerzeichen
    // („document.querySelector(…).content") im Logbuch machte die ganze Seite 444 statt
    // 393 px breit, und sie liess sich seitlich schieben (16.11.2026). So bricht so ein
    // Wort am Rand um. Es wirkt nur, wo sonst überstehen würde; normaler Text bleibt gleich.
    //
    // overflow-x-clip: die EINE Sicherung für alle Admin-Seiten. Was trotzdem breiter wird
    // als der Rahmen (eine neue Tabelle, ein langer Wert), wird am Rahmen abgeschnitten,
    // statt die ganze Seite seitlich schiebbar zu machen. `clip`, nicht `hidden`: hidden
    // macht den Rahmen zum Scroll-Behälter, dann klebt nichts Sticky mehr. Die
    // Reiter-Leisten (ScrollStrip, -mx-4) ragen bewusst in das px-4 hinein; das liegt noch
    // innerhalb des Rahmens und bleibt sichtbar.
    // Die Sicherung ersetzt nicht das saubere Layout: Wer eine Seite baut, prüft trotzdem
    // bei 320 px, dass nichts abgeschnitten wird.
    //
    // ACHTUNG Klassenliste: Ein fehlendes Leerzeichen („px-4pb-…") ist für Tailwind eine
    // unbekannte Klasse und fällt still weg. Genau so fehlte am 16.11.2026 der Seitenrand,
    // und jede Admin-Seite liess sich 16 px seitlich schieben.
    <div className="mx-auto w-full max-w-[820px] overflow-x-clip break-words px-4 pb-[calc(var(--sg-nav-h)+var(--sg-page-bottom))] pt-[var(--sg-page-top)] md:pb-[var(--sg-page-bottom)] md:pt-6">
      <div className="mb-4">
        <AdminNav
          badges={{ "/admin/users": supportCount, "/admin/events": pendingEvents }}
        />
      </div>
      {/* Steht ÜBER dem Seiteninhalt und auf jeder Seite, nicht nur im Logbuch: Es ist die
          einzige Meldung, die uns nicht per Mail erreichen kann (siehe die Komponente). */}
      <div className="mb-4 empty:mb-0">
        <MailChannelBanner />
      </div>
      {children}
    </div>
  );
}
