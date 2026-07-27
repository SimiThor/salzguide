// Holt die Fotos und Videos der alten Seite und legt sie so im eigenen Bucket ab, wie es
// das Admin-Formular auch täte. Aufruf:
//   npm run wp:media -- --images         nur Fotos
//   npm run wp:media -- --videos         nur Videos
//   npm run wp:media -- --videos --limit 3   Stichprobe, um Grössen zu messen
//   npm run wp:media                     beides
//
// WIEDERAUFNEHMBAR. Jede fertige Datei steht sofort in .wp-cache/media-map.json, und was
// dort steht, wird übersprungen. Bei knapp 1 GB Download und 76 Video-Kodierungen ist ein
// Lauf, der nach einem Abbruch von vorn anfängt, praktisch unbenutzbar — und schlimmer: Er
// lädt dieselben Dateien ein zweites Mal in den Bucket, wo sie dann als Waisen liegen.
//
// WARUM ÜBERHAUPT NEU KODIEREN, die Dateien sind doch schon „compressed":
// Sie sind 1080x1920 h264, aber die Bitraten laufen von 2 bis 17,6 Mbit/s auseinander. Ein
// 35-MB-Clip als Autoplay-Hintergrund auf einer Bergtour-Detailseite ist auf Mobilfunk
// unbrauchbar. Die Parameter unten sind NICHT ausgedacht, sondern wörtlich die aus
// components/admin/VideoUploader.tsx: Jedes im Admin hochgeladene Video geht da durch.
// Ein Import, der daran vorbeigeht, legte Dateien ab, die sich anders verhalten als alle
// anderen, ohne dass irgendwo stünde warum.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const exec = promisify(execFile);

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WP_USER = process.env.WP_USER ?? "";
const WP_PASS = process.env.WP_APP_PASSWORD ?? "";
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");

const BUCKET = "spot-media";
const CACHE_DIR = ".wp-cache";
const SOURCE_DIR = join(CACHE_DIR, "source");
const MAP_FILE = join(CACHE_DIR, "media-map.json");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

// Wie src/lib/image-upload.ts: lange Kante 1600, WebP-Qualität 82. Der Wert dort ist 0.82,
// weil canvas.toBlob eine 0..1-Skala nimmt; sharp will 0..100. Gleiche Qualität, andere Einheit.
const IMAGE_MAX_DIM = 1600;
const IMAGE_QUALITY = 82;
// Ein Jahr, wie IMMUTABLE_CACHE_SECONDS: Jeder Upload bekommt einen frischen UUID-Pfad.
const CACHE_CONTROL = "31536000";

type MapEntry = {
  newUrl: string;
  width?: number;
  height?: number;
  posterUrl?: string;
  bytesBefore: number;
  bytesAfter: number;
};

const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// Die Karte wird nach JEDER Datei geschrieben, nicht am Ende. Ein Lauf, der nach 60 von 76
// Videos abbricht, darf die 60 fertigen nicht vergessen.
const map: Record<string, MapEntry> = existsSync(MAP_FILE)
  ? (JSON.parse(readFileSync(MAP_FILE, "utf8")) as Record<string, MapEntry>)
  : {};
const saveMap = () => writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));

async function download(url: string): Promise<Buffer> {
  const headers: Record<string, string> = {};
  // Die Mediathek ist öffentlich, aber die Anmeldung schadet nicht und deckt den Fall ab,
  // dass eine Datei doch geschützt ist.
  if (WP_USER && WP_PASS)
    headers.Authorization = "Basic " + Buffer.from(`${WP_USER}:${WP_PASS}`).toString("base64");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status < 500) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 2) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error("Download fehlgeschlagen");
}

async function upload(path: string, body: Buffer, contentType: string): Promise<string> {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: false, cacheControl: CACHE_CONTROL });
  if (error) throw new Error(`Upload ${path}: ${error.message}`);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ── Fotos ───────────────────────────────────────────────────────────────────

// .rotate() ist Pflicht und nicht Kosmetik: Ohne das legt sharp die EXIF-Orientierung
// still ab, und iPhone-Hochformat-Fotos lägen quer im Bucket. image-upload.ts macht
// dasselbe (dort über loadOrientedBitmap, aus demselben Grund).
async function doImage(url: string): Promise<MapEntry> {
  const src = await download(url);
  const out = await sharp(src)
    .rotate()
    .resize({ width: IMAGE_MAX_DIM, height: IMAGE_MAX_DIM, fit: "inside", withoutEnlargement: true })
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();
  const meta = await sharp(out).metadata();
  // Spot-Fotos liegen im Bucket-Wurzelverzeichnis, wie PhotoUploader sie ablegt
  // (uploadImage ohne Ordner). Ein eigener Ordner sähe ordentlicher aus, aber dann lägen
  // die importierten Fotos woanders als alle künftigen.
  const newUrl = await upload(`${randomUUID()}.webp`, out, "image/webp");
  return { newUrl, width: meta.width, height: meta.height, bytesBefore: src.length, bytesAfter: out.length };
}

// ── Videos ──────────────────────────────────────────────────────────────────

