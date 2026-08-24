"use client";

import { formatNavDistanceM, maneuverArrowDeg } from "@/lib/nav-format";

// Die wichtigste Zeile im ganzen HUD: nächste Richtungsanweisung + Distanz dahin. Glas-
// Karte im bestehenden iOS-2026-Stil (Radius 22, Blur), gross genug, um sie im
// Augenwinkel bei Bewegung zu lesen – keine Feinschrift wie im Rest der App.
export default function ManeuverBanner({
  instruction,
  distanceM,
  type,
  modifier,
}: {
  instruction: string;
  distanceM: number | null;
  type: string;
  modifier?: string;
}) {
  const arriving = type === "arrive";
  return (
    <div className="pointer-events-none flex items-center gap-3 rounded-[22px] bg-white/90 px-4 py-3 shadow-[0_8px_28px_-10px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-accent/10 text-2xl"
      >
        {arriving ? (
          "🏁"
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
            style={{ transform: `rotate(${maneuverArrowDeg(modifier)}deg)` }}
          >
            <path d="M12 19V5" />
            <path d="M6 11l6-6 6 6" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        {distanceM != null && !arriving && (
          <span className="block text-[20px] font-bold leading-tight tabular-nums text-ink">
            {formatNavDistanceM(distanceM)}
          </span>
        )}
        <span className="block truncate text-[14px] leading-snug text-muted">{instruction}</span>
      </span>
    </div>
  );
}
