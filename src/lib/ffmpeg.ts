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
    })().catch((err) => {
      // Fehlgeschlagenes Laden NICHT einfrieren: Ohne diesen Reset bliebe das abgelehnte
      // Promise für immer gecacht, und jeder spätere Versuch (Video-Upload, Story-Maker)
      // scheiterte bis zum Seiten-Reload – auch wenn nur kurz das Netz weg war.
      ffmpegLoading = null;
      throw err;
    });
  }
  return ffmpegLoading;
}

// EINE Arbeit zur Zeit im geteilten WASM-Dateisystem.
//
// Der Core ist ein Singleton mit EINEM Dateisystem. Zwei gleichzeitige Läufe (z. B. die
// beiden Erklärvideo-Slots DE/EN im Home-Media-Admin, oder Upload + Story-Maker)
// überschrieben sich vorher gegenseitig die Dateien: Lauf B schrieb sein Input über das
// von A, A lud dann stumm B's Video in seinen Slot hoch. Deshalb serialisiert dieser
// Mutex JEDE write->exec->read-Sequenz; der zweite Lauf wartet, statt zu kollidieren.
let ffmpegQueue: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(work: (ff: FFmpeg) => Promise<T>): Promise<T> {
  const run = ffmpegQueue.then(async () => work(await getFFmpeg()));
  // Kette am Leben halten, auch wenn dieser Lauf scheitert (sonst hinge der nächste).
  ffmpegQueue = run.catch(() => {});
  return run;
}
