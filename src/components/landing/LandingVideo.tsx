"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { LandingVideo as LandingVideoAsset } from "@/lib/landing-media";
import { Play } from "@/components/icons";

// Hochkant-Video (9:16) für die Startseite. NUR das Video, kein Rahmen: Hier war mal eine
// weisse Karte drumherum, mit einem unscharfen Schleier aus dem eigenen Standbild als
// Hintergrund (das Muster von SpotVideo). Auf einer Detailseite hat das seinen Sinn, weil
// die schmale Hochkant-Karte dort neben breiten Text-Sektionen sonst verloren wirkt. Auf
// der Startseite steht das Video in einer eigenen Spalte und braucht nichts, was es hält.
// Ein Rahmen um ein Video ist eine Kachel, die sich selbst zeigt.
//
// Performance-Muster bleibt: erst das Standbild, das Video (preload="none") lädt ERST beim
// Antippen. Ein Autoplay-Video im Hintergrund würde genau den ersten Eindruck kosten, für
// den es da ist, und auf einem Handy im Tal auch noch das Datenvolumen.
//
// Ein einziges Hochformat-Video für Handy UND Desktop (so bestellt).
export default function LandingVideo({
  video,
  hint,
}: {
  video: LandingVideoAsset | null;
  hint: string;
}) {
  const t = useTranslations("Home");
  const [playing, setPlaying] = useState(false);

  return (
    // transform-gpu isolate overflow-hidden: sonst franst Safari die runden Ecken aus.
    // Kein fixes max-w hier: die Breite bestimmt die Spalte in FoundersSection, damit das
    // Video am iPhone die volle Breite nutzt und am Desktop mit der Spalte mitwächst.
    <div className="relative aspect-[9/16] w-full transform-gpu isolate overflow-hidden rounded-[22px] bg-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-24px_rgba(0,0,0,0.45)]">
      {!video ? (
        <div className="grid h-full w-full place-items-center px-4 text-center" aria-hidden>
          <div>
            <p className="text-[22px]">🎬</p>
            <p className="mt-1 text-[11px] font-medium leading-snug text-muted/70">{hint}</p>
          </div>
        </div>
      ) : playing ? (
        <video
          src={video.src}
          poster={video.poster}
          className="h-full w-full object-cover"
          controls
          autoPlay
          playsInline
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={t("videoPlay")}
          className="group relative h-full w-full"
        >
          <Image
            src={video.poster}
            alt=""
            fill
            // Am iPhone volle Spaltenbreite, am Desktop die halbe Spalte. Ohne diese
            // Angabe lädt next/image auf dem Handy das Desktop-Bild.
            sizes="(min-width: 768px) 380px, 100vw"
            className="object-cover"
          />
          {/* Verlauf unten: Der weisse Play-Knopf muss auch auf einem hellen Standbild
              sichtbar bleiben. Ohne den hängt seine Lesbarkeit am Motiv des Videos. */}
          <span className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/90 text-ink shadow-lg backdrop-blur-md transition group-active:scale-95">
              <Play className="ml-0.5 h-6 w-6" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
