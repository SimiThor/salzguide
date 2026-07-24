"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import { NAV_ITEMS } from "@/lib/nav";

function Burger() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function X() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Mobiler App-Header (iOS-2026): Logo + Burger. Nur < md.
// Auf Detailseiten ausgeblendet (eigener Hero mit Zurück).
export default function MobileHeader() {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Detail-/Vollbild-Ansichten haben ihren eigenen Zurück-Button (Spot, Audio-Tour-
  // Unterseiten wie /touren/[slug], /touren/meine/…, /touren/bauen).
  if (pathname.startsWith("/spot/") || pathname.startsWith("/touren/")) return null;

  const close = () => setOpen(false);

  // Aktuell verfügbar (alle untereinander) vs. bald. Die Seiten kommen aus der gemeinsamen
  // Quelle (lib/nav.ts) -> exakt dieselben Punkte wie am PC. KI ist hier bewusst NICHT
  // dabei: die sitzt in der unteren Leiste, im Burger wäre sie doppelt.
  const ready = NAV_ITEMS;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-black/5 bg-cream/80 px-4 pt-safe backdrop-blur-xl md:hidden">
        {/* Logo -> /explore (identisch zu DesktopHeader, siehe Kommentar dort). */}
        <Link href="/explore" className="flex h-[var(--sg-header-h)] items-center text-[22px] font-bold tracking-tight text-accent">
          SalzGuide
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("Menu.open")}
          className="sg-hit flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-black/5"
        >
          <Burger />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />
            <motion.div
              className="fixed inset-y-0 right-0 z-[70] flex w-[82%] max-w-[340px] flex-col bg-cream pt-safe shadow-2xl md:hidden"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
            >
              <div className="flex h-14 items-center justify-between px-5">
                <span className="text-xl font-bold text-accent">SalzGuide</span>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("Explore.close")}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-ink"
                >
                  <X />
                </button>
              </div>

              <div className="px-5 pb-2 pt-1">
                <LanguageSwitcher />
              </div>

              <nav className="mt-2 flex flex-col px-3">
                {ready.map((i) => {
                  // Aktive Seite rot markieren, exakt wie im DesktopHeader: gleicher
                  // Vergleich (href === pathname, beide ohne Locale-Präfix aus
                  // @/i18n/navigation), gleiche Farbe (text-accent) und gleiches
                  // aria-current. active:bg-black/5 bleibt das Tipp-Feedback und hat mit
                  // der aktiven Seite nichts zu tun.
                  const active = i.href === pathname;
                  return (
                    <Link
                      key={i.key}
                      href={i.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-xl px-3 py-3 text-[17px] font-medium active:bg-black/5 ${
                        active ? "text-accent" : "text-ink"
                      }`}
                    >
                      {t(`Nav.${i.key}`)}
                    </Link>
                  );
                })}
                {/* Über uns: jetzt eine echte Seite (Marketing-Route), aus denselben
                    Startseiten-Texten. Steht bewusst unter den App-Seiten. */}
                <Link
                  href="/ueber-uns"
                  onClick={close}
                  aria-current={pathname === "/ueber-uns" ? "page" : undefined}
                  className={`rounded-xl px-3 py-3 text-[17px] font-medium active:bg-black/5 ${
                    pathname === "/ueber-uns" ? "text-accent" : "text-ink"
                  }`}
                >
                  {t("Menu.about")}
                </Link>
              </nav>

              <div className="mt-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-xs text-muted">
                {t("Menu.legal")}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
