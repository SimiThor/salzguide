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
  // Sofort laden statt lazy, und mit hoher Netz-Priorität. NUR für Bilder setzen, die
  // beim Aufbau garantiert im Bild stehen.
  //
  // NETZ, NICHT OPTIK: Das Bild wartet trotzdem auf seine Welle und erscheint mit den
  // anderen zusammen. Diese Trennung ist der Grund, warum hier ein eigenes Merkmal steht
  // und nicht einfach next/image's priority durchgereicht wird: In dieser Datei bedeutet
  // es NUR "lade früh". Wann etwas erscheint, entscheidet allein use-image-reveal.ts.
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
  eager = false,
  quality,
  ...rest
}: SmoothImageProps) {
  // Ohne zweites Argument: Ein Foto in einer Karte, einem Sheet oder einer Liste hat
  // IMMER ein Tor und wartet auf seine Welle. Die Ausnahme (LCP-Bild ohne Tor) gibt es
  // nur auf der Detailseite, und die geht über GalleryImage.
  const { ref, skeletonClassName, imageClassName, onLoad, onError } = useImageReveal(src);

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
        // priority UND fetchPriority, beides nachgemessen:
        // - priority allein: Vorablade-Zeile im Kopf, aber die Anfrage ging als "Low"
        //   hinaus (Chrome stuft vorgeladene Bilder ohne fetchpriority niedrig ein).
        // - fetchPriority allein: "High", aber keine Vorablade-Zeile.
        // Zusammen: "High" und früh entdeckt.
        //
        // Next warnt in der Entwicklung trotzdem, dieses Bild sei das LCP-Element ohne
        // priority. Das ist ein Fehlalarm und bleibt einer: Next merkt sich pro Bild-URL
        // nur den ZULETZT gerenderten Eintrag, und dasselbe Foto steht auf der
        // Entdecken-Seite noch einmal weiter unten (faul, wie es sein soll) und ein
        // drittes Mal in der versteckten Handy-Kopie. Dagegen hülfe nur, jeden Zwilling
        // auch eilig zu laden - also Bandbreite für Fotos zu verbrennen, die niemand
        // sieht. Die Anfrage geht nachweislich als "High" hinaus, und darauf kommt es an.
        {...(eager ? { priority: true, fetchPriority: "high" as const } : null)}
        // Deko-Foto, kein Download: nicht ziehbar (das Langdruck-Menü sperrt .sg-tap-card).
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className={`${imgClassName} ${imageClassName}`}
      />
    </div>
  );
}
