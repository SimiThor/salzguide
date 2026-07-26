"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useDragScroll } from "@/lib/use-drag-scroll";

// Auf dem Server gibt es kein Layout, useLayoutEffect warnt dort. Auf dem Client MUSS es
// useLayoutEffect sein: die Pfeilhöhe muss VOR dem ersten Paint stehen (siehe measure()).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Horizontales Scroll-Karussell (docs/10):
// - Touch: natives Scrollen
// - Maus/Desktop: Drag-to-Scroll + iOS-2026-Glas-Pfeil-Buttons (nur md+)
// - scroll-snap, versteckte Scrollbar
// - Robuster Rand-Abstand über innere w-max-Schiene (hält beidseitig)
//
// WARUM DIE PFEILE BEIM LADEN NICHT MEHR WANDERN:
// Die Ruheposition der Pfeile wird gemessen (Mitte des Kartenbildes). Hier stand dazu
// `transition-all` plus eine Messung im normalen Effekt, und beides zusammen war der
// Fehler: Der Browser hat den Pfeil erst auf der Platzhalterhöhe (top-28) gezeichnet und
// ihn danach sichtbar auf die gemessene Höhe gefahren, bei jedem Seitenaufbau, bei jeder
// Karussell-Reihe einzeln. `transition-all` animiert eben auch `top`.
// Zwei Riegel dagegen, beide nötig:
//   1. Gemessen wird im Layout-Effekt, also VOR dem ersten Paint. Niemand sieht je die
//      ungemessene Höhe.
//   2. Die Übergangsliste der Knöpfe nennt nur opacity/translate/scale, NIE top. Ändert
//      sich die Höhe später doch (Breakpoint, Fenstergröße), sitzt der Pfeil im selben
//      Frame richtig statt hinterherzugleiten.
// Dieselbe Regel wie beim Sheet: Eine Ruheposition gehört nie in eine Animation.
//
// EINE BEWEGUNG FÜR DAS GANZE KARUSSELL (Apple/Airbnb-Muster):
// Die Pfeile gehören dem Karussell, nicht sich selbst. Zeiger irgendwo ins Karussell und
// beide blenden gemeinsam ein: Deckkraft, 4px aus ihrer Kante heraus, eine Spur größer,
// auf Apples Sheet-Kurve (--sg-ease-sheet, schwingt nicht nach). Zeiger raus, beide aus.
// Ohne Zeiger ist die Reihe vollkommen ruhig, und weil die Pfeile beim Laden unsichtbar
// sind, kann ein Messsprung gar nicht mehr auffallen.
// Am Touch-Gerät greift `hover` nicht (Tailwind stellt @media (hover: hover) davor), dort
// bleibt es beim nativen Wischen plus angeschnittener Nachbarkarte als Scroll-Hinweis.
// Tastatur: group-focus-within blendet genauso ein, sobald etwas im Karussell Fokus hat.
export default function Carousel({
  children,
  // Seitlicher Rand der Karten-Schiene. Default = Startseite (px-4); der KI-Chat
  // gibt einen kleineren Rand mit, damit die erste Karte nicht zu weit einrückt.
  // railPadClass & scrollPadClass sollten zusammenpassen (Snap richtet sich am
  // scroll-padding aus).
  railPadClass = "px-4",
  scrollPadClass = "scroll-px-4",
}: {
  children: ReactNode;
  railPadClass?: string;
  scrollPadClass?: string;
}) {
  const tc = useTranslations("Common");
  const outerRef = useRef<HTMLDivElement>(null);
  // Drag-to-Scroll (Maus) aus gemeinsamem Hook -> gleiches Verhalten wie im KI-Chat.
  const { ref, dragProps } = useDragScroll();
  // Startwerte so, dass VOR der Messung kein Pfeil sichtbar sein kann: an beiden Enden
  // und ohne Höhe. Alles andere hieße, im Server-HTML einen Pfeil zu behaupten, den der
  // Client gleich wieder wegnimmt.
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [arrowTop, setArrowTop] = useState<number | null>(null);

  const items = Array.isArray(children) ? children : [children];
  const count = items.length;

  // Eine Messung für beides: Wo sitzen die Pfeile, und darf man überhaupt blättern.
  useIsoLayoutEffect(() => {
    const outer = outerRef.current;
    const track = ref.current;
    if (!outer || !track) return;

    const measure = () => {
      // Rand-Status. Passt alles hinein, sind beide true -> beide Pfeile bleiben weg.
      const max = track.scrollWidth - track.clientWidth;
      setAtStart(track.scrollLeft <= 1);
      setAtEnd(track.scrollLeft >= max - 1);

      // Höhe: Mitte des ersten Kartenbildes. Der Anker wird bei JEDER Messung neu
      // gesucht, nicht einmal beim Mounten gemerkt: Die Regale tauschen ihre Karten aus
      // (Sommer/Winter), ein gemerkter Knoten hinge danach im Nichts.
      // Karussells ohne Bild-Anker fallen auf die erste Karte zurück.
      const anchor =
        outer.querySelector<HTMLElement>("[data-carousel-media]") ??
        (track.firstElementChild?.firstElementChild as HTMLElement | null);
      if (!anchor) return;
      const o = outer.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      setArrowTop(a.top - o.top + a.height / 2);
    };

    measure();
    track.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // Rahmen UND Schiene beobachten: Die Kartenbreite hängt an --sg-card, das an
    // --sg-panel, das an den Breakpoints. Jede dieser Änderungen ändert auch die
    // Breite des Rahmens und landet damit hier.
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(track);
    return () => {
      track.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [ref, count]);

  // Pfeil-Klick: um GANZE Karten weiterblättern und eine Karte sauber am linken Inset
  // ausrichten -> es wird nie mitten in einer Karte gestoppt (nichts abgeschnitten,
  // gut lesbar). Schrittweite = Anzahl voll sichtbarer Karten (>=1).
  function scrollByDir(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    // Bei "Bewegung reduzieren" wird gesprungen statt geglitten (die Klasse am Rahmen
    // ist aus demselben Grund motion-safe:scroll-smooth).
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    const rail = el.firstElementChild as HTMLElement | null;
    const cards = rail ? (Array.from(rail.children) as HTMLElement[]) : [];
    if (cards.length < 2) {
      el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior });
      return;
    }
    const inset = cards[0].offsetLeft; // = scroll-padding (px-4)
    const pitch = cards[1].offsetLeft - cards[0].offsetLeft; // Kartenbreite + gap
    const step = Math.max(1, Math.floor(el.clientWidth / pitch));
    const curIndex = Math.round(el.scrollLeft / pitch);
    const nextIndex = Math.max(0, Math.min(cards.length - 1, curIndex + dir * step));
    const maxScroll = el.scrollWidth - el.clientWidth;
    const target = Math.min(maxScroll, Math.max(0, cards[nextIndex].offsetLeft - inset));
    el.scrollTo({ left: target, behavior });
  }

  // Erst wenn gemessen wurde, darf ein Pfeil überhaupt auftauchen.
  const measured = arrowTop != null;
  const canPrev = measured && !atStart;
  const canNext = measured && !atEnd;

  // Der Schacht trägt Position und Ein-/Ausblenden, der Knopf darin nur seine eigene
  // Optik. Getrennt, weil sonst das Einblenden (scale-90 -> 100) und das Hover-Feedback
  // (scale-105) dieselbe Eigenschaft auf demselben Element überschreiben würden.
  // pointer-events erst beim Einblenden: Ein unsichtbarer Pfeil darf keinen Klick auf
  // die Karte darunter schlucken.
  // --sg-ease-ui, NICHT --sg-ease-sheet: Die Sheet-Kurve ist eine Ankunftskurve und
  // schiebt fast die ganze Strecke in den Anfang. Bei einer Deckkraft sah man davon nur,
  // dass der Pfeil halb durchsichtig auftauchte und dann hart auf voll sprang (gemessen:
  // nach 20 % der Zeit schon 66 % Deckkraft). Die Begründung steht bei den Tokens.
  const slot =
    "pointer-events-none absolute z-10 hidden -translate-y-1/2 transition-[opacity,translate,scale] duration-300 ease-[var(--sg-ease-ui)] motion-reduce:transition-none md:block";
  const revealed =
    "opacity-0 scale-90 group-hover/carousel:pointer-events-auto group-hover/carousel:translate-x-0 group-hover/carousel:scale-100 group-hover/carousel:opacity-100 group-focus-within/carousel:pointer-events-auto group-focus-within/carousel:translate-x-0 group-focus-within/carousel:scale-100 group-focus-within/carousel:opacity-100";
  const gone = "opacity-0 scale-90";
  const arrowBtn =
    "cursor-pointer disabled:cursor-not-allowed flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-ink shadow-[0_6px_18px_-8px_rgba(0,0,0,0.45)] ring-1 ring-black/5 backdrop-blur-md transition-[scale,background-color] duration-200 ease-out hover:scale-105 hover:bg-white active:scale-95 motion-reduce:transition-none";
  const arrowStyle = measured ? { top: arrowTop } : undefined;

  return (
    <div ref={outerRef} className="group/carousel relative">
      <div
        ref={ref}
        {...dragProps}
        className={`overflow-x-auto ${scrollPadClass} select-none [-ms-overflow-style:none] [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden md:cursor-grab md:active:cursor-grabbing`}
      >
        <div className={`flex w-max snap-x snap-mandatory gap-3 ${railPadClass} py-1`}>
          {items.map((child, i) => (
            <div key={i} className="snap-start">
              {child}
            </div>
          ))}
        </div>
      </div>

      {/* Pfeil zurück */}
      <div
        style={arrowStyle}
        className={`${slot} left-2 ${canPrev ? `-translate-x-1 ${revealed}` : gone}`}
      >
        <button
          type="button"
          aria-label={tc("back")}
          disabled={!canPrev}
          onClick={() => scrollByDir(-1)}
          className={arrowBtn}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Pfeil vor */}
      <div
        style={arrowStyle}
        className={`${slot} right-2 ${canNext ? `translate-x-1 ${revealed}` : gone}`}
      >
        <button
          type="button"
          aria-label={tc("next")}
          disabled={!canNext}
          onClick={() => scrollByDir(1)}
          className={arrowBtn}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
