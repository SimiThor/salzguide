"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import BottomSheet from "@/components/BottomSheet";
import AudioTransport from "@/components/tours/AudioTransport";
import StopLockedCard from "@/components/tours/StopLockedCard";
import type { TourAudioApi } from "@/components/tours/useTourAudio";
import type { TourStopView } from "@/lib/tour-types";

// Erscheint automatisch, sobald bike-nav-core.ts eine Ankunft meldet. `variant="floating"`
// (BottomSheet.tsx), weil die Karte dahinter scharf & bedienbar bleiben soll – die
// Navigation läuft ja weiter, sobald die Karte geschlossen wird. Audio läuft über
// dieselbe useTourAudio-Instanz wie die Tour-Übersicht (TourView.tsx): dieselbe Regel,
// dieselbe Wiedergabe, kein zweiter Player.
export default function ArrivalSheet({
  open,
  stop,
  freeStops,
  totalStops,
  audio,
  index,
  total,
  // Steuert der Player GERADE diesen Spot? Nur dann gehören die Wiedergabetasten hierher.
  isCurrent,
  onPlayThis,
  onContinue,
}: {
  open: boolean;
  stop: TourStopView | null;
  freeStops: number;
  totalStops: number;
  audio: TourAudioApi;
  isCurrent: boolean;
  onPlayThis: () => void;
  index: number;
  total: number;
  onContinue: () => void;
}) {
  const t = useTranslations("Tours");
  if (!stop) return null;
  const canPlay = !stop.locked && !!stop.audioUrl;

  return (
    <BottomSheet
      open={open}
      onClose={onContinue}
      variant="floating"
      detents={[0.46, 0.9]}
      title={t("arrivedTitle")}
    >
      <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {stop.imageUrl && (
          <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-black/5 shadow-sm">
            <Image
              src={stop.imageUrl}
              alt=""
              fill
              sizes="(min-width: 768px) 27rem, 100vw"
              quality={62}
              className="object-cover"
            />
          </div>
        )}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("stopOf", { current: stop.order, total: totalStops })}
          </p>
          <h3 className="truncate text-[19px] font-bold leading-tight text-ink">{stop.title}</h3>
        </div>

        {stop.locked ? (
          <StopLockedCard freeStops={freeStops} total={totalStops} />
        ) : canPlay ? (
          <div>
            {/* Die Wiedergabetasten nur, wenn der Player auch WIRKLICH auf diesem Spot
                steht. Sonst zeigte das Sheet den einen Ort und steuerte die Geschichte
                eines anderen: Wer während einer laufenden Geschichte ein neues Angebot
                aufklappte, sah den neuen Ort und pausierte mit den Tasten darunter den
                alten. Solange sie auseinanderlaufen, gibt es hier nur einen Knopf, der
                genau diese Geschichte holt. */}
            {isCurrent ? (
              <AudioTransport audio={audio} index={index} total={total} canPlay={canPlay} />
            ) : (
              <button
                type="button"
                onClick={onPlayThis}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white transition active:scale-[0.98]"
              >
                ▶ {t("play")}
              </button>
            )}
            <p className="mt-1.5 text-[11px] leading-snug text-muted/80">{t("aiVoice")}</p>
          </div>
        ) : (
          <p className="rounded-[16px] bg-white/70 p-4 text-center text-[13px] text-muted">
            {t("noAudio")}
          </p>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="flex w-full items-center justify-center rounded-full bg-black/5 px-5 py-3 text-[15px] font-semibold text-ink transition active:scale-[0.98]"
        >
          {t("toNextStop")}
        </button>
      </div>
    </BottomSheet>
  );
}
