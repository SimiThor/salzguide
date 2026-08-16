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
import { mkdtemp, rm, stat, readFile, copyFile, writeFile } from "node:fs/promises";
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
  console.error("Aufruf: npm run render:intro -- <slug> [--out …] [--seconds …] [--fps …] [--clean] [--upload]");
  process.exit(1);
}

const base = flag("base") || ENV.RENDER_BASE_URL || "http://localhost:3000";
const out = flag("out") || `intro-${slug}.mp4`;
const cleanOut = out.replace(/\.mp4$/i, "-clean.mp4"); // saubere Variante ohne Text-Overlay
const previewOut = out.replace(/\.mp4$/i, "-preview.mp4"); // 720p für die Story-Section
const seconds = flag("seconds");
const fpsArg = flag("fps");
const width = Number(flag("width") || 1080);
const height = Number(flag("height") || 1920);
const headed = hasFlag("headed");
const doUpload = hasFlag("upload");
// Clean-Fassung (ohne Text-Overlay) nur auf ausdrücklichen Wunsch bauen; siehe Kommentar
// am Clean-Block unten. --upload lädt sie NIE hoch.
const withClean = hasFlag("clean");
const ffmpegBin = ENV.FFMPEG_PATH || "ffmpeg";

const url = new URL(`/render/intro/${slug}`, base);
if (ENV.RENDER_SECRET) url.searchParams.set("token", ENV.RENDER_SECRET);
if (seconds) url.searchParams.set("seconds", seconds);
if (fpsArg) url.searchParams.set("fps", fpsArg);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Render-Status best-effort in die spots-Zeile schreiben (rendering/idle/error). Nur im
// --upload-Betrieb (Supabase-Keys da). Fehler hier dürfen den Render NIE abbrechen - der
// Status ist Komfort, das Video ist die Hauptsache; fehlt Migration 0049, wird still ignoriert.
async function writeRenderStatus(
  s: string,
  status: string,
  errorMsg?: string,
  // Nur schreiben, wenn noch kein Fehler dasteht. Der Auffang-Schritt des Workflows kennt
  // nur "irgendwie abgebrochen"; hat das Skript vorher den echten Grund hinterlassen, wäre
  // sein Überschreiben ein Rückschritt (genau das ist beim ersten Einsatz passiert).
  keepExistingError = false,
) {
  const supaUrl = ENV.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return;
  try {
    const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
    const patch: Record<string, unknown> = {
      intro_render_status: status,
      intro_render_error: errorMsg ?? null,
    };
    if (status === "rendering") patch.intro_render_started_at = new Date().toISOString();
    const q = supabase.from("spots").update(patch).eq("slug", s);
    await (keepExistingError ? q.neq("intro_render_status", "error") : q);
  } catch {
    // Best-effort: Status darf nie den Render kippen.
  }
}

