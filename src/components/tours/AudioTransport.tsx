"use client";

import { useTranslations } from "next-intl";
import { Play, Pause, ChevronLeft, ChevronRight } from "@/components/icons";
import type { TourAudioApi } from "./useTourAudio";

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function AudioTransport({
  audio,
  index,
  total,
  canPlay,
}: {
  audio: TourAudioApi;
  index: number;
  total: number;
  canPlay: boolean;
}) {
  const t = useTranslations("Tours");
  const max = audio.max;
  const pct = max > 0 ? (Math.min(audio.time, max) / max) * 100 : 0;
  return (
    <div className="space-y-2.5">
      <input
        type="range"
        min={0}
        max={max || 0.0001}
        step={0.1}
        value={Math.min(audio.time, max)}
        disabled={!canPlay}
        aria-label={t("seek")}
        onPointerDown={audio.beginSeek}
        onPointerUp={audio.endSeek}
        onPointerCancel={audio.endSeek}
        onChange={(e) => audio.seek(Number(e.target.value))}
        style={{ "--sg-progress": `${pct}%` } as React.CSSProperties}
        className="sg-scrubber w-full"
      />
      <div className="flex justify-between text-[11px] tabular-nums text-muted">
        <span>{fmt(audio.time)}</span>
        <span>-{fmt(Math.max(0, max - audio.time))}</span>
      </div>
      <div className="flex items-center justify-center gap-8">
        <button
          type="button"
          onClick={() => audio.go(index - 1)}
          disabled={index === 0}
          aria-label={t("prev")}
          className="text-ink transition active:scale-90 disabled:opacity-30"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={audio.toggle}
          disabled={!canPlay}
          aria-label={audio.playing ? t("pause") : t("play")}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-md transition active:scale-95 disabled:opacity-40"
        >
          {audio.playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
        </button>
        <button
          type="button"
          onClick={() => audio.go(index + 1)}
          disabled={index === total - 1}
          aria-label={t("next")}
          className="text-ink transition active:scale-90 disabled:opacity-30"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}
