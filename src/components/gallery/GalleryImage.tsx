"use client";

import { useEffect, useRef, useState } from "react";
import { useGalleryOpen } from "./SpotGalleryProvider";

// Klickbares Foto, das den Lightbox am gegebenen Index öffnet (Hero + Kacheln).
// Bis das Bild geladen ist: sichtbare Skeleton-Kachel mit sanftem Schimmer (Instagram-
// Stil); danach blendet das Bild weich ein. Aus dem Cache geladene Bilder erscheinen
// sofort (kein künstlicher Verzug); nur bei echtem Laden bleibt der Schimmer kurz stehen.
export default function GalleryImage({
  index,
  src,
  alt,
  className,
  imgClassName,
}: {
  index: number;
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
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
      className={`${className ?? ""} ${show ? "" : "sg-skeleton"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
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
