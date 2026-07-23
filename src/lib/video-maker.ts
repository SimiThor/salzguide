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

    // User-Clip auf das Intro-Format bringen: mittig auf 1080x1920 füllen (increase+crop),
    // 30fps, yuv420p, stumm, auf die ersten Sekunden getrimmt.
    onProgress?.("clip", 0);
    const onProg = (e: { progress: number }) =>
      onProgress?.("clip", Math.max(0, Math.min(100, Math.round(e.progress * 100))));
    ff.on("progress", onProg);
    await ff.exec([
      "-ss", String(startSec),
      "-t", String(CLIP_SECONDS),
      "-i", "clip_in",
      "-vf",
      `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},fps=30,format=yuv420p`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      // Ton des User-Clips behalten, auf dieselben Parameter wie das (stumme) Intro bringen,
      // damit das Anhängen ohne Neukodierung klappt. Clips ohne Tonspur bleiben stumm.
      "-c:a", "aac",
      "-ar", "44100",
      "-ac", "2",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "clip.mp4",
    ]);
    ff.off("progress", onProg);

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
