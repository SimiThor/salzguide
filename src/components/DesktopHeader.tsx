"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import SocialLinks from "./SocialLinks";
import AiSparkle from "./ai/AiSparkle";
import { useAi } from "./ai/AiProvider";
import { BookmarkFilled } from "./icons";
import { NAV_ITEMS } from "@/lib/nav";
import { LEGAL_LINKS } from "@/lib/legal-links";

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Desktop-Top-Header (>= md): Logo links, Navigation ZENTRIERT, Aktionen (KI + Sprache)
// rechts. Ersetzt die Bottom-Nav am PC.
//
// Menüpunkte kommen aus der gemeinsamen Quelle (lib/nav.ts) - dieselben wie im iPhone-
// Burger. Am PC sind nur die primary-Punkte sofort sichtbar; der Rest (Audio-Touren,
// Wassertemperaturen) sitzt aufgeräumt in einem „Mehr"-Dropdown im Apple-Stil.
export default function DesktopHeader() {
  const t = useTranslations();
  const tLegal = useTranslations("Legal");
  const tSupport = useTranslations("Support");
  const pathname = usePathname();
  const ai = useAi();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Klick ausserhalb + Escape schliessen das „Mehr"-Dropdown (wie im LanguageSwitcher).
  useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const primary = NAV_ITEMS.filter((i) => i.primary);
  const secondary = NAV_ITEMS.filter((i) => !i.primary);
  // Steht der Nutzer auf einer Seite aus dem „Mehr"-Menü, wird „Mehr" selbst rot markiert,
  // damit sichtbar bleibt, wo man gerade ist. „Über uns" liegt auch dort drin.
  const moreActive =
    secondary.some((i) => i.href === pathname) || pathname === "/ueber-uns";

  const linkCls = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
      active ? "text-accent" : "text-muted hover:text-ink"
    }`;

  return (
    <header className="fixed inset-x-0 top-0 z-50 hidden h-[var(--sg-header-h)] grid-cols-[1fr_auto_1fr] items-center border-b border-black/5 bg-cream/80 px-6 backdrop-blur-xl md:grid">
      {/* Logo -> /explore, NICHT „/": „/" ist seit 07/2026 die Verkaufs-Startseite. Wer schon
          in der App ist, will beim Tippen aufs Logo zur Karte, nicht zurück in den Pitch.
          Muss mit MobileHeader identisch bleiben. */}
      <Link
        href="/explore"
        className="justify-self-start text-[26px] font-bold tracking-tight text-accent"
      >
        SalzGuide
      </Link>

      {/* ZENTRIERTE Navigation (mittlere Grid-Spalte, zwischen zwei gleich breiten 1fr). */}
      <nav className="flex items-center gap-1">
        {primary.map((item) => {
          const active = item.href === pathname;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={linkCls(active)}
            >
              {t(`Nav.${item.key}`)}
            </Link>
          );
        })}

        {/* „Mehr"-Dropdown: die sekundären Seiten, aufgeräumt hinter einem Klick. */}
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className={`inline-flex items-center gap-1 ${linkCls(moreActive)}`}
          >
            {t("Menu.more")}
            <ChevronDown open={moreOpen} />
          </button>

          <AnimatePresence>
            {moreOpen && (
              <motion.div
                role="menu"
                className="absolute left-1/2 top-full z-[90] mt-2 w-60 -translate-x-1/2 overflow-hidden rounded-[18px] border border-black/[0.06] bg-white p-1.5 shadow-xl"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.14 }}
              >
                {secondary.map((item) => {
                  const active = item.href === pathname;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                        active ? "bg-accent/10 text-accent" : "text-ink hover:bg-black/5"
                      }`}
                    >
                      {/* Ohne Emoji zeichnet der Punkt sein echtes Symbol (heute nur
                          "Gespeichert" = Lesezeichen). Feste Breite, damit die Namen
                          daneben in einer Flucht stehen, egal ob Emoji oder Zeichnung. */}
                      <span
                        className="grid w-[18px] shrink-0 place-items-center text-[18px] leading-none"
                        aria-hidden
                      >
                        {item.emoji ?? <BookmarkFilled className="h-[17px] w-[17px]" />}
                      </span>
                      <span className="flex-1 text-[15px] font-medium">
                        {t(`Nav.${item.key}`)}
                      </span>
                    </Link>
                  );
                })}

                {/* Über uns: eigene Seite, als gleichwertiger Eintrag OHNE Trennstrich
                    (einheitliche Liste, Apple-Stil). */}
                <Link
                  href="/ueber-uns"
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  aria-current={pathname === "/ueber-uns" ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                    pathname === "/ueber-uns"
                      ? "bg-accent/10 text-accent"
                      : "text-ink hover:bg-black/5"
                  }`}
                >
                  <span className="text-[18px] leading-none" aria-hidden>
                    👋
                  </span>
                  <span className="flex-1 text-[15px] font-medium">{t("Menu.about")}</span>
                </Link>

                {/* Rechtliches, hinter einer Haarlinie und kleiner: dieselbe Liste wie in der
                    Fußzeile und im iPhone-Burger (lib/legal-links.ts).
                    WARUM hier oben, wo es die Fußzeile doch gibt: Die blendet sich auf den
                    Vollbild-Karten (/explore, /wasser) aus — die Karte liegt darüber. Am PC
                    gab es dort dann gar keinen Weg zum Impressum außer den Umweg über eine
                    andere Seite. § 5 ECG will es „unmittelbar und leicht" erreichbar.
                    Gestapelte Zeilen wie am Handy würden das Menü doppelt so hoch machen; am
                    PC trifft die Maus aufs Pixel, deshalb die kompakte Zeile mit Trennpunkten
                    (Aussehen der Fußzeile). Trefferflächen für den Finger braucht es hier
                    nicht — siehe .sg-hit in globals.css. */}
                {/* Die Profile, aus derselben Quelle wie Fusszeile und iPhone-Burger
                    (lib/social.ts). Sie stehen hier aus demselben Grund wie die Rechtslinks
                    darunter: Auf den Vollbild-Karten gibt es keine Fusszeile.
                    dense: kleinere Fläche als am Handy, weil die Maus aufs Pixel trifft.
                    -mx-1: hebt das Innenpolster der runden Flächen auf, damit das erste
                    Glyph mit den Namen darüber in einer Flucht steht. */}
                <div className="mt-1 flex items-center border-t border-black/[0.06] px-3 pb-0.5 pt-2">
                  <SocialLinks className="-mx-1 gap-0.5" iconClassName="h-[19px] w-[19px]" dense />
                </div>

                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-1 pt-1.5 text-[12px]">
                  {LEGAL_LINKS.map((l, i) => (
                    <span key={l.key} className="flex items-center gap-1.5">
                      <Link
                        href={l.href}
                        role="menuitem"
                        onClick={() => setMoreOpen(false)}
                        className="text-muted transition-colors hover:text-ink"
                      >
                        {l.ns === "Support" ? tSupport(l.key) : tLegal(l.key)}
                      </Link>
                      {i < LEGAL_LINKS.length - 1 && (
                        <span className="text-muted/40" aria-hidden>
                          ·
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Rechts abgesetzt: KI + Sprache. IDENTISCHE Pille wie der Sprachwähler: gleiches
          bg-black/5, px-3 py-1.5, text-sm font-medium, text-ink, leading-none, rounded-full
          -> gleiche Höhe, gleicher Stil. KI ist NICHT rot (Rot heisst in der App „aktive
          Seite", ein roter Knopf sähe ausgewählt aus); als KI-Aktion erkennt man ihn am
          Sparkle. */}
      <div className="flex items-center gap-2 justify-self-end">
        <button
          type="button"
          onClick={ai.open}
          className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-black/10 active:scale-[0.98]"
        >
          <AiSparkle gradient className="h-[15px] w-[15px]" />
          <span className="leading-none">{t("Nav.ai")}</span>
        </button>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
