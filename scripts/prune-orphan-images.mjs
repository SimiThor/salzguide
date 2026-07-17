// Einmal-Aufräumen: löscht die grossen Nicht-WebP-Bilder, auf die KEINE DB-Zeile mehr
// zeigt. Das sind die Alt-Kopien, die recompress-storage.mjs bewusst liegen liess (zur
// Umkehrbarkeit), plus vereinzelte verwaiste Uploads aus der Zeit davor.
//
// Sicher, weil das Löschkriterium die Referenz selbst ist: Erst wird JEDE bekannte
// Bild-Spalte gelesen; nur was dort NIRGENDS vorkommt (und kein WebP, und gross) wird
// gelöscht. Ein noch benutztes Bild kann so nicht erwischt werden.
//
//   node scripts/prune-orphan-images.mjs            # Trockenlauf
//   node scripts/prune-orphan-images.mjs --apply    # löscht wirklich
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) throw new Error("Supabase-Env fehlt.");
const H = { apikey: K, Authorization: `Bearer ${K}` };
const JH = { ...H, "Content-Type": "application/json" };
const PUB = `${U}/storage/v1/object/public/spot-media/`;
const OVERSIZE = 400 * 1024;

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

// Jede referenzierte spot-media-URL einsammeln (dieselbe Menge wie in recompress-storage.mjs).
const referenced = new Set();
const noteUrl = (url) => { if (typeof url === "string" && url.startsWith(PUB)) referenced.add(decodeURIComponent(url.slice(PUB.length).split("?")[0])); };
for (const m of await sel("media", "url,poster_url")) { noteUrl(m.url); noteUrl(m.poster_url); }
for (const e of await sel("events", "image_url")) noteUrl(e.image_url);
for (const t of await sel("tours", "cover_url")) noteUrl(t.cover_url);
for (const a of await sel("tour_areas", "cover_url")) noteUrl(a.cover_url);
for (const p of await sel("tour_points", "image_url")) noteUrl(p.image_url);
for (const l of await sel("locals", "avatar_url")) noteUrl(l.avatar_url);
for (const s of await sel("app_settings", "key,value")) if (s.key === "toni_avatar_url") noteUrl(s.value);
for (const hc of await sel("home_content", "media")) {
  const m = hc.media || {};
  for (const slot of ["heroPortrait", "heroLandscape", "antonPhoto", "simonPhoto"]) noteUrl(m[slot]?.src);
  noteUrl(m.explainerVideo?.poster);
}

const objects = await walk();
// Verwaist = kein WebP, gross, nirgends referenziert. previews/ sind echte kleine WebP -> nie betroffen.
const victims = objects.filter((o) => String(o.mime).startsWith("image/") && o.mime !== "image/webp" && o.size > OVERSIZE && !referenced.has(o.path));

console.log(`${APPLY ? "LÖSCHLAUF" : "TROCKENLAUF"} — ${referenced.size} referenzierte Bilder geschützt.`);
console.log(`Verwaiste grosse Nicht-WebP-Bilder: ${victims.length}\n`);
let freed = 0;
for (const v of victims) { freed += v.size; console.log(`  ${String(Math.round(v.size / 1024)).padStart(5)}KB  ${v.mime.padEnd(10)} ${v.path}`); }
console.log(`\nFreigabe: ${(freed / 1048576).toFixed(1)} MB`);

if (!APPLY) { console.log(`\nZum echten Löschen:  node scripts/prune-orphan-images.mjs --apply`); process.exit(0); }
if (!victims.length) process.exit(0);

// In Blöcken löschen (Storage-API nimmt eine Pfad-Liste).
let deleted = 0;
for (let i = 0; i < victims.length; i += 50) {
  const batch = victims.slice(i, i + 50).map((v) => v.path);
  const r = await fetch(`${U}/storage/v1/object/spot-media`, { method: "DELETE", headers: JH, body: JSON.stringify({ prefixes: batch }) });
  if (!r.ok) throw new Error(`DELETE: ${r.status} ${await r.text()}`);
  deleted += batch.length;
}
console.log(`\n${deleted} Objekte gelöscht, ${(freed / 1048576).toFixed(1)} MB frei.`);
