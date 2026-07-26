"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BottomSheet from "./BottomSheet";
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

// iOS-Menü-Indikator (chevron.up.chevron.down): das kleine Auf/Ab-Zeichen, das Apple an
// jeden Wert setzt, den man per Menü ÄNDERN kann. Genau das braucht der Sprachwähler, damit
// klar ist, dass er nicht nur die Sprache anzeigt, sondern sie umstellt.
function ChevronUpDown({ className = "text-muted/70" }: { className?: string }) {
  return (
    <svg
      width="11"
      height="14"
      viewBox="0 0 11 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 5.5 5.5 3 8 5.5" />
      <path d="M3 8.5 5.5 11 8 8.5" />
    </svg>
  );
}

// Am Handy ist die Liste ein ganz normales Sheet: EINE Stufe. Es gibt nichts aufzuziehen,
// also macht BottomSheet daraus automatisch „Hochziehen unmöglich, Runterwischen schließt"
// – dieselbe Bauart wie beim Login-Gate.
//
// Die Zahl ist der Anteil der Bildschirmhöhe und am Inhalt nachgemessen, nicht geschätzt:
// Balken + Titel + neun Zeilen sind 495px. Auf einem iPhone 15 (844px) macht 0.66 daraus
// ein 557px hohes Sheet – unter der letzten Zeile bleiben 60px, und davon sind auf einem
// Gerät mit Home-Indicator 34px der Indicator selbst. Die Liste steht also ganz da, ohne
// dass unten ein Streifen leere Fläche bleibt.
//
// Kommt eine Sprache dazu, bleibt das Sheet gleich hoch und die Liste scrollt darin (so
// auch heute schon auf einem iPhone SE). Das ist Absicht: eine Stufe, die mit jeder neuen
// Sprache wandert, stünde bei jedem Öffnen woanders.
const SHEET_DETENT = 0.66;

