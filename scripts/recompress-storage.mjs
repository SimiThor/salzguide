// Einmal-Migration: rechnet die bestehenden Storage-Bilder zu echtem WebP um.
//
// Hintergrund: Bis image-upload.ts das Ergebnis von canvas.toBlob prüfte, lag im Bucket
// PNG unter dem Namen .webp - im Schnitt dreissigmal so schwer wie nötig. Dieses Skript
// holt jedes noch grosse Nicht-WebP-Bild, rechnet es mit sharp herunter und legt es unter
// NEUEM Pfad ab. Die alte Datei bleibt liegen: nichts kann ins Leere zeigen, und ein
// Fehlgriff ist umkehrbar (rollback-*.json im scratchpad, bzw. neben dem Skript).
//
// Aufruf:
//   node scripts/recompress-storage.mjs            # Trockenlauf, ändert nichts
//   node scripts/recompress-storage.mjs --apply    # schreibt wirklich
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { collectStorageRefs } from "./lib/storage-refs.mjs";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(".");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen.");
const H = { apikey: K, Authorization: `Bearer ${K}` };
const JH = { ...H, "Content-Type": "application/json" };
const PUB = `${U}/storage/v1/object/public/spot-media/`;

const QUALITY = 82;
const CAP = { hero: 2048, photo: 1600, avatar: 512 };
const IMMUTABLE = "31536000";

// ---- Storage auflisten ----
async function walk(prefix = "", depth = 0) {
  if (depth > 4) return [];
  const r = await fetch(`${U}/storage/v1/object/list/spot-media`, {
    method: "POST", headers: JH, body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } }),
  });
  const it = await r.json(); if (!Array.isArray(it)) return [];
  let o = [];
  for (const i of it) {
    if (i.id === null || !i.metadata) o = o.concat(await walk(prefix ? `${prefix}/${i.name}` : i.name, depth + 1));
    else o.push({ path: prefix ? `${prefix}/${i.name}` : i.name, size: i.metadata.size, mime: i.metadata.mimetype });
  }
  return o;
}

async function sel(table, cols) {
  const r = await fetch(`${U}/rest/v1/${table}?select=${cols}`, { headers: JH });
  const j = await r.json(); return Array.isArray(j) ? j : [];
}

const objects = await walk();
const byPath = new Map(objects.map((o) => [o.path, o]));
const pathOf = (url) => (typeof url === "string" && url.startsWith(PUB) ? decodeURIComponent(url.slice(PUB.length).split("?")[0]) : null);

// ---- Jede Referenz einsammeln, mit ihrer Ziel-Kantenlänge ----
// kind bestimmt die maximale Kante: Hero gross, Foto mittel, Avatar klein.
// Die Liste der URL-Spalten steht in lib/storage-refs.mjs und gilt auch für
// prune-orphan-images.mjs. Getrennt gepflegt fehlte beiden `spots.video_poster_url`.
const jobs = []; // { loc, kind, apply(newUrl,w,h), path, size }
for (const ref of await collectStorageRefs(sel, patch, patchHome)) {
  // kind "video" heisst: nur schützen, nie anfassen. Ohne diese Bremse würde das Skript
  // versuchen, eine MP4 in ein WebP umzurechnen.
  if (ref.kind === "video") continue;
  const p = pathOf(ref.url); if (!p) continue;
  const o = byPath.get(p);
  // Jedes Nicht-WebP wird umgerechnet, egal wie gross: Ein 361-KB-PNG-Avatar ist so gut
  // wie ein 7-MB-Foto ein Fall fürs Komprimieren. WebP ist schon fertig -> überspringen.
  // Zweiter Riegel gegen Nicht-Bilder, falls oben je eine Zeile ohne kind durchrutscht.
  if (!o || o.mime === "image/webp" || !String(o.mime).startsWith("image/")) continue;
  jobs.push({ loc: ref.loc, kind: ref.kind, path: p, size: o.size, apply: ref.apply });
}

// ---- Schreib-Helfer (nur bei --apply aktiv) ----
async function patch(table, where, body) {
  if (!APPLY) return;
  const r = await fetch(`${U}/rest/v1/${table}?${where}`, { method: "PATCH", headers: { ...JH, Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${table} ${where}: ${r.status} ${await r.text()}`);
}
// home_content getrennt, weil das ganze media-jsonb gelesen/geschrieben wird.
async function patchHome(id, field, url, w, h) {
  if (!APPLY) return;
  const rows = await sel("home_content", "id,media");
  const row = rows.find((x) => x.id === id); if (!row) throw new Error("home_content weg");
  const media = row.media || {};
  if (field === "explainerVideo.poster") {
    media.explainerVideo = { ...(media.explainerVideo || {}), poster: url };
  } else {
    media[field] = { ...(media[field] || {}), src: url, ...(w ? { width: w, height: h } : {}) };
  }
  await patch("home_content", `id=eq.${id}`, { media });
}

async function uploadNew(dir, buf) {
  const name = `${dir ? `${dir}/` : ""}${crypto.randomUUID()}.webp`;
  if (!APPLY) return PUB + name;
  const r = await fetch(`${U}/storage/v1/object/spot-media/${name}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "image/webp", "Cache-Control": `max-age=${IMMUTABLE}`, "x-upsert": "false" },
    body: buf,
  });
  if (!r.ok) throw new Error(`Upload ${name}: ${r.status} ${await r.text()}`);
  return PUB + name;
}

// ---- Lauf ----
console.log(`${APPLY ? "SCHREIBLAUF" : "TROCKENLAUF (nichts wird geändert)"} — ${jobs.length} Referenzen\n`);
const rollback = [];
let before = 0, after = 0, done = 0, failed = 0;

for (const job of jobs) {
  const cap = CAP[job.kind];
  try {
    const res = await fetch(PUB + job.path.split("/").map(encodeURIComponent).join("/"), { headers: H });
    if (!res.ok) throw new Error(`Download ${res.status}`);
    const src = Buffer.from(await res.arrayBuffer());
    const out = await sharp(src).rotate().resize({ width: cap, height: cap, fit: "inside", withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
    const meta = await sharp(out).metadata();
    const dir = job.path.includes("/") ? job.path.slice(0, job.path.lastIndexOf("/")) : "";
    const newUrl = await uploadNew(dir, out);
    await job.apply(newUrl, meta.width, meta.height);
    rollback.push({ loc: job.loc, oldPath: job.path, newUrl });
    before += job.size; after += out.length; done++;
    console.log(`  ✓ ${job.loc.padEnd(42)} ${String(Math.round(job.size / 1024)).padStart(5)}KB → ${String(Math.round(out.length / 1024)).padStart(4)}KB  (${meta.width}×${meta.height})`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${job.loc.padEnd(42)} FEHLER: ${e.message}`);
  }
}

console.log(`\n${done} umgerechnet, ${failed} Fehler.`);
console.log(`Bytes: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB  (−${before ? Math.round((1 - after / before) * 100) : 0}%)`);
if (APPLY && rollback.length) {
  const f = path.join(ROOT, `rollback-${done}-refs.json`);
  fs.writeFileSync(f, JSON.stringify(rollback, null, 2));
  console.log(`Rollback-Log: ${f}`);
} else if (!APPLY) {
  console.log(`\nZum echten Umrechnen:  node scripts/recompress-storage.mjs --apply`);
}
