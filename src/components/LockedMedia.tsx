// Einheitliche Darstellung gesperrter Pro-Spots: Karussell-Karte, Spot-Sheet (mobil),
// Desktop-Panel und Paywall-Seite. EINE Komponente, damit "gesperrt" überall dieselbe
// visuelle Sprache spricht (vorher: an jeder Stelle eine eigene Behandlung).
//
// Zeigt die 96px-Vorschau (siehe lib/blur-preview.ts) formatfüllend. Sie soll das
// Motiv WIRKEN lassen – die Fotos sind das Verkaufsargument. Geheim bleiben Name und
// Lage, nicht das Bild: Titel sind geschwärzt, Koordinaten auf ~1 km gerundet.
// Fehlt die Vorschau (kein Foto oder noch nicht erzeugt), fällt die Anzeige auf einen
// ruhigen Farbverlauf mit Emoji zurück.

// Erlaubt zusätzlich normale Div-Attribute (z.B. data-carousel-media der Karussell-Karte).
type LockedMediaProps = React.HTMLAttributes<HTMLDivElement> & {
  previewBlur: string | null;
  emoji?: string | null;
  // Abzeichen, z.B. "🤫 Geheimtipp". NUR setzen, wo das Bild allein steht (Karussell).
  // Wo daneben schon eine Überschrift "Geheimtipp" steht (Sheet, Desktop-Panel), bleibt
  // es weg – sonst steht dasselbe Wort zweimal übereinander.
  label?: string;
  // Seitenverhältnis + Radius kommen vom Aufrufer (Karte 4/3, Sheet/Panel 16/10).
  className?: string;
};

export default function LockedMedia({
  previewBlur,
  emoji,
  label,
  className = "",
  ...rest
}: LockedMediaProps) {
  return (
    // transform-gpu + isolate: erzwingt in Safari das Clipping der runden Ecken,
    // obwohl ein Kind einen blur()-Filter hat (sonst blitzen eckige Kanten durch).
    <div {...rest} className={`relative isolate transform-gpu overflow-hidden ${className}`}>
      {previewBlur ? (
        // Kein next/image: Die Quelle ist ein wenige Kilobyte großer data:-URI – der
        // Optimizer hätte nichts zu tun und wäre nur Overhead.
        // scale-105 überdeckt die weichen Ränder, die der Blur am Bildrand erzeugt.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewBlur}
          alt=""
          aria-hidden
          // Nur so viel Schleier, dass die Pixelkanten der hochskalierten Vorschau
          // verschwinden und "gesperrt" lesbar bleibt – das Motiv soll wirken.
          className="absolute inset-0 h-full w-full scale-105 object-cover blur-[3px] saturate-110"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-accent/15 to-muted/15" />
      )}

      {/* Nur so viel Scrim, wie das Abzeichen zum Lesen braucht – das Foto soll
          leuchten, nicht gedimmt wirken. Ohne Abzeichen genügt ein Hauch Tiefe. */}
      <div
        className={
          label
            ? "absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/10"
            : "absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"
        }
      />

      {!previewBlur && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-5xl opacity-80" aria-hidden>
            {emoji ?? "📍"}
          </span>
        </div>
      )}

      {label && (
        <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
          {label}
        </span>
      )}
    </div>
  );
}
