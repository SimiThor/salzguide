// Einheitliche Darstellung gesperrter Pro-Inhalte: Startseiten-Karte, Spot-Sheet auf
// der Explore-Karte und Stopps im Audio-Guide. EINE Komponente, damit "gesperrt"
// überall dieselbe visuelle Sprache spricht (vorher: drei verschiedene Behandlungen).
//
// Zeigt die winzige Blur-Vorschau (48px breit, siehe lib/blur-preview.ts)
// formatfüllend: Farben und grobe Formen bleiben ahnbar -> Vorfreude aufs Foto.
// Details sind physisch nicht vorhanden, ein Blur-Filter in den DevTools bringt also
// nichts. Fehlt die Vorschau (kein Foto oder noch nicht erzeugt), fällt die Anzeige
// auf einen ruhigen Farbverlauf mit Emoji zurück.

// Erlaubt zusätzlich normale Div-Attribute (z.B. data-carousel-media der Karussell-Karte).
type LockedMediaProps = React.HTMLAttributes<HTMLDivElement> & {
  previewBlur: string | null;
  emoji?: string | null;
  // Optionales Abzeichen, z.B. "🤫 Geheimtipp". Ohne Text kein Abzeichen.
  label?: string;
  // Seitenverhältnis + Radius kommen vom Aufrufer (Karte 4/3, Sheet/Tour 16/10).
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
        // Kein next/image: Die Quelle ist bereits ein paar hundert Byte großer
        // data:-URI – der Optimizer hätte nichts zu tun und wäre nur Overhead.
        // scale-110 überdeckt die weichen Ränder, die der Blur am Bildrand erzeugt.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewBlur}
          alt=""
          aria-hidden
          // Der Blur glättet nur noch die Pixelkanten der hochskalierten Mini-Version –
          // die Details sind ohnehin schon serverseitig weg. Deshalb bewusst dezent:
          // Motiv soll ahnbar sein ("ein See im Wald"), nicht wiedererkennbar.
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-[6px] saturate-110"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-accent/15 to-muted/15" />
      )}

      {/* Scrim: hält das Abzeichen auf jedem Motiv lesbar und gibt dem Bild Tiefe. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-black/5 to-black/10" />

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