async function run() {
  if (doUpload && slug) await writeRenderStatus(slug, "rendering");
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
  const cleanDir = await mkdtemp(join(tmpdir(), `intro-${slug}-clean-`));
  try {
    const ctx = await browser.newContext({
      viewport: { width: Math.round(width / scale), height: Math.round(height / scale) },
      deviceScaleFactor: scale,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
    // Ohne das ist ein Fehlschlag auf dem Runner nicht nachvollziehbar: Man sieht nur, dass
    // die Karte nicht bereit wurde, aber nicht, ob Kacheln, Skripte oder die Seite fehlten.
    const netFails = new Map<string, number>();
    const noteFail = (why: string, url: string) => {
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return url.slice(0, 40);
        }
      })();
      const k = `${why} ${host}`;
      netFails.set(k, (netFails.get(k) ?? 0) + 1);
    };
    page.on("requestfailed", (r) => noteFail(r.failure()?.errorText ?? "fehlgeschlagen", r.url()));
    page.on("response", (r) => {
      if (r.status() >= 400) noteFail(`HTTP ${r.status()}`, r.url());
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.error("KONSOLE:", m.text().slice(0, 200));
    });
    const netReport = () =>
      netFails.size
        ? `\n  Fehlgeschlagene Requests:\n${[...netFails].map(([k, n]) => `    ${n}x ${k}`).join("\n")}`
        : "\n  Fehlgeschlagene Requests: keine";

    console.log("-> lade", url.toString());
    const resp = await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    if (!resp || !resp.ok()) throw new Error(`Render-Seite antwortete ${resp && resp.status()}`);

    // Bis zu 2 Minuten: Der Runner hat keine GPU und muss vorher die Kacheln der ganzen
    // Route ziehen; die alten 30s waren an einem langsamen Tag zu knapp. Meldet die Seite
    // vorher einen Grund (__introError), sofort damit abbrechen statt blind weiterzuwarten.
    let ready = false;
    let pageErr: string | undefined;
    for (let i = 0; i < 240; i++) {
      const st = await page
        .evaluate(() => ({ ready: window.__introReady === true, err: window.__introError }))
        .catch(() => ({ ready: false, err: undefined }));
      if (st.err) {
        pageErr = st.err;
        break;
      }
      if (st.ready) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (pageErr) throw new Error(`Render-Seite meldet: ${pageErr}${netReport()}`);
    if (!ready) {
      throw new Error(`Render-Karte wurde in 120s nicht bereit (kein __introReady).${netReport()}`);
    }

    const frameCount = (await page.evaluate(() => window.__introFrameCount)) as number;
    const fps = (await page.evaluate(() => window.__introFps)) as number;
    console.log(`-> ${frameCount} Frames @ ${fps} fps -> ${width}x${height}`);

    await page.evaluate(() => {
      window.__introDriven = true;
    });

    let shotsTaken = 0; // zur Kontrolle, wie viel der gesparte Zweitschuss wirklich bringt
    for (let i = 0; i < frameCount; i++) {
      await page.evaluate((n) => window.__introSeek!(n), i);
      await Promise.race([page.evaluate(() => window.__introWaitIdle!()), sleep(8000)]);
      await sleep(90);
      const name = `frame-${String(i + 1).padStart(5, "0")}.png`;
      // Zwei Varianten in EINEM Durchlauf (Kamera/Kacheln nur einmal berechnet): normal MIT
      // Titelkarte, dann Karte kurz ausblenden -> sauberes Bild ohne Text-Overlay.
      // Solange die Karte durchsichtig ist, wären beide Bilder identisch: einmal schießen,
      // einmal kopieren. Screenshots sind der teuerste Teil des Laufs; gemessen sind es 393
      // statt 600, also ein Drittel weniger. Fehlt der Hook (ältere Seite), bleibt es beim
      // alten Weg mit zwei Aufnahmen.
      const cardVisible = await page
        .evaluate(() => window.__introCardVisible?.() ?? true)
        .catch(() => true);
      if (cardVisible) {
        shotsTaken += 2;
        await page.evaluate(() => window.__introSetCard!(true));
        await page.screenshot({ path: join(framesDir, name), animations: "disabled" });
        await page.evaluate(() => window.__introSetCard!(false));
        await page.screenshot({ path: join(cleanDir, name), animations: "disabled" });
      } else {
        shotsTaken += 1;
        await page.evaluate(() => window.__introSetCard!(false));
        await page.screenshot({ path: join(cleanDir, name), animations: "disabled" });
        await copyFile(join(cleanDir, name), join(framesDir, name));
      }
      if (i % 30 === 0 || i === frameCount - 1) console.log(`   Frame ${i + 1}/${frameCount}`);
    }

    console.log(
      `-> ${shotsTaken} Screenshots statt ${frameCount * 2} (Titelkarte nur am Schluss sichtbar).`,
    );

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

    // ---- Vorschau-Fassung (720p, ohne Ton): das, was die Story-Section wirklich lädt ----
    // Das Hintergrund-Autoplay zeigt nur einen 16:10-Anschnitt in Kartenbreite; 1080p dafür
    // auszuliefern kostete 5,1 MB Supabase-Egress PRO SEITENANSICHT. 720p/CRF 27 sind
    // 1,9 MB bei optisch gleichem Ergebnis hinter Scrim und Anschnitt (gemessen 10.08.2026,
    // Aignerpark). Die volle Fassung lädt nur noch der Story-Schnitt (StoryVideoPanel).
    // Ohne Tonspur: Das Autoplay ist stumm, und anders als beim Haupt-MP4 hängt hier kein
    // Schnitt eine Tonspur an. Aus den PNG-Frames statt aus dem MP4: keine zweite
    // Kodier-Generation.
    console.log("-> ffmpeg baut die Vorschau …");
    await ffmpeg([
      "-y",
      "-framerate", String(fps),
      "-i", join(framesDir, "frame-%05d.png"),
      "-vf", "scale=720:1280",
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "27",
      "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      "-r", String(fps),
      previewOut,
    ]);
    const sp = await stat(previewOut);
    console.log(`   Vorschau: ${previewOut}  (${(sp.size / 1e6).toFixed(1)} MB)`);

    // ---- Clean-Variante: dieselben Frames OHNE Text-Overlay, für die eigene Videoproduktion.
    // Zum Weiterschneiden, ohne Tonspur (der Schnitt bringt eigenen Ton).
    //
    // NUR mit --clean, und sie wird nie in den Storage geladen: Clean ist reines Rohmaterial
    // für eigene Werbevideos und deterministisch aus Route + INTRO_STYLE_VERSION neu
    // erzeugbar. Dauerhaft gespeichert war sie mit 551 MB der grösste Posten im Supabase-
    // Storage (Entscheidung 10.08.2026: Bestand gelöscht). Der Abruf-Weg ist der Workflow
    // export-intro-clean.yml: rendert mit --clean und hängt die Datei als GitHub-Artefakt
    // an den Lauf (verfällt dort von selbst).
    // CRF 23 statt 18: halbe Datei bei gemessen gleicher Optik (SSIM 0,984 am
    // Aignerpark-Intro, 10,6 -> 5,8 MB).
    if (withClean) {
      console.log("-> ffmpeg baut das Clean-MP4 …");
      await ffmpeg([
        "-y",
        "-framerate", String(fps),
        "-i", join(cleanDir, "frame-%05d.png"),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-r", String(fps),
        cleanOut,
      ]);
      const sc = await stat(cleanOut);
      console.log(`   Clean-MP4: ${cleanOut}  (${(sc.size / 1e6).toFixed(1)} MB)`);
    }

    // ---- Poster (WebP): der ERSTE Frame, nichts anderes ----
    // Das Poster liegt im StoryMaker unter dem Video, das bei Frame 1 startet. Ein Poster
    // aus der Mitte (früher 72%) hiess: Standbild vom Berg, dann springt das Video zurück
    // zum Start. Ein harter Schnitt, jedes Mal. Frame 1 zeigt genau das, was der erste
    // Videoframe zeigt, also fällt der Wechsel gar nicht auf.
    //
    // Aus framesDir, nicht cleanDir: Das Poster gehört zum Video, das wirklich läuft. Bei
    // Frame 1 sind beide ohnehin Pixel für Pixel gleich (die Titelkarte blendet erst am
    // Schluss ein), aber der Bezug soll im Code stimmen und nicht zufällig aufgehen.
    //
    // Dieselbe Regel wie bei hochgeladenen Videos: VideoUploader.makePoster() greift den
    // Anfang ab (0,1 s). Zwei Wege zum Standbild wären zwei Wege, es falsch zu machen.
    const posterPng = join(framesDir, `frame-00001.png`);
    const posterWebp = await sharp(posterPng)
      .resize({ width: 720, height: 1280, fit: "inside" })
      .webp({ quality: 80 })
      .toBuffer();

    if (doUpload) {
      await upload(slug!, out, previewOut, posterWebp);
      await writeRenderStatus(slug!, "idle");
    } else {
      // Auch lokal schreiben: Sonst entsteht das Poster zwar, ist aber nirgends anzusehen,
      // und man kann vor dem Hochladen nicht prüfen, ob es zum ersten Videoframe passt.
      const posterOut = out.replace(/\.mp4$/i, ".webp");
      await writeFile(posterOut, posterWebp);
      console.log(`   Poster: ${posterOut}  (${(posterWebp.length / 1e3).toFixed(0)} kB)`);
      console.log(
        `\nFertig (lokal${withClean ? ", inkl. Clean" : ""}). Mit --upload landet Video + Poster in spot-media + der DB (Clean nie).`,
      );
    }
  } finally {
    await rm(framesDir, { recursive: true, force: true }).catch(() => {});
    await rm(cleanDir, { recursive: true, force: true }).catch(() => {});
    if (browser.isConnected()) await browser.close().catch(() => {});
  }
}

