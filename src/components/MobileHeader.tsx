"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import LanguageSwitcher from "./LanguageSwitcher";
import SocialLinks from "./SocialLinks";
import { NAV_ITEMS } from "@/lib/nav";
import { LEGAL_LINKS } from "@/lib/legal-links";

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
  const tLegal = useTranslations("Legal");
  const tSupport = useTranslations("Support");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Scroll-Riegel + Escape, während das Menü offen ist — dieselbe Kombination wie im
  // BottomSheet, damit sich jede Überlagerung der App gleich verhält.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Beim Seitenwechsel zu. Die Links im Menü schließen es selbst (onClick), aber nicht jeder
  // Wechsel kommt von einem Link: Zurück-Wischen und Zurück-Taste tun es nicht. Ohne das
  // stand das Menü nach dem Zurückgehen wieder offen über der neuen Seite.
  //
  // Der Vergleich steht im RENDER und nicht in einem Effekt — „State an eine geänderte
  // Eingabe anpassen" ist genau der Fall, für den React das empfiehlt (dieselbe Form wie im
  // BottomSheet). Aus einem Effekt heraus wäre es eine zweite Render-Runde, und in der
  // ersten stünde das Menü noch einen Frame lang offen über der neuen Seite.
  //
  // Ein Sprachwechsel fällt hier bewusst NICHT drunter: `usePathname()` aus
  // @/i18n/navigation liefert den Pfad ohne Sprach-Präfix, /de/explore und /en/explore sind
  // beide „/explore". Das Menü bleibt dabei also offen — genau richtig, man sieht die neue
  // Sprache sofort an den Menüpunkten.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  // Fokus hinein und wieder zurück. Gehört zu role="dialog" aria-modal dazu: Ohne das steht
  // der Tastatur-/VoiceOver-Fokus beim Öffnen weiter auf der Seite HINTER dem Menü, und beim
  // Schließen verliert er sich ins Nichts, weil das Element unter ihm verschwindet.
  // wasOpen als Ref, nicht als State: Ohne die Merkhilfe würde der Effekt beim ersten
  // Aufbau der Seite (open = false) sofort den Burger fokussieren und ihn ungefragt
  // hervorheben, obwohl niemand ihn angefasst hat.
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      burgerRef.current?.focus();
    }
  }, [open]);

  // Detail-/Vollbild-Ansichten haben ihren eigenen Zurück-Button (Spot, Audio-Tour-
  // Unterseiten wie /touren/[slug], /touren/meine/…, /touren/bauen).
  if (pathname.startsWith("/spot/") || pathname.startsWith("/touren/")) return null;

  const close = () => setOpen(false);

  // Alle Seiten untereinander, aus der gemeinsamen Quelle (lib/nav.ts) -> exakt dieselben
  // Punkte UND dieselbe Reihenfolge wie am PC (erst die Leisten-Punkte, dann die aus dem
  // "Mehr"-Menü; die Begründung steht an der Liste selbst). KI ist hier bewusst NICHT
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
          ref={burgerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("Menu.open")}
          aria-expanded={open}
          className="cursor-pointer sg-hit flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-black/5"
        >
          <Burger />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <>
            {/* min-h-[100lvh] NICHT entfernen: Ein fixes Element MIT backdrop-filter spannt
                sich in Chromium über inset-0 nicht zuverlässig auf die volle Viewport-Höhe
                auf — unten blieb ein scharfer Streifen stehen. Dieselbe Zeile steht aus
                demselben Grund am BottomSheet-Backdrop; hier fehlte sie. */}
            <motion.div
              className="fixed inset-0 z-[60] min-h-[100lvh] cursor-pointer bg-black/30 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t("Menu.open")}
              className="fixed inset-y-0 right-0 z-[70] flex w-[82%] max-w-[340px] flex-col bg-cream pt-safe shadow-2xl md:hidden"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
            >
              <div className="flex h-14 shrink-0 items-center justify-between px-5">
                <span className="text-xl font-bold text-accent">SalzGuide</span>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={close}
                  aria-label={t("Explore.close")}
                  className="cursor-pointer flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-ink"
                >
                  <X />
                </button>
              </div>

              {/* Ein Scroll-Bereich für alles unter der Kopfzeile — min-h-0, sonst wächst ein
                  Flex-Kind über seinen Container hinaus statt zu scrollen.
                  Er ist Pflicht, nicht Vorsicht: Bei sieben Menüpunkten plus fünf Rechtslinks
                  reicht die Höhe eines quer gehaltenen iPhones nicht. Ohne ihn stünde das
                  Untere davon außerhalb der (fixen) Schublade — sichtbar nicht erreichbar,
                  genau der Fehler, den wir hier gerade beheben.
                  overscroll-contain hält die iOS-Gummiband-Geste in der Schublade, statt sie
                  an die Seite dahinter weiterzugeben. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
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

                {/* Rechtliches: ECHTE Links, aus derselben Liste wie die Fußzeile
                    (lib/legal-links.ts). Hier stand bis 07/2026 der fertige Satz
                    „Impressum · Datenschutz · AGB" als ein Stück Text — er sah wie drei
                    Links aus und war keiner. Auf der Vollbild-Karte, wo sich die Fußzeile
                    selbst ausblendet, kam man am Handy damit gar nicht ans Impressum.

                    mt-auto: unten angeheftet, solange Platz ist; wird es eng, scrollt der
                    Block einfach mit (margin:auto wird zu 0, sobald kein freier Raum bleibt).

                    Darstellung als FUSSNOTE, nicht als Menüpunkte: dieselbe fließende
                    Zeile mit Trennpunkten wie in LegalFooter und im PC-„Mehr"-Menü —
                    Pflichtlinks, keine Navigation, also leiser als die Seiten darüber.
                    Bei fünf Links bricht die Zeile in der Schublade auf etwa zwei Reihen
                    um (flex-wrap regelt das je Sprache selbst).

                    KEIN sg-hit mehr: dessen unsichtbare 44px-Fläche würde in einer eng
                    umbrechenden Zeile die Nachbarlinks überdecken und ihnen Tipps
                    wegnehmen (genau die Warnung an .sg-hit in globals.css). Stattdessen
                    py-1.5 als echtes Polster; die Fußzeile zeigt dieselben Links in
                    derselben Größe. */}
                <div className="mt-auto flex flex-col px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-6">
                  {/* Die Profile trennen die App-Seiten oben von der zweiten Reihe unten.
                      Sie stehen bewusst HIER und nicht nur in der Fusszeile: Auf den
                      Vollbild-Karten (/explore, /wasser) blendet sich die Fusszeile aus, und
                      genau dort verbringen die meisten ihre Zeit. Dieselbe Begründung wie
                      bei den Rechtslinks darunter, dieselbe Quelle-in-einer-Datei-Logik.
                      Das Menü bleibt beim Antippen offen, weil das Profil in einem neuen
                      Tab aufgeht: Wer zurückkommt, steht wieder da, wo er war. */}
                  <SocialLinks className="gap-1 pb-3" />

                  <div className="flex flex-wrap items-center gap-x-1.5 px-3 text-[13px]">
                    {LEGAL_LINKS.map((l, i) => {
                      const active = l.href === pathname;
                      return (
                        <span key={l.key} className="flex items-center gap-x-1.5">
                          <Link
                            href={l.href}
                            onClick={close}
                            aria-current={active ? "page" : undefined}
                            className={`py-1.5 ${active ? "text-accent" : "text-muted"}`}
                          >
                            {l.ns === "Support" ? tSupport(l.key) : tLegal(l.key)}
                          </Link>
                          {i < LEGAL_LINKS.length - 1 && (
                            <span className="text-muted/40" aria-hidden>
                              ·
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
