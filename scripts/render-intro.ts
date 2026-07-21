// Intro-Video-Renderer (Schicht A).
//
// Nimmt die versteckte 3D-Render-Route der App (/render/intro/<slug>) Frame für Frame
// mit Playwright auf und baut daraus mit ffmpeg ein 1080x1920-MP4. Mit --upload landet
// das Video (+ WebP-Poster) im Bucket spot-media und die URL in der spots-Zeile. Läuft
// off-Vercel, selten (nur wenn sich eine Route ändert). Kein Dauer-Dienst.
//
// Voraussetzungen:
//   - Dev-Server (oder Preview) läuft:   npm run dev
//   - ffmpeg im System:                  brew install ffmpeg
//   - Google Chrome installiert (oder CHROME_PATH gesetzt)
//   - für --upload: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
//     und die Migration 0047 muss angewendet sein.
//
// Aufruf:
//   npm run render:intro -- <slug> [--out datei.mp4] [--seconds 10] [--fps 30]
//                                  [--base http://localhost:3000] [--headed] [--upload]

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { introSourceHash } from "../src/lib/intro-hash.ts";

const BUCKET = "spot-media";
const IMMUTABLE = "31536000"; // 1 Jahr; der Hash im Dateinamen macht die URL eindeutig

// ---- .env.local einlesen (gleiches Muster wie backfill-blur.ts), Shell-Env gewinnt ----
function loadDotEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}
const ENV = { ...loadDotEnv(), ...process.env } as Record<string, string | undefined>;

// ---- Argumente ----
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith("--"));
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const hasFlag = (name: string) => argv.includes(`--${name}`);

if (!slug) {
  console.error("Aufruf: npm run render:intro -- <slug> [--out …] [--seconds …] [--fps …] [--upload]");
  process.exit(1);
}

const base = flag("base") || ENV.RENDER_BASE_URL || "http://localhost:3000";
const out = flag("out") || `intro-${slug}.mp4`;
const seconds = flag("seconds");
const fpsArg = flag("fps");
const width = Number(flag("width") || 1080);
const height = Number(flag("height") || 1920);
const headed = hasFlag("headed");
const doUpload = hasFlag("upload");
const ffmpegBin = ENV.FFMPEG_PATH || "ffmpeg";

const url = new URL(`/render/intro/${slug}`, base);
if (ENV.RENDER_SECRET) url.searchParams.set("token", ENV.RENDER_SECRET);
if (seconds) url.searchParams.set("seconds", seconds);
if (fpsArg) url.searchParams.set("fps", fpsArg);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // Retina: halber Viewport bei deviceScaleFactor 2 -> scharfe Labels, exakt width×height.
  const scale = 2;
  const launchOpts: Parameters<typeof chromium.launch>[0] = {
    headless: !headed,
    args: [
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
  };
  if (ENV.CHROME_PATH) launchOpts.executablePath = ENV.CHROME_PATH;
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

    let ready = false;
    for (let i = 0; i < 60; i++) {
      ready = await page.evaluate(() => window.__introReady === true).catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error("Render-Karte wurde nicht bereit (kein __introReady).");

    const frameCount = (await page.evaluate(() => window.__introFrameCount)) as number;
    const fps = (await page.evaluate(() => window.__introFps)) as number;
    console.log(`-> ${frameCount} Frames @ ${fps} fps -> ${width}x${height}`);

    await page.evaluate(() => {
      window.__introDriven = true;
    });

    for (let i = 0; i < frameCount; i++) {
      await page.evaluate((n) => window.__introSeek!(n), i);
      await Promise.race([page.evaluate(() => window.__introWaitIdle!()), sleep(8000)]);
      await sleep(90);
      const file = join(framesDir, `frame-${String(i + 1).padStart(5, "0")}.png`);
      await page.screenshot({ path: file, animations: "disabled" });
      if (i % 30 === 0 || i === frameCount - 1) console.log(`   Frame ${i + 1}/${frameCount}`);
    }

    await browser.close();

    // ---- Frames -> MP4 (Parameter so, dass Schicht B ohne Neukodierung anhängen kann) ----
    console.log("-> ffmpeg baut das MP4 …");
    await ffmpeg([
      "-y",
      "-framerate", String(fps),
      "-i", join(framesDir, "frame-%05d.png"),
      // Stummer Stereo-Ton: Damit Schicht B den User-Clip (mit Ton) ohne Neukodierung
      // anhängen kann, müssen beide Teile dieselbe Stream-Struktur haben (Video + Audio).
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-c:v", "libx264",
      "-preset", "medium",
      // CRF 24 statt 20: ~35% kleinere Datei bei praktisch gleicher Optik. Das Intro läuft
      // als Autoplay-Hintergrund auf der Detailseite und wird in ffmpeg.wasm geladen, jede
      // gesparte MB zählt (Daten, Ladezeit, Handy-Speicher).
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      "-movflags", "+faststart",
      "-r", String(fps),
      out,
    ]);
    const s = await stat(out);
    console.log(`   MP4: ${out}  (${(s.size / 1e6).toFixed(1)} MB)`);

    // ---- Poster (WebP) aus einem Frame, in dem die Route gut sichtbar ist ----
    const posterFrame = Math.max(1, Math.round(frameCount * 0.72));
    const posterPng = join(framesDir, `frame-${String(posterFrame).padStart(5, "0")}.png`);
    const posterWebp = await sharp(posterPng)
      .resize({ width: 720, height: 1280, fit: "inside" })
      .webp({ quality: 80 })
      .toBuffer();

    if (doUpload) {
      await upload(slug!, out, posterWebp);
    } else {
      console.log("\nFertig (lokal). Mit --upload landet es in spot-media + der DB.");
    }
  } finally {
    await rm(framesDir, { recursive: true, force: true }).catch(() => {});
    if (browser.isConnected()) await browser.close().catch(() => {});
  }
}

