"use client";

import { useTranslations } from "next-intl";
import { formatNavDistanceM, maneuverArrowDeg } from "@/lib/nav-format";

// Nähe zur Abbiegung als Farbe, nicht nur als Zahl: Der Fahrer liest im Augenwinkel,
// ob gleich etwas passiert, ohne die Ziffern zu entziffern (OsmAnd-Muster). Drei Stufen,
// abgeleitet aus 18 km/h und den Ansage-Distanzen in docs/40.
function urgency(distanceM: number | null): "far" | "near" | "now" {
  if (distanceM == null) return "far";
  if (distanceM <= 30) return "now"; // gleich, rund 6 Sekunden
  if (distanceM <= 120) return "near"; // die Stufe, auf die man reagiert
  return "far";
}

// Die wichtigste Fläche im ganzen Fahrbildschirm: die nächste Anweisung und wie weit es
// noch dahin ist. Sie ist bewusst die grösste Schrift der App.
//
// WAS HIER FRÜHER FALSCH WAR: Die Anweisung stand in 14px, in der Sekundärfarbe und mit
// `truncate`. Gemessen auf einem iPhone-Viewport: 354px Text in 278px Platz, also war
// "Leicht nach links auf Kreuzbergpromenade abbiegen" schlicht abgeschnitten. Der Text
// ist aber die Anweisung, nicht die Beschriftung der Anweisung. Er bekommt jetzt zwei
// Zeilen und Gewicht; abgeschnitten wird erst danach.
export default function ManeuverBanner({
  instruction,
  distanceM,
  type,
  modifier,
  followedBy,
}: {
  instruction: string;
  distanceM: number | null;
  type: string;
  modifier?: string;
  /**
   * Die naechste Abbiegung, wenn sie weniger als 50 m dahinter liegt (lib/nav-steps.ts).
   * Ohne diese Zeile hoert der Gast "rechts" und steht zwanzig Meter spaeter ueberrascht
   * vor der naechsten Kreuzung.
   */
  followedBy?: { type: string; modifier?: string };
}) {
  const t = useTranslations("Tours");
  const arriving = type === "arrive";
  const level = arriving ? "now" : urgency(distanceM);

  return (
    <div
      className={`sg-nav-card pointer-events-none flex items-center gap-3.5 rounded-[22px] px-4 py-3.5 ${
        level === "now" ? "ring-2" : ""
      }`}
      style={level === "now" ? { ["--tw-ring-color" as string]: "var(--nav-accent)" } : undefined}
    >
      <span
        aria-hidden
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] text-2xl"
        style={{
          background: level === "far" ? "rgba(255,255,255,0.08)" : "var(--nav-accent-soft)",
          color: level === "far" ? "var(--nav-muted)" : "var(--nav-accent)",
        }}
      >
        {arriving ? (
          "🏁"
        ) : (
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: `rotate(${maneuverArrowDeg(modifier)}deg)` }}
          >
            <path d="M12 19V5" />
            <path d="M6 11l6-6 6 6" />
          </svg>
        )}
      </span>

      <span className="min-w-0 flex-1">
        {distanceM != null && !arriving && (
          // 34px statt 20px: Diese Zahl wird bei Fahrtwind und Vibration gelesen, aus
          // etwa 60 cm Abstand, oft mit Sonne auf dem Glas.
          <span
            className={`block text-[34px] font-bold leading-none tabular-nums ${
              level === "far" ? "text-ink" : "text-accent"
            }`}
          >
            {formatNavDistanceM(distanceM)}
          </span>
        )}
        <span
          className="mt-1 block text-[15px] font-semibold leading-tight text-ink"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {instruction}
        </span>
        {followedBy && !arriving && (
          // Bewusst klein und in der Sekundaerfarbe: Sie ist ein Ausblick, nicht die
          // Anweisung. Wer sie gleich gross setzt, hat zwei Anweisungen und keine Reihenfolge.
          <span className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-muted">
            {t("navThen")}
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ transform: `rotate(${maneuverArrowDeg(followedBy.modifier)}deg)` }}
            >
              <path d="M12 19V5" />
              <path d="M6 11l6-6 6 6" />
            </svg>
          </span>
        )}
      </span>
    </div>
  );
}
