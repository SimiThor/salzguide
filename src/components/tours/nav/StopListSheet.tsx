"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import BottomSheet from "@/components/BottomSheet";
import type { TourStopView } from "@/lib/tour-types";

// Alle Stopps der Runde auf einen Blick, jeder anspielbar.
//
// WARUM ES DAS BRAUCHT, ZUSÄTZLICH ZU DEN PINS AUF DER KARTE: Die Kamera folgt dem Fahrer.
// Ein Stopp, der zwei Kilometer weiter liegt, ist gar nicht im Bild, also gibt es dort auch
// nichts anzutippen. Die Liste ist der Weg, der IMMER funktioniert, unabhängig davon, wohin
// die Karte gerade schaut und wie gut die Ortung ist.
//
// Sie ist ausdrücklich kein Ersatz für das automatische Angebot, sondern das Netz darunter.
// Beim Fahren soll niemand eine Liste durchsuchen; sie ist für den Moment, in dem etwas
// nicht klappt und der Gast am Straßenrand steht.
export default function StopListSheet({
  open,
  onClose,
  stops,
  currentIndex,
  heard,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  stops: TourStopView[];
  /** Welcher Stopp gerade im Streifen steht. Bekommt einen Rahmen, damit man sich wiederfindet. */
  currentIndex: number | null;
  /** Indizes der Stopps, deren Geschichte schon gelaufen ist. */
  heard: Set<number>;
  onPick: (index: number) => void;
}) {
  const t = useTranslations("Tours");
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      variant="floating"
      detents={[0.55, 0.92]}
      title={t("navAllStops")}
    >
      <ul className="space-y-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {stops.map((s, i) => {
          const aktuell = i === currentIndex;
          const gehoert = heard.has(i);
          return (
            <li key={s.spotSlug}>
              <button
                type="button"
                onClick={() => onPick(i)}
                className={`sg-hit flex w-full items-center gap-3 rounded-[16px] p-2.5 text-left transition active:scale-[0.99] ${
                  aktuell ? "bg-accent/10 ring-1 ring-accent/40" : "bg-black/[0.03]"
                }`}
              >
                <span className="relative shrink-0">
                  {s.imageUrl ? (
                    <Image
                      src={s.imageUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-[12px] object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-black/[0.06] text-[22px]">
                      {s.emoji ?? "🎧"}
                    </span>
                  )}
                  <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-cream">
                    {s.order}
                  </span>
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {s.title}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {/* Gesperrt heisst hier NICHT "geht nicht": Der Tipp fuehrt zur Kostprobe
                        und zum Kauf. Deshalb steht hier die Dauer und kein Schloss-Satz. */}
                    {gehoert ? `${t("navHeard")} · ` : ""}
                    {s.locked
                      ? t("navTeaser", { seconds: s.teaserSec ?? 20 })
                      : s.durationSec
                        ? // Aufgerundet auf ganze Minuten, `minutes` gibt es schon. Eine
                          // Geschichte von 46 Sekunden liest sich damit als "1 Min", und
                          // das genuegt: Hier steht, ob es kurz ist, keine Stoppuhr.
                          t("minutes", { count: Math.max(1, Math.round(s.durationSec / 60)) })
                        : t("play")}
                  </span>
                </span>

                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5.2v13.6a.8.8 0 0 0 1.23.67l10.4-6.8a.8.8 0 0 0 0-1.34L9.23 4.53A.8.8 0 0 0 8 5.2Z" />
                  </svg>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
