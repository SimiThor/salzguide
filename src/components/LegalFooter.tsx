"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { isFullscreenMapRoute } from "@/lib/routes";
import SocialLinks from "./SocialLinks";
import PartnerCredits from "./PartnerCredits";

// Globaler Site-Footer (im Root-Layout, auf JEDER Seite). Enthält den Widerrufs-Zugang
// (§ 13a FAGG / EU-RL 2023/2673, ab 01.10.2026 in Österreich): login-frei, global, leicht
// zugänglich. Darstellung bewusst gleicher Stil wie die übrigen Rechtslinks (Entscheidung
// des Betreibers).
// Welche Links das sind und in welcher Reihenfolge, steht in lib/legal-links.ts — dieselbe
// Liste tragen der iPhone-Burger und das PC-„Mehr"-Menü.

export default function LegalFooter() {
  const t = useTranslations("Legal");
  const tSupport = useTranslations("Support");
  const pathname = usePathname();
  const year = new Date().getFullYear();

  // Nicht auf Vollbild-Karten (die Regel steht in lib/routes.ts, samt Begründung, warum sie
  // dort und nicht hier steht) und nicht im internen Admin-Bereich (kein Kunden-Kontext).
  // Überall sonst global + login-frei — inkl. der neuen Startseite „/", die den
  // Widerruf-Zugang als meistbesuchte Seite gerade braucht.
  // Auf den Vollbild-Karten führen stattdessen der iPhone-Burger und das PC-„Mehr"-Menü zu
  // denselben Links (dieselbe Quelle: lib/legal-links.ts) — dort wäre die Fußzeile hinter
  // der Karte unsichtbar, und ein unsichtbarer Rechtslink ist kein Rechtslink.
  if (isFullscreenMapRoute(pathname) || pathname.startsWith("/admin")) {
    return null;
  }

  return (
    <footer className="mx-auto w-full max-w-[640px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-16 text-center md:pb-12 md:pt-20">
      {/* Die Profile stehen ÜBER den Rechtslinks und ohne Beschriftung. Beides ist eine
          Entscheidung: Folgen ist das, was wir hier wollen, die Rechtslinks sind Pflicht und
          dürfen leiser sein. Ein „Folge uns" davor wäre ein Wort, das zwei Glyphen schon
          sagen. Quelle der Profile: lib/social.ts. */}
      <SocialLinks className="justify-center gap-1" />

      <nav className="mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px]">
        {LEGAL_LINKS.map((l, i) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <Link href={l.href} className="text-muted transition-colors hover:text-ink">
              {l.ns === "Support" ? tSupport(l.key) : t(l.key)}
            </Link>
            {i < LEGAL_LINKS.length - 1 && (
              <span className="text-muted/40" aria-hidden>
                ·
              </span>
            )}
          </span>
        ))}
      </nav>

      <p className="mt-3 text-[12px] leading-relaxed text-muted/80">
        © {year} SalzGuide · {t("tagline")}
      </p>

      {/* Partner-Nennung: Pflicht aus der Inhalte-Vereinbarung (lib/partners.ts). Auf den
          Vollbild-Karten, wo diese Fusszeile nicht rendert, tragen die Panels sie selbst. */}
      <PartnerCredits className="mt-10" />
    </footer>
  );
}
