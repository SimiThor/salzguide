// Gemeinsame Wetter-Icons für Streifen (Desktop) + Liste (Mobile).
// Minimalistisch, zweifarbig, passend zu unseren Brandfarben:
//   Sonne/Blitz = warmes Amber · Wolke/Nebel = warmes Grau · Regen/Schnee = ruhiges Blau
// (gleiche Blau->Amber-Logik wie der Temperatur-Bereichsbalken).

export type IconKind =
  | "sun"
  | "partly"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

const CLOUD = "#A29B95"; // warmes Grau (zu Creme/Muted passend)
const SUN = "#F0A23C"; // warmes Amber (Warm-Ende des Temp-Balkens)
export const RAIN = "#5E97CE"; // ruhiges Blau (Kalt-Ende des Temp-Balkens)

// WMO-Wettercode -> Icon-Kategorie.
export function kindForCode(code: number): IconKind {
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "partly";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  if (code >= 61 && code <= 67) return "rain";
  if ((code >= 51 && code <= 57) || (code >= 80 && code <= 82)) return "drizzle";
  return "cloud"; // 3 = bedeckt + Fallback
}

// "Regnet es (bzw. fällt Niederschlag)?" -> Regenwahrscheinlichkeit nur dann
// unter dem Icon zeigen (wie bei Apple unter den Regenwolken).
export function isWetCode(code: number): boolean {
  const k = kindForCode(code);
  return k === "drizzle" || k === "rain" || k === "snow" || k === "thunder";
}

// Ein zweifarbiges, dünnes Linien-Icon pro Wetterlage (SF-Symbols-Anmutung).
export function WeatherGlyph({
  kind,
  size = 26,
}: {
  kind: IconKind;
  size?: number;
}) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "sun":
      return (
        <svg {...p} stroke={SUN}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      );
    case "partly":
      return (
        <svg {...p} stroke={CLOUD}>
          <g stroke={SUN}>
            <path d="M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41" />
            <path d="M15.95 12.65a4 4 0 0 0-5.93-4.13" />
          </g>
          <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...p} stroke={CLOUD}>
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      );
    case "fog":
      return (
        <svg {...p} stroke={CLOUD}>
          <path d="M15.5 12.5H8a5 5 0 1 1 4.8-6.4h1.3a3.55 3.55 0 0 1 1.4 6.4Z" />
          <path d="M6 16.5h11M8 20h8" />
        </svg>
      );
    case "drizzle":
      return (
        <svg {...p} stroke={CLOUD}>
          <path d="M16 14.5H8a5 5 0 1 1 4.8-6.4h1.3A3.5 3.5 0 0 1 16 14.5Z" />
          <path
            stroke={RAIN}
            d="M9 17.5l-.7 1.6M15 17.5l-.7 1.6M12 19l-.7 1.6"
          />
        </svg>
      );
    case "rain":
      return (
        <svg {...p} stroke={CLOUD}>
          <path d="M16 14H8a5 5 0 1 1 4.8-6.4h1.3A3.5 3.5 0 0 1 16 14Z" />
          <path stroke={RAIN} d="M9 16.5l-1 3M15 16.5l-1 3M12 18l-1 3" />
        </svg>
      );
    case "snow":
      return (
        <svg {...p} stroke={CLOUD}>
          <path d="M16 13.5H8a5 5 0 1 1 4.8-6.4h1.3A3.5 3.5 0 0 1 16 13.5Z" />
          <path
            stroke={RAIN}
            d="M8.5 17v.01M12 18.5v.01M15.5 17v.01M8.5 20.5v.01M15.5 20.5v.01M12 22v.01"
          />
        </svg>
      );
    case "thunder":
      return (
        <svg {...p} stroke={CLOUD}>
          <path d="M16 13.5H8a5 5 0 1 1 4.8-6.4h1.3A3.5 3.5 0 0 1 16.3 13.5" />
          <path stroke={SUN} d="M12.5 12l-2.3 3.6h3l-2.3 3.6" />
        </svg>
      );
  }
}
