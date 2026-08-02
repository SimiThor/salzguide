// Spot-Karte im iOS-Stil (docs/10). Presentational — keine Hooks.
// Pro + gesperrt -> "🤫 Geheimtipp"-Badge + verschleierter Titel + Blur-Vorschau
// (LockedMedia, gleiche Darstellung wie Spot-Sheet und Audio-Guide).
// Bilder via next/image (AVIF/WebP + responsive + lazy) -> effizientes Laden.
// Das Erscheinen des Fotos (Schimmer + weiche Blende) macht SmoothImage, damit eine
// Reihe Karten nicht sechsmal einzeln aufblitzt.

import LockedMedia from "./LockedMedia";
import SmoothImage from "./SmoothImage";
import type { AiOrigin } from "@/lib/ai-origin";

type SpotCardProps = {
  title: string;
  shortDesc?: string | null;
  emoji?: string | null;
  imageUrl?: string | null;
  // KI-Herkunft des Fotos (Art. 50 KI-VO, docs/39 §5a): gesetzt trägt die Kachel das
  // kleine KI-Label. Jeder Aufrufer mit echtem Foto MUSS den Wert durchreichen.
  imageAiOrigin?: AiOrigin | null;
  // Winzige Blur-Vorschau für gesperrte Spots (data:-URI). Bei locked ist imageUrl
  // serverseitig null – das echte Foto verlässt den Server nicht.
  previewUrl?: string | null;
  isPro?: boolean;
  locked?: boolean;
  lockedLabel?: string; // z.B. "🤫 Geheimtipp" / "🤫 Secret Spot"
  // Breiten-Klassen der Karte. Default = mobiles Karussell (Peek via 76vw).
  // Die Startseiten-Sidebar überschreibt dies mit einer aus --sg-panel abgeleiteten
  // Desktop-Breite (sauberer Halb-Anschnitt); Detailseite/Demo bleiben unberührt.
  sizeClassName?: string;
  // MUSS zur echten Kartenbreite passen (sizeClassName!). Stimmt es nicht, lädt der
  // Browser eine zu kleine Stufe und skaliert hoch -> weiche Fotos. Die Startseite
  // (376px-Karten) übergibt deshalb ihre eigene Angabe.
  sizes?: string;
  // Sofort laden statt lazy (Netz-Priorität hoch). NUR für die Karten setzen, die beim
  // Aufbau garantiert im Bild stehen: die erste Reihe. Alles andere bleibt lazy, sonst
  // lädt die Seite Fotos, die nie jemand sieht.
  // Ändert NICHT, wann die Karte erscheint - das macht die Welle in use-image-reveal.ts.
  eager?: boolean;
};

export default function SpotCard({
  title,
  shortDesc,
  emoji,
  imageUrl,
  imageAiOrigin,
  previewUrl = null,
  locked = false,
  lockedLabel = "🤫 Geheimtipp",
  sizeClassName = "w-[76vw] max-w-[300px]",
  sizes = "(min-width: 768px) 300px, 76vw",
  eager = false,
}: SpotCardProps) {
  return (
    <article className={`${sizeClassName} shrink-0`}>
      {/* data-carousel-media: Anker, an dem das Karussell seine Pfeile vertikal zentriert. */}
      {locked ? (
        <LockedMedia
          previewUrl={previewUrl}
          emoji={emoji}
          label={lockedLabel}
          eager={eager}
          className="aspect-[4/3] w-full rounded-card shadow-sm"
          data-carousel-media
        />
      ) : imageUrl ? (
        <SmoothImage
          data-carousel-media
          src={imageUrl}
          alt={title}
          sizes={sizes}
          eager={eager}
          aiOrigin={imageAiOrigin}
          className="aspect-[4/3] w-full rounded-card shadow-sm"
          imgClassName="rounded-card object-cover"
        />
      ) : (
        <div
          data-carousel-media
          className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-card bg-gradient-to-br from-accent/15 to-muted/15 shadow-sm"
        >
          <span className="text-5xl" aria-hidden>
            {emoji ?? "📍"}
          </span>
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
