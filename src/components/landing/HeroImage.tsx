import { getImageProps } from "next/image";
import MediaSlot from "./MediaSlot";
import type { LandingImage } from "@/lib/landing-media";

// Ab hier gilt Querformat. Muss zu Tailwinds `md` passen, mit dem der Hero-Text umbricht.
const LANDSCAPE_FROM = "(min-width: 768px)";

/**
 * Das Hero-Bild in zwei Zuschnitten — und der Browser lädt GENAU EINEN.
 *
 * WARUM ES DIESE KOMPONENTE GIBT:
 * Vorher standen hier zwei <Image>, eines in `md:hidden`, eines in `hidden md:block`, und
 * BEIDE trugen `priority`. `priority` heisst eager plus hohe Priorität — CSS versteckt das
 * eine zwar, verhindert aber nichts: Der Browser lädt, was im HTML steht. Nachgemessen auf
 * der Startseite: zwei AVIF, 128 KB und 55 KB, eines davon sieht niemand. Auf dem Handy
 * sind das 55 KB umsonst, am Desktop 128 KB — und zwar auf der Seite, die den ersten
 * Eindruck macht und deren grösstes Element genau dieses Bild ist.
 *
 * `<picture>` mit `media` ist die einzige Stelle, an der die Auswahl VOR dem Laden fällt.
 * `getImageProps` liefert dafür die fertigen srcSets von next/image, wir verlieren also
 * weder die Optimierung noch AVIF noch die Grössen-Varianten. Genau so beschreibt Next
 * den Fall „Art Direction".
 *
 * Fehlt eines der beiden Bilder, gibt es nichts auszuwählen: Dann rendert der normale
 * MediaSlot, mitsamt seinem Platzhalter im richtigen Seitenverhältnis.
 */
export default function HeroImage({
  portrait,
  landscape,
  className = "",
}: {
  portrait: LandingImage | null;
  landscape: LandingImage | null;
  className?: string;
}) {
  if (!portrait || !landscape) {
    const only = portrait ?? landscape;
    return (
      <MediaSlot
        image={only}
        hint="Hero, Anton & Simon vor der Festung"
        sizes="100vw"
        priority
        className={className}
      />
    );
  }

  const common = { sizes: "100vw", priority: true, quality: 75 } as const;
  const hoch = getImageProps({
    ...common,
    src: portrait.src,
    alt: portrait.alt,
    width: portrait.width,
    height: portrait.height,
  }).props;
  const quer = getImageProps({
    ...common,
    src: landscape.src,
    alt: landscape.alt,
    width: landscape.width,
    height: landscape.height,
  }).props;

  return (
    <picture>
      <source media={LANDSCAPE_FROM} srcSet={quer.srcSet} sizes={quer.sizes} />
      {/* Das <img> trägt die Hochformat-Quelle und ist gleichzeitig der Fallback. */}
      <img
        {...hoch}
        alt={portrait.alt}
        className={className}
        // Das grösste Element der Seite. Beides sagt dem Browser, dass es zuerst kommt.
        fetchPriority="high"
        decoding="sync"
      />
    </picture>
  );
}