async function upload(slug: string, mp4Path: string, posterWebp: Buffer) {
  const supaUrl = ENV.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local (für --upload).");
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: spot, error: selErr } = await supabase
    .from("spots")
    .select("id, route_geojson")
    .eq("slug", slug)
    .maybeSingle();
  if (selErr) throw new Error(`Spot laden fehlgeschlagen: ${selErr.message}`);
  if (!spot) throw new Error(`Kein Spot mit slug "${slug}".`);

  const hash = introSourceHash(spot.route_geojson);
  const mp4Path2 = `intro/${slug}-${hash}.mp4`;
  const posterPath = `intro/${slug}-${hash}.webp`;

  console.log("-> lade Video + Poster nach spot-media …");
  const mp4Buf = await readFile(mp4Path);
  const upV = await supabase.storage
    .from(BUCKET)
    .upload(mp4Path2, mp4Buf, { contentType: "video/mp4", upsert: true, cacheControl: IMMUTABLE });
  if (upV.error) throw new Error(`Video-Upload fehlgeschlagen: ${upV.error.message}`);
  const upP = await supabase.storage
    .from(BUCKET)
    .upload(posterPath, posterWebp, { contentType: "image/webp", upsert: true, cacheControl: IMMUTABLE });
  if (upP.error) throw new Error(`Poster-Upload fehlgeschlagen: ${upP.error.message}`);

  const videoUrl = supabase.storage.from(BUCKET).getPublicUrl(mp4Path2).data.publicUrl;
  const posterUrl = supabase.storage.from(BUCKET).getPublicUrl(posterPath).data.publicUrl;

  const upd = await supabase
    .from("spots")
    .update({
      intro_video_url: videoUrl,
      intro_video_poster_url: posterUrl,
      intro_source_hash: hash,
    })
    .eq("id", spot.id);
  if (upd.error) {
    if (/column .* does not exist/i.test(upd.error.message)) {
      throw new Error("Spalten fehlen. Wende zuerst die Migration 0047 in Supabase an.");
    }
    throw new Error(`DB-Update fehlgeschlagen: ${upd.error.message}`);
  }

  console.log(`\nFertig & gespeichert:\n  Video:  ${videoUrl}\n  Poster: ${posterUrl}\n  Hash:   ${hash}`);
}

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegBin, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", (e: NodeJS.ErrnoException) =>
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
