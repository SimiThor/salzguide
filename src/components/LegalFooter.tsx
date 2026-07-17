"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

// Globaler Site-Footer (im Root-Layout, auf JEDER Seite). Enthält den Widerrufs-Zugang
// (§ 13a FAGG / EU-RL 2023/2673, ab 01.10.2026 in Österreich): login-frei, global, leicht
// zugänglich. Darstellung bewusst gleicher Stil wie die übrigen Rechtslinks (Entscheidung
// des Betreibers). Reihenfolge: Widerruf zuerst.
// „Hilfe" steht bewusst VORNE, vor den Rechtslinks: Wer hier unten landet, sucht meist
// jemanden zum Reden, nicht das Impressum. Der Text kommt aus dem Support-Namensraum, die
// übrigen aus Legal — deshalb steht die Sprache je Eintrag dabei.
const LINKS = [
  { href: "/support", key: "linkLabel", ns: "Support" },
  { href: "/rechtliches/widerruf", key: "cancelContract", ns: "Legal" },
  { href: "/rechtliches/datenschutz", key: "privacy", ns: "Legal" },
  { href: "/rechtliches/impressum", key: "imprint", ns: "Legal" },
  { href: "/rechtliches/agb", key: "terms", ns: "Legal" },
] as const;

// Vollflächige Karten-Ansichten: die Karte liegt als `fixed inset-0 z-0` über dem
// Dokumentfluss, ein Footer darunter wäre nach den CSS-Malregeln unsichtbar (positioniert
// schlägt statisch) — also gar nicht erst rendern. Die Rechtslinks sind dort über die
// Navigation -> Profil erreichbar.
// Bis 07/2026 stand hier nur „/", weil die Karte die Startseite war. /wasser hat dieselbe
// Vollbild-Karte und fehlte -> der Footer war dort schon immer hinter der Karte begraben.
const FULLSCREEN_MAP_ROUTES: readonly string[] = ["/explore", "/wasser"];

export default function LegalFooter() {
  const t = useTranslations("Legal");
  const tSupport = useTranslations("Support");
  const pathname = usePathname();
  const year = new Date().getFullYear();

  // Nicht auf Vollbild-Karten und nicht im internen Admin-Bereich (kein Kunden-Kontext).
  // Überall sonst global + login-frei — inkl. der neuen Startseite „/", die den
  // Widerruf-Zugang als meistbesuchte Seite gerade braucht.
  if (FULLSCREEN_MAP_ROUTES.includes(pathname) || pathname.startsWith("/admin")) {
    return null;
  }

  return (
    <footer className="mx-auto w-full max-w-[640px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-16 text-center md:pb-12 md:pt-20">
      <nav className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px]">
        {LINKS.map((l, i) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <Link href={l.href} className="text-muted transition-colors hover:text-ink">
              {l.ns === "Support" ? tSupport(l.key) : t(l.key)}
            </Link>
            {i < LINKS.length - 1 && (
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
    </footer>
  );
}
