// Hintergrund des Story-Maker-Heros: eine flache, verspielte Salzburger Landschaft im
// Airbnb/Komoot-Formen-Look. Echte Landschaftsfarben, aber gedämpft/abgestimmt auf unsere
// Marke: blauer Alpen-Himmel, warme Sonne, GRAUE gestaffelte Berge (atmosphärisch von hinten
// hell/bläulich nach vorne dunkler), grüne Wiesen-Hügel im Vordergrund. Bewusst so getönt,
// dass die weisse Routen-Linie darüber und (unten, über dem Scrim) der weisse Titel lesbar
// bleiben.
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
        {/* Alpen-Himmel: sattes Blau oben, heller zum Horizont. */}
        <linearGradient id="sg-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5c90bd" />
          <stop offset="1" stopColor="#accbe0" />
        </linearGradient>
        {/* Weiches Sonnenlicht. */}
        <radialGradient id="sg-sun" cx="0.3" cy="0.3" r="0.52">
          <stop offset="0" stopColor="#fff4d4" stopOpacity="0.7" />
          <stop offset="0.45" stopColor="#ffe9b0" stopOpacity="0.18" />
          <stop offset="1" stopColor="#ffe9b0" stopOpacity="0" />
        </radialGradient>
        {/* Wiese: frisches Grün, unten etwas dunkler. */}
        <linearGradient id="sg-meadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6f9a4c" />
          <stop offset="1" stopColor="#4a6f33" />
        </linearGradient>
      </defs>

      {/* Himmel + Sonnenschein */}
      <rect width="400" height="250" fill="url(#sg-sky)" />
      <rect width="400" height="250" fill="url(#sg-sun)" />

      {/* Sonne */}
      <circle cx="118" cy="74" r="26" fill="#ffe49b" />

      {/* Ferne Berge – hell, bläulich-grau (atmosphärische Ferne). Unregelmässige Gipfel:
          ein dominanter Grat, dazwischen niedrigere Kuppen, variabler Abstand. */}
      <path
        d="M0 134 L44 110 L92 132 L150 82 L198 124 L244 100 L300 130 L356 106 L400 122 L400 250 L0 250 Z"
        fill="#9cb4c4"
        opacity="0.92"
      />
      {/* Mittlere Bergkette – klares Grau, VERSETZT zur fernen Kette (Gipfel liegen zwischen
          deren Gipfeln -> Tiefe), ebenfalls unregelmässig. */}
      <path
        d="M0 172 L64 128 L112 166 L176 100 L226 150 L292 120 L340 162 L400 138 L400 250 L0 250 Z"
        fill="#76828d"
      />
      {/* Vordere grüne Wiesen-Hügel (weiche Kuppen statt Zacken), bewusst höher, damit das
          Grün auch über dem Titel-Scrim sichtbar bleibt. */}
      <path
        d="M0 190 Q104 166 208 185 T400 182 L400 250 L0 250 Z"
        fill="url(#sg-meadow)"
      />
    </svg>
  );
}
