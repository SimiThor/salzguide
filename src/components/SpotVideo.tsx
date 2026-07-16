"use client";

import { useState } from "react";
import Image from "next/image";
import { Play } from "./icons";

// 9:16-Video (iOS-2026): weiße Karte wie die anderen Sektionen; ein SEHR sanfter, heller
// Farbschleier (unscharfes Standbild, stark aufgehellt) füllt dezent die Kartenbreite,
// damit die Hochkant-Karte auf dem Desktop nicht verloren wirkt – ohne dunkel/ablenkend zu
// sein. Davor zentriert das scharfe Hochkant-Video. Kein Titel. Performance: erst Standbild,
// Video (preload="none") lädt ERST beim Antippen.
export default function SpotVideo({
  src,
  poster,
  label,
}: {
  src: string;
  poster: string | null;
  label: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-white shadow-sm ring-1 ring-black/5">
      {/* Das Vorschaubild selbst, unscharf – in seinen ECHTEN Farben (nicht heller/dunkler),
          füllt die Kartenbreite -> das Hochkant-Video wirkt „wie aus einem Guss". */}
      {poster && (
        <Image
          src={poster}
          alt=""
          fill
          sizes="760px"
          aria-hidden
          className="scale-110 object-cover blur-2xl"
        />
      )}

      {/* Hochkant-Video zentriert */}
      <div className="relative flex justify-center px-4 py-6">
        <div className="relative aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-[18px] bg-black shadow-md ring-1 ring-black/10">
          {playing ? (
            <video
              src={src}
              poster={poster ?? undefined}
              className="h-full w-full object-cover"
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={label}
              className="sg-skeleton group absolute inset-0 h-full w-full"
            >
              {poster ? (
                <Image src={poster} alt="" fill sizes="300px" className="object-cover" />
              ) : (
                <div className="h-full w-full bg-black/40" />
              )}
              <span className="absolute inset-0 bg-black/10 transition group-active:bg-black/20" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur-md transition group-active:scale-95">
                  <Play className="h-7 w-7 text-accent" />
                </span>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
