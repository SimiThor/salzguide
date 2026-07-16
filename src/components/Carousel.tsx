"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useDragScroll } from "@/lib/use-drag-scroll";

// Horizontales Scroll-Karussell (docs/10):
// - Touch: natives Scrollen
// - Maus/Desktop: Drag-to-Scroll + iOS-2026-Glas-Pfeil-Buttons (nur md+)
// - scroll-snap, versteckte Scrollbar
// - Robuster Rand-Abstand über innere w-max-Schiene (hält beidseitig)
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
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  // Vertikale Pfeil-Position: exakt auf die Bildmitte der Karten gemessen (statt fixem
  // top-28), damit die Pfeile bei JEDER Kartengröße/-höhe sauber zentriert sitzen.
  const [arrowTop, setArrowTop] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const updateEdges = () => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    updateEdges();
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [ref]);

  // Pfeile mittig auf das Kartenbild ausrichten – misst das erste [data-carousel-media]
  // und rechnet neu bei Grössenänderung (responsive Kartenbreite).
  useEffect(() => {
    const outer = outerRef.current;
    const media = outer?.querySelector<HTMLElement>("[data-carousel-media]");
    if (!outer || !media) return;
    const recompute = () => {
      const o = outer.getBoundingClientRect();
      const m = media.getBoundingClientRect();
      setArrowTop(m.top - o.top + m.height / 2);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(media);
    ro.observe(outer);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, []);

  // Pfeil-Klick: um GANZE Karten weiterblättern und eine Karte sauber am linken Inset
  // ausrichten -> es wird nie mitten in einer Karte gestoppt (nichts abgeschnitten,
  // gut lesbar). Schrittweite = Anzahl voll sichtbarer Karten (>=1).
  function scrollByDir(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const rail = el.firstElementChild as HTMLElement | null;
    const items = rail ? (Array.from(rail.children) as HTMLElement[]) : [];
    if (items.length < 2) {
      el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
      return;
    }
    const inset = items[0].offsetLeft; // = scroll-padding (px-4)
    const pitch = items[1].offsetLeft - items[0].offsetLeft; // Kartenbreite + gap
    const step = Math.max(1, Math.floor(el.clientWidth / pitch));
    const curIndex = Math.round(el.scrollLeft / pitch);
    const nextIndex = Math.max(0, Math.min(items.length - 1, curIndex + dir * step));
    const maxScroll = el.scrollWidth - el.clientWidth;
    const target = Math.min(maxScroll, Math.max(0, items[nextIndex].offsetLeft - inset));
    el.scrollTo({ left: target, behavior: "smooth" });
  }

  const items = Array.isArray(children) ? children : [children];

  const arrowBase =
    "absolute top-28 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-ink shadow-md ring-1 ring-black/5 backdrop-blur-md transition-all hover:scale-105 hover:bg-white md:flex";
  const arrowStyle = arrowTop != null ? { top: arrowTop } : undefined;

  return (
    <div ref={outerRef} className="relative">
      <div
        ref={ref}
        {...dragProps}
        className={`overflow-x-auto ${scrollPadClass} scroll-smooth select-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:cursor-grab md:active:cursor-grabbing`}
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
      <button
        type="button"
        aria-label={tc("back")}
        onClick={() => scrollByDir(-1)}
        style={arrowStyle}
        className={`${arrowBase} left-2 ${
          atStart ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* Pfeil vor */}
      <button
        type="button"
        aria-label={tc("next")}
        onClick={() => scrollByDir(1)}
        style={arrowStyle}
        className={`${arrowBase} right-2 ${
          atEnd ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
