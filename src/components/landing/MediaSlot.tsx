import Image from "next/image";
import type { LandingImage } from "@/lib/landing-media";

// Ein Bild-Platz auf der Startseite. Ist das Bild noch nicht geliefert (`image === null`),
// steht hier ein markierter Platzhalter im RICHTIGEN Seitenverhältnis — das Layout ist
// damit schon final, und beim Eintragen der echten Datei springt nichts.
//
// `sizes` ist Pflicht (kein Default): ohne die Angabe lädt next/image auf dem Handy das
// Desktop-Bild. Genau so wird aus „hochauflösend" versehentlich „langsam".
export default function MediaSlot({
  image,
  sizes,
  priority = false,
  className = "",
  hint,
}: {
  image: LandingImage | null;
  sizes: string;
  /** Nur für das Hero-Bild: lädt es vorrangig (LCP). Sonst aus lassen. */
  priority?: boolean;
  className?: string;
  /** Was hier später hinkommt — steht im Platzhalter. */
  hint: string;
}) {
  if (!image) {
    return (
      <div
        className={`grid place-items-center bg-black/[0.04] ${className}`}
        // Der Platzhalter ist Gerüst, kein Inhalt: Screenreader sollen ihn nicht vorlesen.
        aria-hidden
      >
        <div className="px-4 text-center">
          <p className="text-[22px]" aria-hidden>
            🖼️
          </p>
          <p className="mt-1 text-[11px] font-medium leading-snug text-muted/70">{hint}</p>
        </div>
      </div>
    );
  }

  return (
    <Image
      src={image.src}
      alt={image.alt}
      width={image.width}
      height={image.height}
      sizes={sizes}
      priority={priority}
      className={className}
    />
  );
}
