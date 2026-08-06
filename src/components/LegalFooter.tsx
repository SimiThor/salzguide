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
    // pt-24/28: bewusst grosszügiger Abstand zum Seiteninhalt. Der Footer ist Fussnote,
    // nicht Teil des Contents, und darf auf keiner Seite direkt am letzten Absatz kleben.
    // EINE Stelle für alle Seiten: der Footer bringt seinen Abstand selbst mit, statt dass
    // jede Seite unten Platz reserviert (das würde beim nächsten neuen Screen vergessen).
    // pb rechnet mit --sg-nav-h (Tab-Leiste inkl. Home-Indicator) + 1rem sichtbarer Luft:
    // Vorher stand hier ein hartes 5.5rem, das die 72px-Leiste nur zufällig überdeckte —
    // wächst die Leiste, wäre jede Seite still angeschnitten gewesen. Auf Marketing-Seiten
    // (keine Tab-Leiste) ergibt dasselbe calc() einfach grosszügigen Abschluss-Weissraum.
    // md:pb aus --sg-page-bottom: der Footer setzt damit das Seitenende, das die
    // Desktop-Karten-Panels und das Admin-Layout aus derselben Variable nachbilden.
    <footer className="mx-auto w-full max-w-[640px] px-4 pb-[calc(var(--sg-nav-h)+1rem)] pt-24 text-center md:pb-[var(--sg-page-bottom)] md:pt-28">
      {/* Die Profile stehen ÜBER den Rechtslinks und ohne Beschriftung. Beides ist eine
          Entscheidung: Folgen ist das, was wir hier wollen, die Rechtslinks sind Pflicht und
          dürfen leiser sein. Ein „Folge uns" davor wäre ein Wort, das zwei Glyphen schon
          sagen. Quelle der Profile: lib/social.ts. */}
      <SocialLinks className="justify-center gap-1" />

      {/* KI-Motto: ein Satz, ganz verlinkt auf /ki. Die warme Kurzfassung der
          KI-Transparenz (Art. 50 KI-VO); die Seite dahinter erklärt ehrlich, wo KI
          mithilft. Steht ÜBER den Pflicht-Links: Markenzeile, nicht Rechtstext. */}
      <Link
        href="/ki"
        className="mt-4 inline-block text-[12px] leading-snug text-muted/80 transition-colors hover:text-ink"
      >
        {t("aiMotto")}
      </Link>

      <nav className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px]">
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

      {/* Hier stand mal „© {Jahr} SalzGuide · Dein digitaler Guide fürs Salzburger Land."
          Raus (07/2026): Direkt darunter steht schon der ©-Satz der Partner-Nennung, und
          zwei ©-Zeilen übereinander verwirren mehr, als sie schützen. Rechtlich braucht es
          den Vermerk nicht (Urheberrecht gilt auch ohne), das Impressum steht in den Links. */}

      {/* Partner-Nennung: Pflicht aus der Inhalte-Vereinbarung (lib/partners.ts). Auf den
          Vollbild-Karten, wo diese Fusszeile nicht rendert, tragen die Panels sie selbst. */}
      <PartnerCredits className="mt-10" />
    </footer>
  );
}
