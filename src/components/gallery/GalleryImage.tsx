"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useGalleryOpen } from "./SpotGalleryProvider";

// Foto, das den Lightbox am gegebenen Index öffnet (Galerie-Kacheln).
// Mit `zoomable={false}` bleibt es ein reines Bild ohne Tippfläche: das Hero-Foto
// oben füllt den halben Bildschirm, direkt darauf liegen Zurück- und Merken-Knopf.
// Wer daneben tippt, wollte fast immer zurück und nicht das Bild vergrössern -> das
// Hero reagiert gar nicht mehr, die Fotos bleiben über die Galerie darunter gross
// erreichbar (im Lightbox nach links wischen).
// Bis das Bild geladen ist: sichtbare Skeleton-Kachel mit sanftem Schimmer (Instagram-
// Stil); danach blendet das Bild weich ein. Aus dem Cache geladene Bilder erscheinen
// sofort (kein künstlicher Verzug); nur bei echtem Laden bleibt der Schimmer kurz stehen.
//
// Auslieferung über next/image: aus dem WebP-Master rechnet der Optimizer je Gerät die
// passende Grösse als AVIF/WebP. Darum `fill` + `sizes` statt eines rohen <img>, das das
// volle Master lädt. Die BOX-Masse gibt immer die `className` vor (der Button ist der
// positionierte Rahmen), nie das Bild selbst.
export default function GalleryImage({
  index,
  src,
  alt,
  sizes,
  className,
  imgClassName,
  priority = false,
  quality = 62,
  zoomable = true,
}: {
  index: number;
  src: string;
  alt: string;
  /** Welche Breite das Bild real belegt, fürs Varianten-Auswählen (z.B. "100vw"). */
  sizes: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  /** Galerie/Hero werden klein gezeigt; 62 spart die Hälfte, ohne sichtbar zu leiden. */
  quality?: number;
  /** false = reines Bild ohne Tippfläche (Hero), siehe Kommentar oben. */
  zoomable?: boolean;
}) {
  const open = useGalleryOpen();
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    // Schon im Cache -> sofort zeigen (kein Skeleton nötig).
    if (imgRef.current?.complete) {
      void Promise.resolve().then(() => {
        setImgLoaded(true);
        setMinDone(true);
      });
      return;
    }
    // Sonst Schimmer mind. ~500 ms zeigen -> sichtbares, smoothes Instagram-Gefühl.
    const t = setTimeout(() => setMinDone(true), 500);
    return () => clearTimeout(t);
  }, []);

  const show = imgLoaded && minDone;

  // Ohne Zoom bewusst KEIN <button>: kein Klick, kein Fokus-Rahmen, kein
  // Screenreader-Knopf. Das Bild ist dann nur noch Deko im Hintergrund.
  const Box = zoomable ? "button" : "div";

  return (
    <Box
      {...(zoomable
        ? { type: "button" as const, onClick: () => open(index) }
        : null)}
      className={`relative ${className ?? ""} ${show ? "" : "sg-skeleton"}`}
    >
      <Image
        ref={imgRef}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        draggable={false}
        onLoad={() => setImgLoaded(true)}
        onError={() => setImgLoaded(true)}
        className={`${imgClassName ?? ""} transition-opacity duration-500 ${
          show ? "opacity-100" : "opacity-0"
        }`}
      />
    </Box>
  );
}