// Mehrsprachiger Sprachwähler (iOS-2026): Flaggen-Button -> Dropdown (Desktop) bzw. das
// gemeinsame Bottom-Sheet (Mobile). Alle Sprachen aus der zentralen Config -> neue Sprache
// erscheint automatisch. Wechsel behält den aktuellen Pfad (SEO: eigene Unterseite je Sprache).
//
// variant: "solid" (Standard) ist der flach gefüllte Plattform-Button (bg-black/5, KEIN Rand
// -> siehe ui.ts: „Mit Rand heisst Zustand"), damit er in den App-Headern wie jeder andere
// Knopf aussieht. Er setzt aber einen HELLEN, ruhigen Hintergrund voraus: 5% Schwarz auf
// einem Foto ist praktisch unsichtbar.
//
// "overlay" ist die Fassung für genau diesen Fall — der Wähler liegt über einem Foto (Hero
// der Spot-Unterseite, Hero der Startseite) und muss seinen Kontrast selbst mitbringen.
// Er trägt deshalb Klasse für Klasse dieselbe Glas-Pille wie die anderen Knöpfe, die dort
// schon über dem Bild schweben (BackButton, SaveButton, TourView): bg-white/85, shadow-md,
// backdrop-blur-md. Das ist ui.ts-Ausnahme 3 („über Foto trennt der SCHATTEN statt der
// Füllung") und macht die drei Hero-Knöpfe zu einer erkennbaren Familie.
//
// h-10 statt py-1.5: Dieselbe Höhe wie die runden 40px-Knöpfe daneben, sonst steht eine
// 31px-Pille neben zwei 40px-Kreisen und die Zeile wirkt zusammengewürfelt.
export default function LanguageSwitcher({
  variant = "solid",
}: {
  variant?: "solid" | "overlay";
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = localeMeta(locale);

  // Welche der beiden Ansichten offen geht, entscheidet hier ausnahmsweise JS und nicht
  // CSS: Ein offenes BottomSheet WIRKT (es sperrt das Scrollen der Seite). Ein nur per
  // `md:hidden` weggeblendetes Sheet würde am PC die Seite einfrieren, während oben das
  // Dropdown steht. Aufblitzen kann dabei nichts – beim ersten Bild ist nichts offen,
  // gemessen wird erst, wenn jemand tippt.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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
        // In einer Liste mit role="listbox" heißt „das hier ist es gerade" aria-selected,
        // nicht aria-current – und die Zeilen brauchen dafür role="option". Ohne das war
        // die Liste eine Listbox ohne einzige Option und VoiceOver las nur Knöpfe vor.
        role="option"
        aria-selected={active}
        className={`cursor-pointer flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
          active ? "bg-accent/10 text-accent" : "text-ink hover:bg-black/5 active:bg-black/5"
        }`}
      >
        <span className="text-[20px] leading-none" aria-hidden>
          {m.flag}
        </span>
        <span className="flex-1 text-[15px] font-medium">{m.name}</span>
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
        className={`cursor-pointer inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink transition active:scale-[0.98] ${
          variant === "overlay"
            ? "h-10 bg-white/85 px-3.5 shadow-md backdrop-blur-md hover:bg-white"
            : "bg-black/5 px-3 py-1.5 hover:bg-black/10"
        }`}
      >
        <span className="text-[15px] leading-none" aria-hidden>
          {current.flag}
        </span>
        {/* Über dem Foto trägt das Kürzel volles Ink statt Muted: Auf der weissen Pille
            liegt oft ein heller Himmel, und ein 13px-Wort in Warmgrau ist genau das, was
            man dann „fast nicht erkennt". Im Header bleibt es sekundär (muted), dort ist
            der Hintergrund ruhig. */}
        <span className={`uppercase leading-none ${variant === "overlay" ? "text-ink" : "text-muted"}`}>
          {current.code}
        </span>
        <ChevronUpDown className={variant === "overlay" ? "text-muted" : "text-muted/70"} />
      </button>

      {/* ---- Mobile: das gemeinsame Bottom-Sheet ----
          Nicht mehr von Hand nachgebaut: Vorher war das ein eigenes Sheet mit eigener
          Feder, eigenem Balken und eigenen Innenmaßen (16px statt der 20px, die jedes
          andere Sheet hat) – und mit zwei echten Fehlern. Der Balken sah ziehbar aus,
          war es aber nicht (220px nach unten gezogen: das Sheet blieb stehen, während
          das Spot-Sheet bei derselben Geste zugeht), und die Seite dahinter scrollte
          weiter (gemessen: 269px, weil der Scroll-Riegel fehlte). Beides erledigt
          BottomSheet, das ist genau seine Aufgabe.

          layer="top": Der Wähler steckt auch IM Burger-Menü (z-[70]) und muss darüber
          aufgehen, nicht dahinter. */}
      {/* AN document.body, NICHT hierher: Das Sheet ist `position: fixed`, und fixed heisst
          nur so lange „am Bildschirm", wie kein Vorfahre einen eigenen Bezugsrahmen
          aufspannt. Genau das tun `backdrop-filter` und `transform` — und der Wähler steckt
          in beidem:
            - Startseiten-Kopfzeile: bekommt beim Scrollen `backdrop-blur-xl` (LandingNav).
            - iPhone-Burger: die Schublade wird per transform eingefahren (MobileHeader).
          Folge ohne Portal, am Handy nachgemessen: Sobald man die Startseite scrollte, sass
          das GESCHLOSSENE Sheet (es steht per translateY um seine eigene Höhe nach unten
          versetzt im DOM) plötzlich sichtbar bei y=60 unter der Leiste und legte sich über
          die halbe Seite. Niemand hatte es geöffnet. Im Burger wäre es zusätzlich nur so
          breit wie die Schublade geworden.
          Ein Portal an body kann kein Vorfahre mehr umrechnen. `layer="top"` sorgt weiter
          dafür, dass es über der Schublade liegt.
          `isPhone` ist beim ersten Bild false (wird erst im Effekt gemessen), deshalb läuft
          createPortal nie serverseitig. */}
      {isPhone &&
        createPortal(
          <BottomSheet
            open={open}
            onClose={() => setOpen(false)}
            detents={[SHEET_DETENT]}
            title={TITLE[locale] ?? "Language"}
            layer="top"
          >
            <div role="listbox" aria-label={TITLE[locale] ?? "Language"} className="flex flex-col">
              {items}
            </div>
          </BottomSheet>,
          document.body,
        )}

      <AnimatePresence>
        {open && (
          <>
            {/* ---- Desktop: Dropdown ---- */}
            <motion.div
              role="listbox"
              className="absolute right-0 top-full z-[90] mt-2 hidden max-h-[70svh] w-56 overflow-y-auto rounded-[18px] border border-black/[0.06] bg-white p-1.5 shadow-xl md:block"
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
