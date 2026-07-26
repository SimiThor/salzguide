"use client";

import Image from "next/image";
import { useImageReveal } from "@/lib/use-image-reveal";
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
  // Schimmer + Blende kommen aus der gemeinsamen Regel (lib/use-image-reveal.ts), damit
  // Galerie und Karten identisch erscheinen. Dort steht auch, warum das priority-Bild
  // (Hero = LCP) kein Opacity-Tor bekommt.
  const { ref, skeletonClassName, imageClassName, onLoad, onError } = useImageReveal(
    src,
    priority,
  );

  // Ohne Zoom bewusst KEIN <button>: kein Klick, kein Fokus-Rahmen, kein
  // Screenreader-Knopf. Das Bild ist dann nur noch Deko im Hintergrund.
  const Box = zoomable ? "button" : "div";

  return (
    <Box
      {...(zoomable
        ? { type: "button" as const, onClick: () => open(index) }
        : null)}
      className={`relative ${zoomable ? "cursor-pointer " : ""}${className ?? ""} ${skeletonClassName}`}
    >
      <Image
        ref={ref}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className={`${imgClassName ?? ""} ${imageClassName}`}
      />
    </Box>
  );
}
