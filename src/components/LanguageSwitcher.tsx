"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";

// Kurzer „Sprache"-Titel je Sprache (kein i18n-Key nötig -> keine Parität-Abhängigkeit).
const TITLE: Record<string, string> = {
  de: "Sprache",
  en: "Language",
  it: "Lingua",
  nl: "Taal",
  ko: "언어",
  fr: "Langue",
  zh: "语言",
  es: "Idioma",
  pt: "Idioma",
};

// Mehrsprachiger Sprachwähler (iOS-2026): Flaggen-Button -> Dropdown (Desktop) bzw. ziehbares
// Bottom-Sheet (Mobile). Alle Sprachen aus der zentralen Config -> neue Sprache erscheint
// automatisch. Wechsel behält den aktuellen Pfad (SEO: eigene Unterseite je Sprache).
export default function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = localeMeta(locale);

  // Klick außerhalb + Escape schließen (Desktop-Dropdown).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(code: string) {
    setOpen(false);
    if (code !== locale) router.replace(pathname, { locale: code });
  }

  const items = routing.locales.map((code) => {
    const m = localeMeta(code);
    const active = code === locale;
    return (
      <button
        key={code}
        type="button"
        onClick={() => choose(code)}
        lang={code}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
          active ? "bg-accent/10 text-accent" : "text-ink hover:bg-black/5"
        }`}
      >
        <span className="text-[20px] leading-none" aria-hidden>
          {m.flag}
        </span>
        <span className="flex-1 text-[15px] font-medium">{m.name}</span>
        {active && (
          <span className="text-[15px]" aria-hidden>
            ✓
          </span>
        )}
      </button>
    );
  });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={TITLE[locale] ?? "Language"}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-sm font-medium text-ink backdrop-blur transition-colors hover:bg-white active:scale-[0.98]"
      >
        <span className="text-[15px] leading-none" aria-hidden>
          {current.flag}
        </span>
        <span className="uppercase leading-none text-muted">{current.code}</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* ---- Mobile: Bottom-Sheet ---- */}
            <motion.div
              className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              role="listbox"
              className="fixed inset-x-0 bottom-0 z-[90] max-h-[75vh] overflow-y-auto rounded-t-[22px] bg-cream px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 shadow-2xl md:hidden"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 34, stiffness: 340 }}
            >
              <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-black/15" aria-hidden />
              <p className="px-3 pb-1 pt-1 text-[13px] font-semibold text-muted">
                {TITLE[locale] ?? "Language"}
              </p>
              <div className="flex flex-col">{items}</div>
            </motion.div>

            {/* ---- Desktop: Dropdown ---- */}
            <motion.div
              role="listbox"
              className="absolute right-0 top-full z-[90] mt-2 hidden max-h-[70vh] w-56 overflow-y-auto rounded-[18px] border border-black/[0.06] bg-white p-1.5 shadow-xl md:block"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
            >
              {items}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