// Wörtlich die Parameter aus components/admin/VideoUploader.tsx. Wer sie hier ändert,
// erzeugt Dateien, die sich anders verhalten als jedes im Admin hochgeladene Video.
const VIDEO_ARGS = [
  "-vf", "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "28",
  "-c:a", "aac",
  "-b:a", "96k",
  "-movflags", "+faststart",
];

async function doVideo(url: string): Promise<MapEntry> {
  const src = await download(url);
  const dir = mkdtempish();
  const inFile = join(dir, "in.mp4");
  const outFile = join(dir, "out.mp4");
  // .png und nicht .webp: ffmpeg wählt den Encoder nach der ENDUNG, und mit .webp landet
  // es wieder beim fehlenden WebP-Encoder. Das Zwischenbild ist ohnehin nur ein Puffer.
  const posterFile = join(dir, "poster.png");
  writeFileSync(inFile, src);

  await exec(FFMPEG, ["-y", "-i", inFile, ...VIDEO_ARGS, outFile], { maxBuffer: 64 * 1024 * 1024 });
  const out = readFileSync(outFile);
  if (out.length < 1024) throw new Error("ffmpeg lieferte eine leere Datei");

  // Standbild aus dem FERTIGEN Video, nicht aus dem Original: Sonst passt das Poster in
  // Auflösung und Bildausschnitt nicht zu dem, was danach abspielt.
  //
  // ffmpeg zieht nur das Einzelbild, die WebP-Umwandlung macht sharp. Direkt nach .webp zu
  // kodieren ging hier schief: „Default encoder for format webp is probably disabled" —
  // der WebP-Encoder ist in ffmpeg optional und in diesem Build nicht dabei. sharp kann es
  // immer, es ist ohnehin Projekt-Abhängigkeit, und damit hängt der Import nicht daran, wie
  // jemandes ffmpeg übersetzt wurde.
  await exec(FFMPEG, ["-y", "-i", outFile, "-frames:v", "1", posterFile]);
  const poster = await sharp(readFileSync(posterFile)).webp({ quality: IMAGE_QUALITY }).toBuffer();
  const posterUrl = await upload(`spots/${randomUUID()}.webp`, poster, "image/webp");

  const newUrl = await upload(`spots/video-${randomUUID()}.mp4`, out, "video/mp4");
  return { newUrl, posterUrl, bytesBefore: src.length, bytesAfter: out.length };
}

function mkdtempish(): string {
  const d = join(tmpdir(), `sg-media-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

// ── Lauf ────────────────────────────────────────────────────────────────────

const mb = (n: number) => (n / 1048576).toFixed(1);

async function main() {
  const args = process.argv.slice(2);
  const onlyImages = args.includes("--images");
  const onlyVideos = args.includes("--videos");
  const doImages = onlyImages || !onlyVideos;
  const doVideos = onlyVideos || !onlyImages;
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  const images: string[] = [];
  const videos: string[] = [];
  for (const f of readdirSync(SOURCE_DIR)) {
    const d = JSON.parse(readFileSync(join(SOURCE_DIR, f), "utf8")) as {
      media: { images: { url: string }[]; videos: { url: string }[] };
    };
    for (const i of d.media.images) if (!images.includes(i.url)) images.push(i.url);
    for (const v of d.media.videos) if (!videos.includes(v.url)) videos.push(v.url);
  }

  const todo: { url: string; kind: "image" | "video" }[] = [
    ...(doImages ? images.map((url) => ({ url, kind: "image" as const })) : []),
    ...(doVideos ? videos.map((url) => ({ url, kind: "video" as const })) : []),
  ]
    .filter((t) => !map[t.url])
    .slice(0, limit);

  console.log(`${images.length} Fotos, ${videos.length} Videos bekannt.`);
  console.log(`${Object.keys(map).length} schon erledigt, ${todo.length} zu tun.\n`);
  if (!todo.length) return;

  let before = 0;
  let after = 0;
  let failed = 0;
  let n = 0;

  // Fotos vertragen Nebenläufigkeit, Videos nicht: libx264 nimmt sich ohnehin alle Kerne,
  // und drei Kodierungen parallel machen das Ganze langsamer, nicht schneller.
  const lanes = doVideos && !doImages ? 1 : 4;
  async function worker() {
    for (;;) {
      const job = todo[n++];
      if (!job) return;
      const label = job.url.split("/").pop() ?? job.url;
      try {
        const entry = job.kind === "image" ? await doImage(job.url) : await doVideo(job.url);
        map[job.url] = entry;
        saveMap();
        before += entry.bytesBefore;
        after += entry.bytesAfter;
        console.log(
          `  ok  ${label.slice(0, 46).padEnd(46)} ${mb(entry.bytesBefore).padStart(6)} MB -> ${mb(entry.bytesAfter).padStart(6)} MB`,
        );
      } catch (err) {
        failed++;
        console.log(`  FEHLER ${label.slice(0, 44)}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => worker()));

  console.log("");
  console.log(`${todo.length - failed} übernommen, ${failed} fehlgeschlagen.`);
  console.log(`${mb(before)} MB -> ${mb(after)} MB (${before ? Math.round((1 - after / before) * 100) : 0} % kleiner)`);
  console.log(`Karte: ${MAP_FILE}`);
}

main().catch((err) => {
  console.error("\nFEHLER:", err instanceof Error ? err.message : err);
  process.exit(1);
});
