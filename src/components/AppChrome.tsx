"use client";

import { usePathname } from "@/i18n/navigation";
import { isMarketingRoute, isImmersiveRoute } from "@/lib/routes";
import BottomNav from "@/components/BottomNav";
import DesktopHeader from "@/components/DesktopHeader";
import MobileHeader from "@/components/MobileHeader";
import LegalFooter from "@/components/LegalFooter";
import ProNotice from "@/components/ProNotice";
import Analytics from "@/components/Analytics";
import ClientErrorWatch from "@/components/ClientErrorWatch";
import { useTouchActiveState } from "@/components/useTouchActiveState";

// App-Chrome (Header, Tab-Leiste, Footer, Analytics) an EINER Stelle. Ob eine Route
// App-Navigation trägt oder Marketing ist, entscheidet lib/routes.ts.
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingRoute(pathname);
  // Vollständig eigene Bildschirme (z.B. die S-Bike-Navigation, lib/routes.ts): auch
  // Header, Tab-Leiste und Toni-Blase weg, nicht nur die Fussleiste wie sonst auf den
  // Vollbild-Karten. Siehe die Begründung bei isImmersiveRoute.
  const immersive = isImmersiveRoute(pathname);
  const chromeless = marketing || immersive;
  // Hier, weil AppChrome auf JEDER Seite liegt (auch auf den Marketing-Seiten) und weil
  // das Tap-Feedback nichts ist, um das sich 70 einzelne Komponenten kümmern sollten.
  useTouchActiveState();

  return (
    <>
      {!chromeless && (
        <>
          <MobileHeader />
          <DesktopHeader />
        </>
      )}
      {/* Mobile: Platz unten für BottomNav (die Seiten regeln das selbst). Desktop: Platz
          oben für den fixen Header — auf Marketing- und immersiven Seiten gibt es den
          nicht, sonst sässe ein vollflächiger Hero/eine Vollbild-Navigation still 72px
          zu tief. */}
      <main className={`flex flex-1 flex-col ${chromeless ? "" : "md:pt-[var(--sg-header-h)]"}`}>
        {children}
        {/* Globaler Footer inkl. gesetzlichem Widerruf-Zugang (§ 13a FAGG) auf jeder
            Seite; blendet sich auf den vollflächigen Karten-Ansichten selbst aus. */}
        <LegalFooter />
      </main>
      {!chromeless && <BottomNav />}
      {/* Einmaliger "dein Pro ist da"-Gruss. Nicht auf den Marketing-Seiten: dort ist der
          Mensch noch im Verkaufsgespräch, und das Kärtchen bräuchte die Tab-Leiste, an der
          es hängt. In der App sieht er ihn beim nächsten Schritt. */}
      {!chromeless && <ProNotice />}
      <Analytics />
      {/* Fehler-Mitschnitt. Bewusst OHNE `!marketing`: Ein Fehler auf der Startseite ist der
          teuerste von allen, dort kommen die Besucher zuerst an. */}
      <ClientErrorWatch />
    </>
  );
}
