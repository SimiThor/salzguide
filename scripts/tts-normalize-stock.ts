// Bestand auf das Lautheits-Ziel bringen (lib/loudness.ts, -16 LUFS). Aufruf:
//   npm run tts:normalize-stock            misst nur und berichtet (Trockenlauf)
//   APPLY=1 npm run tts:normalize-stock    schreibt: neue Datei hochladen, Zeile umhaengen
//
// WARUM: Neue Aufnahmen kommen seit 09/2026 lautheitsgleich aus tts.ts. Der Bestand von
// vorher soll dazu passen, sonst springt die Lautstaerke zwischen alten und neuen Stopps.
// Gemessen am 15.09.2026 lag er bei -16,2 bis -16,4 LUFS, also innerhalb der Toleranz;
// dieses Skript ist der Beleg dafuer je Datei, und der Weg fuer die wenigen, die abweichen.
//
// Idempotent: Innerhalb der Toleranz wird nichts angefasst; angefasste Zeilen tragen im
// tts_profile das Ziel und werden beim naechsten Lauf uebersprungen. Ersetzte Objekte bleiben
// fuer den Waisen-Sweep liegen (nie synchron loeschen, siehe lib/tts-files.ts).
import { createClient } from "@supabase/supabase-js";
import { normalizeSpeechMp3, LOUDNESS_TARGET_LUFS } from "../src/lib/loudness.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Zugang fehlt in .env.local");
const db = createClient(SUPA_URL, SUPA_KEY);
const APPLY = process.env.APPLY === "1";
const BUCKET = "tour-audio";
const MARK = `lufs${LOUDNESS_TARGET_LUFS}`;

type Row = {
  id: string;
  point_id: string;
  lang: string;
  voice_id: string;
  audio_url: string | null;
  teaser_url: string | null;
  tts_profile: string | null;
};

const { data, error } = await db
  .from("tour_point_voice_files")
  .select("id, point_id, lang, voice_id, audio_url, teaser_url, tts_profile");
if (error) throw error;
const rows = (data ?? []) as Row[];
console.log(`${rows.length} Datei-Zeilen, ${APPLY ? "SCHREIBEND" : "Trockenlauf"}`);

let checked = 0, changed = 0, kept = 0, skipped = 0, failed = 0, missing = 0;
const lufs: number[] = [];
for (const r of rows) {
  if (r.tts_profile?.endsWith(MARK)) { skipped++; continue; }
  for (const col of ["audio_url", "teaser_url"] as const) {
    const path = r[col];
    if (!path) continue;
    const { data: file, error: dl } = await db.storage.from(BUCKET).download(path);
    if (dl || !file) {
      // Kein Fehler dieses Skripts: Die Datei ist im Bucket weg (Sweep-Vorfall vom 15.09.2026).
      // "Stimme pruefen" an der Runde findet sie als "Datei weg" und erzeugt sie neu.
      if (/not found/i.test(dl?.message ?? "")) { console.log(`  fehlt im Bucket: ${path}`); missing++; continue; }
      console.log(`  FEHLER ${path}: ${dl?.message ?? "leer"}`); failed++; continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let res;
    try { res = await normalizeSpeechMp3(bytes); } catch (e) { console.log(`  FEHLER ${path}: ${(e as Error).message}`); failed++; continue; }
    checked++;
    if (Number.isFinite(res.inputLufs)) lufs.push(res.inputLufs);
    if (!res.changed) { kept++; continue; }
    console.log(`  ${col === "teaser_url" ? "Kostprobe" : "Volldatei"} ${r.lang} ${path}: ${res.inputLufs.toFixed(1)} -> ${res.outputLufs.toFixed(1)} LUFS (${res.gainDb >= 0 ? "+" : ""}${res.gainDb.toFixed(1)} dB)`);
    changed++;
    if (!APPLY) continue;
    // Neuer Name neben dem alten, damit der alte fuer den Sweep liegen bleibt und ein
    // offener Editor nicht auf eine geloeschte Datei zeigt.
    const newPath = path.replace(/\.mp3$/i, "") + `-n${Math.abs(LOUDNESS_TARGET_LUFS)}.mp3`;
    const { error: up } = await db.storage.from(BUCKET).upload(newPath, res.bytes, {
      contentType: "audio/mpeg",
      upsert: false,
      cacheControl: "31536000",
    });
    if (up) { console.log(`  UPLOAD FEHLGESCHLAGEN ${newPath}: ${up.message}`); failed++; continue; }
    const profile = `${(r.tts_profile ?? "legacy").replace(/\|lufs-?\d+$/, "")}|${MARK}`;
    const { error: upd } = await db.from("tour_point_voice_files").update({ [col]: newPath, tts_profile: profile }).eq("id", r.id);
    if (upd) { console.log(`  DB FEHLGESCHLAGEN ${r.id}: ${upd.message}`); failed++; continue; }
  }
}
lufs.sort((a, b) => a - b);
const med = lufs.length ? lufs[Math.floor(lufs.length / 2)] : NaN;
console.log(`\nGemessen: ${checked} Dateien, Median ${med.toFixed(1)} LUFS, Spanne ${lufs[0]?.toFixed(1)} bis ${lufs[lufs.length - 1]?.toFixed(1)}`);
console.log(`Innerhalb der Toleranz: ${kept} · ${APPLY ? "angepasst" : "wuerden angepasst"}: ${changed} · schon markiert: ${skipped} · im Bucket fehlend: ${missing} · Fehler: ${failed}`);
process.exit(failed ? 1 : 0);
