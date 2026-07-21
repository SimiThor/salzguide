import type { FFmpeg } from "@ffmpeg/ffmpeg";

// ffmpeg.wasm: einmal laden, dann app-weit wiederverwenden. Single-Thread, Core
// self-hosted unter /public/ffmpeg -> läuft in JEDEM Browser inkl. Safari, ohne
// COOP/COEP. Geteilt zwischen dem Admin-Video-Upload (VideoUploader) und dem
// Video-Maker (Schicht B): ein Lader für alles, damit der große Core nur einmal lädt.
let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (!ffmpegLoading) {
    ffmpegLoading = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ff = new FFmpeg();
      const base = "/ffmpeg";
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegSingleton = ff;
      return ff;
    })();
  }
  return ffmpegLoading;
}
