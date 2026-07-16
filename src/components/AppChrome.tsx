"use client";

import { usePathname } from "@/i18n/navigation";
import { isMarketingRoute } from "@/lib/routes";
import BottomNav from "@/components/BottomNav";
import DesktopHeader from "@/components/DesktopHeader";
import MobileHeader from "@/components/MobileHeader";
import LegalFooter from "@/components/LegalFooter";
import Analytics from "@/components/Analytics";

// App-Chrome (Header, Tab-Leiste, Footer, Analytics) an EINER Stelle. Ob eine Route
// App-Navigation trägt oder Marketing ist, entscheidet lib/routes.ts.
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingRoute(pathname);

  return (
    <>
      {!marketing && (
        <>
          <MobileHeader />
          <DesktopHeader />
        </>
      )}
      {/* Mobile: Platz unten für BottomNav (die Seiten regeln das selbst). Desktop: Platz
          oben für den fixen Header — auf Marketing-Seiten gibt es den nicht, sonst sässe
          ein vollflächiger Hero still 72px zu tief. */}
      <main className={`flex flex-1 flex-col ${marketing ? "" : "md:pt-[var(--sg-header-h)]"}`}>
        {children}
        {/* Globaler Footer inkl. gesetzlichem Widerruf-Zugang (§ 13a FAGG) auf jeder
            Seite; blendet sich auf den vollflächigen Karten-Ansichten selbst aus. */}
        <LegalFooter />
      </main>
      {!marketing && <BottomNav />}
      <Analytics />
    </>
  );
}
