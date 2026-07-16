// Spot-Karte im iOS-Stil (docs/10). Presentational — keine Hooks.
// Pro + gesperrt -> "🤫 Geheimtipp"-Badge + verschleierter Titel + Blur-Vorschau
// (LockedMedia, gleiche Darstellung wie Spot-Sheet und Audio-Guide).
// Bilder via next/image (AVIF/WebP + responsive + lazy) -> effizientes Laden.

import Image from "next/image";
import LockedMedia from "./LockedMedia";

type SpotCardProps = {
  title: string;
  shortDesc?: string | null;
  emoji?: string | null;
  imageUrl?: string | null;
  // Winzige Blur-Vorschau für gesperrte Spots (data:-URI). Bei locked ist imageUrl
  // serverseitig null – das echte Foto verlässt den Server nicht.
  previewBlur?: string | null;
  isPro?: boolean;
  locked?: boolean;
  lockedLabel?: string; // z.B. "🤫 Geheimtipp" / "🤫 Secret Spot"
  // Breiten-Klassen der Karte. Default = mobiles Karussell (Peek via 76vw).
  // Die Startseiten-Sidebar überschreibt dies mit einer aus --sg-panel abgeleiteten
  // Desktop-Breite (sauberer Halb-Anschnitt); Detailseite/Demo bleiben unberührt.
  sizeClassName?: string;
};

export default function SpotCard({
  title,
  shortDesc,
  emoji,
  imageUrl,
  previewBlur = null,
  locked = false,
  lockedLabel = "🤫 Geheimtipp",
  sizeClassName = "w-[76vw] max-w-[300px]",
}: SpotCardProps) {
  return (
    <article className={`${sizeClassName} shrink-0`}>
      {/* data-carousel-media: Anker, an dem das Karussell seine Pfeile vertikal zentriert. */}
      {locked ? (
        <LockedMedia
          previewBlur={previewBlur}
          emoji={emoji}
          label={lockedLabel}
          className="aspect-[4/3] w-full rounded-card shadow-sm"
          data-carousel-media
        />
      ) : (
        // transform-gpu + isolate: erzwingt in Safari das Clipping der runden Ecken
        // (sonst zeigen sich eckige Kanten).
        <div
          data-carousel-media
          className={`relative aspect-[4/3] w-full transform-gpu isolate overflow-hidden rounded-card shadow-sm ${
            imageUrl ? "sg-skeleton" : ""
          }`}
        >
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title}
              fill
              sizes="(min-width: 768px) 220px, 76vw"
              className="rounded-card object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-card bg-gradient-to-br from-accent/15 to-muted/15">
              <span className="text-5xl" aria-hidden>
                {emoji ?? "📍"}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="pt-2">
        <h3
          className={`text-[15px] font-semibold text-ink ${
            locked ? "select-none blur-[5px]" : ""
          }`}
        >
          {locked ? "••••• •••" : title}
        </h3>
        {shortDesc && !locked && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
            {shortDesc}
          </p>
        )}
      </div>
    </article>
  );
}
