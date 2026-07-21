"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import BottomSheet from "./BottomSheet";
import ClipTrimmer from "./ClipTrimmer";
import { composeStory, CLIP_SECONDS, MAX_INPUT_BYTES, type ComposeStage } from "@/lib/video-maker";
import { getFFmpeg } from "@/lib/ffmpeg";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

type Phase = "idle" | "trim" | "working" | "done" | "error";

// Video-Maker (Schicht B): Der Besucher hängt einen eigenen Clip an die vorgerenderte
// Wander-Animation und teilt das fertige Story-Video. Alles im Browser (ffmpeg.wasm,
// src/lib/video-maker.ts) - der Clip verlässt das Gerät nie. Erscheint nur auf Spots mit
// Intro. Ändert die Wanderkarte nicht: eigene Section.
export default function VideoMaker({
  introUrl,
  introPosterUrl,
  slug,
}: {
  introUrl: string;
  introPosterUrl?: string | null;
  slug: string;
}) {
  const t = useTranslations("Detail.videoMaker");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState<ComposeStage>("intro");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clipFile, setClipFile] = useState<File | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLVideoElement>(null);

  // Hintergrund-Video nur abspielen, wenn die Section im Bild ist (Daten/Akku sparen).
  useEffect(() => {
    const v = bgRef.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const reset = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    blobRef.current = null;
    setPhase("idle");
    setPct(0);
  };

  // Clip gewählt -> erst den Trimmer zeigen (Stelle wählen), dann zusammensetzen.
  const onFile = (file: File | undefined) => {
    // Der Input filtert schon auf video/* (accept). Manche Browser liefern leeren Typ ->
    // nur ablehnen, wenn ein Typ da ist und der KEIN Video ist.
    if (!file) return;
    if (file.type && !file.type.startsWith("video/")) return;
    if (file.size > MAX_INPUT_BYTES) {
      setErrorMsg(t("tooBig"));
      setPhase("error");
      return;
    }
    setErrorMsg(null);
    setClipFile(file);
    setPhase("trim");
  };

  const startCompose = async (startSec: number) => {
    const clip = clipFile;
    if (!clip) return;
    setPhase("working");
    setPct(0);
    setStage("intro");
    try {
      const blob = await composeStory({
        introUrl,
        clip,
        startSec,
        onProgress: (s, p) => {
          setStage(s);
          setPct(p);
        },
      });
      blobRef.current = blob;
      setResultUrl(URL.createObjectURL(blob));
      setPhase("done");
    } catch (e) {
      console.error("composeStory:", e);
      setPhase("error");
    }
  };

  const download = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `salzguide-${slug}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const file = new File([blob], `salzguide-${slug}.mp4`, { type: "video/mp4" });
    // Handy: echter Teilen-Dialog (direkt in die Instagram-Story). Sonst herunterladen.
    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch {
        // Abbruch durch den Nutzer oder Teilen nicht möglich -> Fallback Download.
      }
    }
    download();
  };

  const pick = () => inputRef.current?.click();
  const stageLabel =
    stage === "clip" ? t("stageClip") : stage === "merge" ? t("stageMerge") : t("stageIntro");

  return (
    <>
      {/* Section im iOS-Stil: das Intro-Video läuft als Hintergrund, darüber ein Verlauf
          und kurzer, klarer Text plus die CTA. Erklärt das Feature auf einen Blick. */}
      <section className="relative aspect-[4/3] overflow-hidden rounded-[22px] shadow-sm ring-1 ring-black/5">
        <video
          ref={bgRef}
          src={introUrl}
          poster={introPosterUrl ?? undefined}
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 pt-12">
          <h2 className="text-[19px] font-bold leading-tight text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.55)]">
            🎬 {t("sectionTitle")}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-white/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]">
            {t("sectionSub")}
          </p>
          <button
            className={`${BTN_PRIMARY} mt-3 w-full active:scale-[0.98]`}
            onClick={() => {
              reset();
              setOpen(true);
              void getFFmpeg().catch(() => {}); // Core vorwärmen -> Trimmer + Compose starten schneller
            }}
          >
            {t("button")}
          </button>
        </div>
      </section>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("title")} detents={[0.72, 0.94]}>
        <div className="px-5 pb-8 pt-2">
          {phase === "idle" && (
            <div className="space-y-4">
              <p className="text-[15px] leading-relaxed text-muted">{t("intro")}</p>
              <p className="text-[13px] text-muted">{t("hint")}</p>
              <button className={`${BTN_PRIMARY} w-full active:scale-[0.98]`} onClick={pick}>
                {t("pick")}
              </button>
            </div>
          )}

          {phase === "trim" && clipFile && (
            <ClipTrimmer
              file={clipFile}
              windowSec={CLIP_SECONDS}
              onConfirm={startCompose}
              onCancel={() => {
                setClipFile(null);
                setPhase("idle");
              }}
            />
          )}

          {phase === "working" && (
            <div className="space-y-4 py-8 text-center">
              <p className="text-[15px] font-semibold text-ink">{stageLabel}</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[13px] text-muted">{pct}%</p>
            </div>
          )}

          {phase === "done" && resultUrl && (
            <div className="space-y-4">
              <video
                src={resultUrl}
                controls
                playsInline
                className="mx-auto max-h-[52vh] rounded-2xl bg-black"
              />
              <div className="grid grid-cols-2 gap-3">
                <button className={`${BTN_PRIMARY} w-full active:scale-[0.98]`} onClick={share}>
                  {t("share")}
                </button>
                <button className={`${BTN_SECONDARY} w-full active:scale-[0.98]`} onClick={download}>
                  {t("download")}
                </button>
              </div>
              <button
                className="w-full py-1 text-[14px] text-muted underline"
                onClick={() => {
                  reset();
                  pick();
                }}
              >
                {t("again")}
              </button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-4 py-8 text-center">
              <p className="text-[15px] text-ink">{errorMsg ?? t("error")}</p>
              <button className={`${BTN_PRIMARY} w-full active:scale-[0.98]`} onClick={pick}>
                {t("pick")}
              </button>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </BottomSheet>
    </>
  );
}