async function upload(slug: string, mp4Path: string, previewPath: string, posterWebp: Buffer) {
  const supaUrl = ENV.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = ENV.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local (für --upload).");
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: spot, error: selErr } = await supabase
    .from("spots")
    .select("id, route_geojson, duration")
    .eq("slug", slug)
    .maybeSingle();
  if (selErr) throw new Error(`Spot laden fehlgeschlagen: ${selErr.message}`);
  if (!spot) throw new Error(`Kein Spot mit slug "${slug}".`);

  const hash = introSourceHash(spot.route_geojson, spot.duration as string | null);
  const mp4Path2 = `intro/${slug}-${hash}.mp4`;
  // Dateiname MUSS zur Ableitung in lib/spots.ts passen (introVideoPreviewUrl wird per
  // String-Ersetzung aus intro_video_url gebildet, es gibt keine eigene DB-Spalte).
  const previewPath2 = `intro/${slug}-${hash}-preview.mp4`;
  const posterPath = `intro/${slug}-${hash}.webp`;

  console.log("-> lade Video + Vorschau + Poster nach spot-media …");
  // ACHTUNG: Dies ist die EINZIGE Stelle im Projekt mit festem Pfad + upsert:true +
  // Jahres-Cache (src/lib/storage.ts warnt genau davor). Sicher NUR, weil der Hash im
  // Namen Route + INTRO_STYLE_VERSION einschliesst: Jede OPTIK-Änderung (Titel, Overlay,
  // Kamera) MUSS die Version hochzählen, sonst liefert der Cache ein Jahr lang das alte
  // Video unter demselben Namen aus (siehe lib/intro-hash.ts).
  const upV = await supabase.storage
    .from(BUCKET)
    .upload(mp4Path2, await readFile(mp4Path), { contentType: "video/mp4", upsert: true, cacheControl: IMMUTABLE });
  if (upV.error) throw new Error(`Video-Upload fehlgeschlagen: ${upV.error.message}`);
  const upPre = await supabase.storage
    .from(BUCKET)
    .upload(previewPath2, await readFile(previewPath), { contentType: "video/mp4", upsert: true, cacheControl: IMMUTABLE });
  if (upPre.error) throw new Error(`Vorschau-Upload fehlgeschlagen: ${upPre.error.message}`);
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
      // Clean wird nicht mehr gespeichert (Abruf über export-intro-clean.yml). null statt
      // "stehen lassen": Ein alter Wert zeigte auf eine Datei, die es nicht mehr gibt.
      intro_video_clean_url: null,
      intro_video_poster_url: posterUrl,
      intro_source_hash: hash,
    })
    .eq("id", spot.id);
  if (upd.error) {
    if (/column .* does not exist/i.test(upd.error.message)) {
      throw new Error("Spalten fehlen. Wende zuerst die Migrationen 0047 + 0048 in Supabase an.");
    }
    throw new Error(`DB-Update fehlgeschlagen: ${upd.error.message}`);
  }

  console.log(
    `\nFertig & gespeichert:\n  Video:  ${videoUrl}\n  Poster: ${posterUrl}\n  Hash:   ${hash}`,
  );

  // ---- Aufräumen: alte Intro-Dateien dieses Spots löschen ----
  // Nach jedem Versions-/Routenwechsel bekommt der Spot neue <slug>-<hash>.* Dateien; die
  // alten würden sonst für immer im Bucket liegen bleiben (nach mehreren Iterationen schnell
  // Hunderte MB). Wir listen intro/ und löschen alles, was mit `<slug>-` beginnt, aber NICHT
  // zu den zwei gerade hochgeladenen Dateien gehört; auch eine liegengebliebene Clean-Datei
  // fällt so automatisch weg. Fehlschläge hier sind unkritisch (Video ist schon
  // gespeichert), daher nur geloggt, nie geworfen.
  try {
    const keep = new Set([`${slug}-${hash}.mp4`, `${slug}-${hash}-preview.mp4`, `${slug}-${hash}.webp`]);
    const { data: existing } = await supabase.storage.from(BUCKET).list("intro", { limit: 1000 });
    const stale = (existing ?? [])
      .filter((f) => f.name.startsWith(`${slug}-`) && !keep.has(f.name))
      .map((f) => `intro/${f.name}`);
    if (stale.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(stale);
      if (rmErr) console.warn(`  (Aufräumen übersprungen: ${rmErr.message})`);
      else console.log(`  Aufgeräumt: ${stale.length} alte Datei(en) dieses Spots gelöscht.`);
    }
  } catch (e) {
    console.warn(`  (Aufräumen übersprungen: ${(e as Error).message})`);
  }
}

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpegBin, args, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", (e: NodeJS.ErrnoException) =>
      reject(
        e.code === "ENOENT"
          ? // Diese Meldung landet über den Render-Status auch im Admin. Dort ist ein
            // brew-Befehl nutzlos, deshalb beide Fälle nennen.
            new Error(
              `ffmpeg nicht gefunden (${ffmpegBin}). Lokal: brew install ffmpeg. Auf dem Runner erledigt das der Schritt „ffmpeg installieren" im Workflow.`,
            )
          : e,
      ),
    );
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg beendete mit Code ${code}`))));
  });
}

// --report-failure "<Meldung>": rendert nichts, schreibt nur den Fehler in die spots-Zeile.
// Ruft der Workflow nach einem harten Abbruch auf (Zeitlimit, Runner tot) - dann stirbt der
// Render-Prozess ohne catch und der Status bliebe sonst auf 'rendering' stehen.
if (hasFlag("report-failure")) {
  const msg = flag("report-failure") || "Render abgebrochen (Zeitlimit oder Runner-Fehler).";
  writeRenderStatus(slug!, "error", msg, true).then(() => {
    console.log(`-> Status von "${slug}" auf 'error' gesetzt (falls noch keiner dastand): ${msg}`);
  });
} else {
  run().catch(async (e) => {
    console.error("\nFehler:", e.message);
    if (doUpload && slug) await writeRenderStatus(slug, "error", e.message);
    process.exit(1);
  });
}
