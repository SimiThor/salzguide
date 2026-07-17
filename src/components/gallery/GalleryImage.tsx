"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useGalleryOpen } from "./SpotGalleryProvider";

// Klickbares Foto, das den Lightbox am gegebenen Index öffnet (Hero + Kacheln).
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

  return (
    <button
      type="button"
      onClick={() => open(index)}
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
    </button>
  );
}
