"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import ClipTrimmer from "./ClipTrimmer";
import { composeStory, CLIP_SECONDS, MAX_INPUT_BYTES, type ComposeStage } from "@/lib/video-maker";
import { getFFmpeg } from "@/lib/ffmpeg";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";

type Phase = "idle" | "trim" | "working" | "done" | "error";

// Video-Story (bisher VideoMaker): der Besucher hängt einen eigenen Clip an die
// vorgerenderte Wander-Animation und teilt das fertige Story-Video. Alles im Browser
// (ffmpeg.wasm, src/lib/video-maker.ts) - der Clip verlässt das Gerät nie. Lebt jetzt als
// Panel unter dem Video-Tab von StoryMaker; die Section + das Sheet gehören StoryMaker.
export default function StoryVideoPanel({
  introUrl,
  slug,
  onUiChange,
}: {
  introUrl: string;
  slug: string;
  // Meldet dem Sheet: Editor sichtbar (-> Voll) und ob gerade zusammengesetzt wird (-> Umschalten sperren).
  onUiChange?: (s: { expanded: boolean; busy: boolean }) => void;
}) {
  const t = useTranslations("Detail.videoMaker");
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState<ComposeStage>("intro");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clipFile, setClipFile] = useState<File | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ffmpeg-Core vorwärmen, sobald der Video-Tab sichtbar ist -> Trimmer + Compose starten
  // schneller. Nur hier, nicht für Foto-Nutzer.
  useEffect(() => {
    void getFFmpeg().catch(() => {});
  }, []);

  // Ergebnis-URL beim Verlassen freigeben (das Panel wird beim Schließen ausgehängt).
  useEffect(() => {
    return () => {
      if (blobRef.current) blobRef.current = null;
    };
  }, []);

  // Zustand ans Sheet melden: ab dem Trimmer ist der Editor sichtbar (-> Voll); während des
  // Zusammensetzens ist busy (Modus-Umschalten sperren, sonst bricht die Verarbeitung ab).
  const expanded = phase === "trim" || phase === "working" || phase === "done";
  useEffect(() => {
    onUiChange?.({ expanded, busy: phase === "working" });
  }, [expanded, phase, onUiChange]);

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
    <div className="pb-2">
      {phase === "idle" && (
        <button
          type="button"
          onClick={pick}
          className="sg-native-tap flex w-full flex-col items-center gap-3 rounded-[22px] border border-black/[0.08] bg-black/[0.02] px-6 py-11 text-center transition active:scale-[0.99]"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-2xl">
            🎬
          </span>
          <span className="text-[15px] font-semibold text-ink">{t("pick")}</span>
          <span className="max-w-[15rem] text-[13px] leading-snug text-muted">{t("hint")}</span>
        </button>
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
        <div className="space-y-4 py-10 text-center">
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
        <div className="space-y-4 py-10 text-center">
          <p className="text-[15px] text-ink">{errorMsg ?? t("error")}</p>
          <button className={`${BTN_PRIMARY} active:scale-[0.98]`} onClick={pick}>
            {t("pick")}
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
