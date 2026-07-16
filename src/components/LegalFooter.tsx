"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

// Globaler Site-Footer (im Root-Layout, auf JEDER Seite). Enthält den Widerrufs-Zugang
// (§ 13a FAGG / EU-RL 2023/2673, ab 01.10.2026 in Österreich): login-frei, global, leicht
// zugänglich. Darstellung bewusst gleicher Stil wie die übrigen Rechtslinks (Entscheidung
// des Betreibers). Reihenfolge: Widerruf zuerst.
const LINKS = [
  { href: "/rechtliches/widerruf", key: "cancelContract" },
  { href: "/rechtliches/datenschutz", key: "privacy" },
  { href: "/rechtliches/impressum", key: "imprint" },
  { href: "/rechtliches/agb", key: "terms" },
] as const;

export default function LegalFooter() {
  const t = useTranslations("Legal");
  const pathname = usePathname();
  const year = new Date().getFullYear();

  // Nicht auf der vollflächigen Karten-Startseite („/", fixe Karte) und nicht im internen
  // Admin-Bereich (kein Kunden-Kontext). Überall sonst global + login-frei.
  if (pathname === "/" || pathname.startsWith("/admin")) return null;

  return (
    <footer className="mx-auto w-full max-w-[640px] px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-16 text-center md:pb-12 md:pt-20">
      <nav className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px]">
        {LINKS.map((l, i) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <Link href={l.href} className="text-muted transition-colors hover:text-ink">
              {t(l.key)}
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
