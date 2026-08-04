import { redirect } from "next/navigation";
import { getAdminUserId } from "@/lib/admin-guard";
import { getOpenSupportCount } from "@/lib/admin";
import AdminNav from "@/components/admin/AdminNav";

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
  const supportCount = await getOpenSupportCount();

  return (
    // pb mit --sg-nav-h: Im Admin rendert die Rechts-Fusszeile bewusst nicht (kein
    // Kunden-Kontext), die bringt sonst überall den Platz über der Tab-Leiste mit. Ohne
    // dieses Padding lag die fixe Leiste am Handy über dem Seitenende — der letzte Knopf
    // jeder Admin-Seite war abgeschnitten. Hier EINMAL statt in zwanzig Seiten, aus
    // demselben Grund, aus dem die Navigation oben steht (siehe Kommentar am Layout).
    <div className="mx-auto w-full max-w-[820px] px-4 pb-[calc(var(--sg-nav-h)+3rem)] pt-[var(--sg-page-top)] md:pb-16 md:pt-6">
      <div className="mb-4">
        <AdminNav supportCount={supportCount} />
      </div>
      {children}
    </div>
  );
}
