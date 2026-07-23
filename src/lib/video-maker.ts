import { getFFmpeg } from "@/lib/ffmpeg";

// Baut das Story-Video KOMPLETT im Browser: vorgerendertes Intro (10s, 1080x1920, H.264,
// stumm) + getrimmter User-Clip. Nur der 5s-Clip wird neu kodiert (auf exakt die
// Intro-Parameter), das Intro wird stream-kopiert -> nur ~5s Rechenzeit statt 15s, auf dem
// Handy machbar. Rückgabe: ein MP4-Blob. Das Video verlässt das Gerät nie (kein Upload,
// Datenschutz by design).

export type ComposeStage = "intro" | "clip" | "merge" | "done";
export type ComposeProgress = (stage: ComposeStage, pct: number) => void;

const OUT_W = 1080;
const OUT_H = 1920;
export const CLIP_SECONDS = 5;
// Der ganze Eingabe-Clip landet im WASM-Speicher (auch wenn wir nur 5s nutzen). Ein
// harter Riegel gegen sehr große Dateien schützt vor Out-of-Memory, vor allem auf älteren
// iPhones (WASM-Speicher ist dort knapper). 120 MB deckt normale Handy-Clips locker ab.
export const MAX_INPUT_BYTES = 120 * 1024 * 1024;

export async function composeStory(opts: {
  introUrl: string;
  clip: File;
  startSec?: number; // Trim-Start im User-Clip
  onProgress?: ComposeProgress;
}): Promise<Blob> {
  const { introUrl, clip, startSec = 0, onProgress } = opts;
  const ff = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");

  const files = ["intro.mp4", "clip_in", "clip.mp4", "list.txt", "out.mp4"];
  const cleanup = async () => {
    for (const f of files) await ff.deleteFile(f).catch(() => {});
  };

  try {
    onProgress?.("intro", 0);
    // Beide Quellen ins ffmpeg-Dateisystem. Das Intro ist ein öffentliches Asset (CORS *).
    // WICHTIG: Das Intro mit `cache: "no-store"` laden, damit der Videoschnitt IMMER exakt
    // die Bytes nimmt, die auch das Vorschau-Video zeigt. Sonst kann der Browser-Cache hier
    // eine ältere, unter derselben URL abgelegte Fassung liefern (Titel oben statt auf 1/3),
    // während die <video>-Vorschau längst die neue revalidiert hat -> "Vorschau richtig,
    // Schnitt falsch". So bleiben Vorschau und Ergebnis garantiert dieselbe Variante.
    const introRes = await fetch(introUrl, { cache: "no-store" });
    if (!introRes.ok) throw new Error(`Intro-Download fehlgeschlagen (${introRes.status})`);
    await ff.writeFile("intro.mp4", new Uint8Array(await introRes.arrayBuffer()));
    await ff.writeFile("clip_in", await fetchFile(clip));
    onProgress?.("intro", 100);

    // Hat der Clip überhaupt eine Tonspur? Wenn NICHT, muss clip.mp4 trotzdem eine (stumme)
    // bekommen - sonst hat der Clip nur Video, das Intro aber Video+Ton, und der stream-copy-
    // concat unten scheitert an der unterschiedlichen Stream-Struktur (häufig: Bildschirm-
    // aufnahmen, stumm exportierte Clips). Stream-Info aus dem ffmpeg-Log lesen (ein Aufruf
    // ohne Ausgabe loggt sie und "scheitert" harmlos).
    let clipHasAudio = false;
    {
      let probe = "";
      const onProbe = (e: { message: string }) => {
        probe += e.message + "\n";
      };
      ff.on("log", onProbe);
      await ff.exec(["-i", "clip_in"]).catch(() => {});
      ff.off("log", onProbe);
      clipHasAudio = /Stream #\d+:\d+.*Audio:/i.test(probe);
    }

    // User-Clip auf das Intro-Format bringen: mittig auf 1080x1920 füllen (increase+crop),
    // 30fps, yuv420p, auf die ersten Sekunden getrimmt. Ton auf die Intro-Parameter bringen -
    // oder, wenn der Clip keinen hat, eine stumme Stereo-Spur erzeugen (anullsrc).
    onProgress?.("clip", 0);
    const onProg = (e: { progress: number }) =>
      onProgress?.("clip", Math.max(0, Math.min(100, Math.round(e.progress * 100))));
    ff.on("progress", onProg);
    try {
      const vf = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},fps=30,format=yuv420p`;
      const enc = [
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
        "-movflags", "+faststart", "clip.mp4",
      ];
      const args = clipHasAudio
        ? ["-ss", String(startSec), "-t", String(CLIP_SECONDS), "-i", "clip_in", ...enc]
        : [
            "-ss", String(startSec), "-t", String(CLIP_SECONDS), "-i", "clip_in",
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-map", "0:v:0", "-map", "1:a:0", "-shortest", ...enc,
          ];
      await ff.exec(args);
    } finally {
      ff.off("progress", onProg);
    }

    // Intro + Clip OHNE Neukodierung aneinanderhängen (beide gleiche Parameter, stumm).
    onProgress?.("merge", 0);
    await ff.writeFile("list.txt", "file 'intro.mp4'\nfile 'clip.mp4'\n");
    await ff.exec([
      "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-c", "copy", "-movflags", "+faststart", "out.mp4",
    ]);
    onProgress?.("merge", 100);

    const data = (await ff.readFile("out.mp4")) as Uint8Array;
    onProgress?.("done", 100);
    return new Blob([data as unknown as BlobPart], { type: "video/mp4" });
  } finally {
    await cleanup();
  }
}
