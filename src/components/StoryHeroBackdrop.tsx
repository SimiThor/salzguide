// Hintergrund des Story-Maker-Heros: eine flache, verspielte Berglandschaft (Airbnb/Komoot-
// Formen-Look), in WARMEN Marken-Tönen statt des alten kühlen Blau/Lila. Sonne, Himmel in
// Abenddämmerung, gestaffelte Berg-Silhouetten, ein Streifen Wiese. Bewusst mittel-dunkel:
// darüber liegen die weisse Routen-Linie und (unten) der weisse Titel-Text mit Scrim.
//
// EINE Quelle: dieselbe Grafik für alle Spot-Seiten. Reines Inline-SVG (kein Netzwerk, kein
// Layout-Sprung), skaliert per preserveAspectRatio="…slice" formatfüllend auf 16/10.
export default function StoryHeroBackdrop({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 250"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        {/* Himmel: warme Dämmerung von tief oben zu glühend am Horizont. */}
        <linearGradient id="sg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2632" />
          <stop offset="0.5" stopColor="#9b4d3b" />
          <stop offset="1" stopColor="#e58c4c" />
        </linearGradient>
        {/* Weiches Sonnenlicht um die Sonne. */}
        <radialGradient id="sg-sunglow" cx="0.31" cy="0.33" r="0.55">
          <stop offset="0" stopColor="#ffe1ad" stopOpacity="0.9" />
          <stop offset="0.4" stopColor="#f9ad63" stopOpacity="0.32" />
          <stop offset="1" stopColor="#f9ad63" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Himmel + Sonnenschein */}
      <rect width="400" height="250" fill="url(#sg-sky)" />
      <rect width="400" height="250" fill="url(#sg-sunglow)" />

      {/* Sonne (leicht überm Grat der fernen Berge). */}
      <circle cx="124" cy="79" r="31" fill="#ffdca0" />

      {/* Ferne Berge – hell, hazy, warm coral. */}
      <path
        d="M0 150 L58 108 L118 150 L182 96 L250 150 L316 112 L400 150 L400 250 L0 250 Z"
        fill="#d17b52"
        opacity="0.92"
      />
      {/* Mittlere Bergkette. */}
      <path
        d="M0 176 L70 132 L134 178 L206 126 L286 180 L346 146 L400 178 L400 250 L0 250 Z"
        fill="#963f2b"
      />
      {/* Vordere, dunkle Berge – geben Tiefe und tragen die weisse Route. */}
      <path
        d="M0 210 L86 162 L166 210 L246 166 L332 212 L400 188 L400 250 L0 250 Z"
        fill="#48241a"
      />
      {/* Wiese: warmer, leicht grüner Streifen ganz unten (grösstenteils unter dem Scrim). */}
      <path d="M0 227 Q200 213 400 229 L400 250 L0 250 Z" fill="#3f4326" />
    </svg>
  );
}
