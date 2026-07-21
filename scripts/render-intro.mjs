// Intro-Video-Renderer (Schicht A).
//
// Nimmt die versteckte 3D-Render-Route der App (/render/intro/<slug>) Frame für Frame
// mit Playwright auf und baut daraus mit ffmpeg ein 1080x1920-MP4. Läuft off-Vercel,
// selten (nur wenn sich eine Route ändert). Kein Dauer-Dienst.
//
// Voraussetzungen:
//   - Dev-Server (oder Preview) läuft:            npm run dev
//   - ffmpeg im System:                           brew install ffmpeg
//   - Google Chrome installiert (oder CHROME_PATH gesetzt)
//
// Aufruf:
//   node scripts/render-intro.mjs <slug> [--out datei.mp4] [--seconds 10] [--fps 30]
//                                        [--base http://localhost:3000] [--headed]
//
// Env (optional): RENDER_BASE_URL, RENDER_SECRET, CHROME_PATH, FFMPEG_PATH

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- Argumente ----
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith("--"));
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const hasFlag = (name) => argv.includes(`--${name}`);

if (!slug) {
  console.error("Aufruf: node scripts/render-intro.mjs <slug> [--out …] [--seconds …] [--fps …]");
  process.exit(1);
}

const base = flag("base") || process.env.RENDER_BASE_URL || "http://localhost:3000";
const out = flag("out") || `intro-${slug}.mp4`;
const seconds = flag("seconds");
const fpsArg = flag("fps");
const width = Number(flag("width") || 1080);
const height = Number(flag("height") || 1920);
const headed = hasFlag("headed");
const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";

// ---- URL zusammenbauen ----
const url = new URL(`/render/intro/${slug}`, base);
if (process.env.RENDER_SECRET) url.searchParams.set("token", process.env.RENDER_SECRET);
if (seconds) url.searchParams.set("seconds", seconds);
if (fpsArg) url.searchParams.set("fps", fpsArg);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // Retina: halber Viewport bei deviceScaleFactor 2 -> scharfe Karten-Labels, exakt width×height.
  const scale = 2;
  const launchOpts = {
    headless: !headed,
    args: [
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
  };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  else launchOpts.channel = "chrome";

  const browser = await chromium.launch(launchOpts);
  const framesDir = await mkdtemp(join(tmpdir(), `intro-${slug}-`));
  try {
    const ctx = await browser.newContext({
      viewport: { width: Math.round(width / scale), height: Math.round(height / scale) },
      deviceScaleFactor: scale,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));

    console.log("-> lade", url.toString());
    const resp = await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    if (!resp || !resp.ok()) throw new Error(`Render-Seite antwortete ${resp && resp.status()}`);

    // Warten, bis die 3D-Karte samt Terrain steht.
    let ready = false;
    for (let i = 0; i < 60; i++) {
      ready = await page.evaluate(() => window.__introReady === true).catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error("Render-Karte wurde nicht bereit (kein __introReady).");

    const frameCount = await page.evaluate(() => window.__introFrameCount);
    const fps = await page.evaluate(() => window.__introFps);
    console.log(`-> ${frameCount} Frames @ ${fps} fps -> ${width}x${height}`);

    // Ab jetzt steuern wir; die Echtzeit-Vorschau der Seite stoppt.
    await page.evaluate(() => {
      window.__introDriven = true;
    });

    for (let i = 0; i < frameCount; i++) {
      await page.evaluate((n) => window.__introSeek(n), i);
      // Warten, bis Satelliten-/Relief-Kacheln geladen sind (mit Sicherheits-Timeout).
      await Promise.race([
        page.evaluate(() => window.__introWaitIdle()),
        sleep(8000),
      ]);
      await sleep(90); // kurz malen lassen
      const file = join(framesDir, `frame-${String(i + 1).padStart(5, "0")}.png`);
      await page.screenshot({ path: file, animations: "disabled" });
      if (i % 30 === 0 || i === frameCount - 1) {
        console.log(`   Frame ${i + 1}/${frameCount}`);
      }
    }

    await browser.close();

    // ---- Frames -> MP4 (H.264, exakt die Parameter, die Schicht B ohne Neukodierung anhängen kann) ----
    console.log("-> ffmpeg baut das MP4 …");
    await ffmpeg([
      "-y",
      "-framerate", String(fps),
      "-i", join(framesDir, "frame-%05d.png"),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-r", String(fps),
      out,
    ]);

    const s = await stat(out);
    console.log(`\nFertig: ${out}  (${(s.size / 1e6).toFixed(1)} MB)`);
  } finally {
    await rm(framesDir, { recursive: true, force: true }).catch(() => {});
    if (browser.isConnected()) await browser.close().catch(() => {});
  }
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", (e) =>
      reject(
        e.code === "ENOENT"
          ? new Error(`ffmpeg nicht gefunden (${ffmpegBin}). Installiere es mit: brew install ffmpeg`)
          : e,
      ),
    );
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg beendete mit Code ${code}`))));
  });
}

run().catch((e) => {
  console.error("\nFehler:", e.message);
  process.exit(1);
});
