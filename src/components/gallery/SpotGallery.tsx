"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import GalleryImage from "./GalleryImage";

// Foto-Karussell im Google-Maps-Stil (Fotos NACH dem Hero):
// abwechselnd 1 großes / 2 kleine gestapelte Kacheln, feste (sichtbreiten-relative)
// Größe -> Fotos bleiben groß, egal wie viele; horizontal scrollbar.
// PC: Drag-to-Scroll + iOS-2026-Glas-Pfeil-Buttons (nur md+, wie die Startseiten-Karussells).
export default function SpotGallery({ images }: { images: string[] }) {
  const tc = useTranslations("Common");
  const gallery = images.slice(1);
  const g = gallery.length;

  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Rand-Zustand: Pfeile blenden am Anfang/Ende aus; ohne Überlauf beide aus.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [g]);

  // Pfeil-Klick: zur nächsten/vorherigen Foto-Spalte blättern (an Spaltenkante
  // ausrichten, nie mitten im Bild stoppen). Fallback: ~85% Sichtbreite.
  function scrollByDir(dir: 1 | -1) {
    const el = scroller.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    const max = el.scrollWidth - el.clientWidth;
    if (items.length < 2) {
      el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
      return;
    }
    const cur = el.scrollLeft;
    let target: number;
    if (dir === 1) {
      const next = items.find((c) => c.offsetLeft > cur + 8);
      target = next ? next.offsetLeft : max;
    } else {
      const prev = [...items].reverse().find((c) => c.offsetLeft < cur - 8);
      target = prev ? prev.offsetLeft : 0;
    }
    el.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: "smooth" });
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const el = scroller.current;
    if (!el) return;
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current.active || !scroller.current) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    scroller.current.scrollLeft = drag.current.startScroll - dx;
  }
  function endDrag() {
    drag.current.active = false;
  }
  // Nach echtem Ziehen den folgenden Klick schlucken (kein Lightbox-Öffnen).
  function onClickCapture(e: React.MouseEvent) {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  }

  if (g === 0) return null;

  // 1–2 Fotos: sauberes Raster über die volle Sektionsbreite (kein Karussell/Überlauf) –
  // exakt so breit wie die Sektion darüber, robust auf PC & iPhone.
  if (g <= 2) {
    return (
      <div className={`grid gap-2 ${g === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {gallery.map((src, i) => (
          <GalleryImage
            key={src}
            index={i + 1}
            src={src}
            alt=""
            sizes={g === 2 ? "(min-width: 768px) 360px, 50vw" : "(min-width: 768px) 720px, 100vw"}
            className="h-72 cursor-zoom-in overflow-hidden rounded-[14px]"
            imgClassName="object-cover"
          />
        ))}
      </div>
    );
  }

  // Spalten abwechselnd: groß(1) / Stapel(2); einzelner Rest = volle Kachel.
  const cols: number[][] = [];
  for (let i = 0, big = true; i < g; big = !big) {
    if (big || i === g - 1) {
      cols.push([i]);
      i += 1;
    } else {
      cols.push([i, i + 1]);
      i += 2;
    }
  }

  const bigTile =
    "h-full grow shrink-0 basis-[50%] cursor-zoom-in overflow-hidden rounded-[14px]";
  const stackTile = "min-h-0 flex-1 cursor-zoom-in overflow-hidden rounded-[12px]";
  const img = "object-cover";
  // Die Kacheln sind ~288px hoch; die grosse belegt gut die halbe Breite, die gestapelten
  // etwas mehr als ein Drittel. Grob passend gewählt -> der Optimizer nimmt die nächste Stufe.
  const bigSizes = "(min-width: 768px) 380px, 60vw";
  const stackSizes = "(min-width: 768px) 300px, 45vw";

  // Glas-Pfeile exakt wie bei den Startseiten-Karussells, vertikal in der Galerie zentriert.
  const arrowBase =
    "absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-ink shadow-md ring-1 ring-black/5 backdrop-blur-md transition-all hover:scale-105 hover:bg-white md:flex";

  return (
    <div className="relative">
      <div
        ref={scroller}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
        className="-mx-4 flex h-72 select-none gap-2 overflow-x-auto px-4 scroll-smooth cursor-grab [-ms-overflow-style:none] [scrollbar-width:none] active:cursor-grabbing sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {cols.map((col) =>
          col.length === 1 ? (
            <GalleryImage
              key={gallery[col[0]]}
              index={col[0] + 1}
              src={gallery[col[0]]}
              alt=""
              sizes={bigSizes}
              className={bigTile}
              imgClassName={img}
            />
          ) : (
            <div
              key={gallery[col[0]]}
              className="flex h-full grow shrink-0 basis-[36%] flex-col gap-2"
            >
              {col.map((gi) => (
                <GalleryImage
                  key={gallery[gi]}
                  index={gi + 1}
                  src={gallery[gi]}
                  alt=""
                  sizes={stackSizes}
                  className={stackTile}
                  imgClassName={img}
                />
              ))}
            </div>
          ),
        )}
      </div>

      {/* Pfeil zurück */}
      <button
        type="button"
        aria-label={tc("back")}
        onClick={() => scrollByDir(-1)}
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
