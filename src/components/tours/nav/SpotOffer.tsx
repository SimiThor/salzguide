"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { TourAudioApi } from "@/components/tours/useTourAudio";
import type { TourStopView } from "@/lib/tour-types";
import { formatNavDistanceM } from "@/lib/nav-format";

// Das Angebot an einem Audio-Spot, und derselbe Baustein danach als mitlaufender Player.
//
// WARUM EIN STREIFEN UND KEIN SHEET: Vorher sprang bei jeder Ankunft ein BottomSheet auf,
// das die Karte übernahm. Zwei Dinge gingen dabei schief. Erstens verdeckte es genau das,
// was der Gast beim Fahren braucht, nämlich die nächste Abbiegung. Zweitens war das
// Zuziehen des Sheets dieselbe Aktion wie "weiter zum nächsten Stopp": Wer die Karte sehen
// wollte und nach unten wischte, schaltete ungewollt weiter und kam nicht zurück.
//
// Hier bleibt beides getrennt: Der Streifen liegt über der Karte, nimmt zwei Zeilen, und
// das Wegtippen (X) beendet nur das Angebot. Läuft das Audio, schrumpft der Streifen auf
// eine Zeile mit Fortschrittsbalken und die Führung bleibt die ganze Zeit sichtbar.
export default function SpotOffer({
  stop,
  distanceM,
  audio,
  isCurrent,
  onPlay,
  onDismiss,
  onOpenDetails,
}: {
  stop: TourStopView;
  // Entfernung entlang der Route bis zum Spot. Negativ heisst: schon vorbei.
  distanceM: number | null;
  audio: TourAudioApi;
  // Zeigt der Player gerade GENAU diesen Spot? Nur dann darf der Fortschritt hierher.
  isCurrent: boolean;
  onPlay: () => void;
  onDismiss: () => void;
  onOpenDetails: () => void;
}) {
  const t = useTranslations("Tours");
  const running = isCurrent && audio.playing;
  const started = isCurrent && audio.time > 0;
  const locked = stop.locked || !stop.audioUrl;
  const pct = isCurrent && audio.max > 0 ? Math.min(100, (audio.time / audio.max) * 100) : 0;

  return (
    <div className="sg-nav-card pointer-events-auto overflow-hidden rounded-[22px]">
      {/* Fortschritt als Linie am oberen Rand statt als eigene Zeile: Der Gast liest sie
          im Augenwinkel, sie kostet aber keine Höhe, die der Karte fehlt. */}
      {started && (
        <div className="h-[3px] w-full bg-white/10">
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <div className="flex items-center gap-3 px-3 py-2.5">
        {stop.imageUrl ? (
          <Image
            src={stop.imageUrl}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-[12px] object-cover"
          />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white/10 text-[20px]">
            {stop.emoji ?? "🎧"}
          </span>
        )}

        <button
          type="button"
          onClick={onOpenDetails}
          className="sg-hit min-w-0 flex-1 text-left"
          aria-label={stop.title}
        >
          <span className="block truncate text-[15px] font-bold leading-tight text-ink">
            {stop.title}
          </span>
          <span className="block truncate text-[12px] text-muted">
            {running
              ? t("navPlaying")
              : distanceM != null && distanceM > 0
                ? t("navAhead", { distance: formatNavDistanceM(distanceM) })
                : t("navHere")}
          </span>
        </button>

        {locked ? (
          <span className="shrink-0 rounded-full bg-white/10 px-3 py-2 text-[13px] font-semibold text-muted">
            🔒
          </span>
        ) : (
          // 56px, weit über den 44pt Mindestfläche: Dieser Knopf wird mit dem Daumen
          // getroffen, während das Rad rollt. Er ist das einzige Bedienelement im
          // Fahrbetrieb, das wirklich zählt, und darf deshalb der grösste sein.
          <button
            type="button"
            onClick={onPlay}
            aria-label={running ? t("pause") : t("play")}
            className="sg-nav-on-accent flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent shadow-md transition active:scale-95"
          >
            {running ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="4.5" width="4" height="15" rx="1.4" />
                <rect x="14" y="4.5" width="4" height="15" rx="1.4" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5.2v13.6a.8.8 0 0 0 1.23.67l10.4-6.8a.8.8 0 0 0 0-1.34L9.23 4.53A.8.8 0 0 0 8 5.2Z" />
              </svg>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("navDismiss")}
          className="sg-hit -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition active:scale-95"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
