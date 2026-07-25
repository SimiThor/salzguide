"use client";

import Image from "next/image";
import { useImageReveal } from "@/lib/use-image-reveal";

// DAS Foto der Plattform: Kachel mit Schimmer, darüber blendet das Bild weich ein.
// Überall dort, wo ein Spot-Foto in einer Liste, Karte oder einem Sheet steht
// (SpotCard, SpotCardDesktop, SpotSheet, Gespeichert). Die Regel, wann eingeblendet
// wird und wann nicht, steht EINMAL in lib/use-image-reveal.ts.
//
// Die Box-Masse gibt immer die `className` des Aufrufers vor (aspect-[4/3], Radius,
// Schatten), nie das Bild selbst: Das Bild liegt per `fill` darin und füllt sie aus.
// Damit ist die Kachel schon in der richtigen Grösse da, bevor das Foto kommt – nichts
// springt nach, wenn es ankommt.
type SmoothImageProps = React.HTMLAttributes<HTMLDivElement> & {
  src: string;
  alt: string;
  /** Welche Breite das Bild real belegt, fürs Varianten-Auswählen (z.B. "(min-width: 768px) 376px, 76vw"). */
  sizes: string;
  /** Klassen der Kachel: Seitenverhältnis, Radius, Schatten. */
  className?: string;
  /** Klassen des Bildes. Default object-cover. */
  imgClassName?: string;
  /** Nur fürs LCP-Bild: kein Tor, kein Schimmer (siehe use-image-reveal.ts). */
  priority?: boolean;
  // Sofort laden statt lazy, und mit hoher Netz-Priorität. NUR für Bilder setzen, die
  // beim Aufbau garantiert im Bild stehen.
  //
  // NETZ, NICHT OPTIK: Das Bild wartet trotzdem auf seine Welle und erscheint mit den
  // anderen zusammen. Genau darum ist das hier ein eigenes Merkmal und nicht `priority`:
  // priority nimmt das Tor weg, das Bild würde also allein vorpreschen — und "eins ist
  // da, der Rest kommt später" ist der Zustand, den die Welle gerade abgeschafft hat.
  // Schneller wird es trotzdem: Die Welle wartet auf ihr LETZTES Bild, und das kommt
  // früher, wenn die sichtbaren Bilder nicht hinten in der Warteschlange stehen.
  eager?: boolean;
  quality?: number;
};

export default function SmoothImage({
  src,
  alt,
  sizes,
  className = "",
  imgClassName = "object-cover",
  priority = false,
  eager = false,
  quality,
  ...rest
}: SmoothImageProps) {
  const { ref, skeletonClassName, imageClassName, onLoad, onError } = useImageReveal(
    src,
    priority,
  );

  return (
    // transform-gpu + isolate: erzwingt in Safari das Clipping der runden Ecken
    // (sonst zeigen sich eckige Kanten).
    <div
      {...rest}
      className={`relative isolate transform-gpu overflow-hidden ${skeletonClassName} ${className}`}
    >
      <Image
        ref={ref}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        // Bewusst getrennt von `priority`: kein <link rel=preload> im Kopf. Die Bilder
        // stehen bereits im Server-HTML, der Vorab-Leser des Browsers findet sie also
        // ohnehin beim Parsen. Was fehlt, ist nur die Dringlichkeit, und die steht hier.
        {...(eager && !priority ? { loading: "eager" as const, fetchPriority: "high" as const } : null)}
        // Deko-Foto, kein Download: nicht ziehbar (das Langdruck-Menü sperrt .sg-tap-card).
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className={`${imgClassName} ${imageClassName}`}
      />
    </div>
  );
}
