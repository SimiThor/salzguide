// Einmalig nach Migration 0068: Datei-Zeilen ohne Text-Hash bekommen den Hash des AKTUELLEN
// Textes. Aufruf: npm run tts:backfill-hashes
//
// WARUM: Der Backfill in der Migration konnte die Hashes nicht setzen (hashTexts ist
// JavaScript, kein SQL). Ohne Marke gilt der Altbestand zwar als aktuell (tts-rules.ts,
// "unhashed"), aber der Punkt-Editor koennte bei einer Textaenderung nicht warnen. Die
// Annahme "Datei spricht den aktuellen Text" ist dieselbe, die bis 0068 stillschweigend galt.
//
// Idempotent: Zeilen mit Hash werden nicht angefasst. Ein zweiter Lauf tut nichts.
import { createClient } from "@supabase/supabase-js";
import { ttsTextHash } from "../src/lib/tts-rules.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Zugang fehlt in .env.local");
const db = createClient(SUPA_URL, SUPA_KEY);

type FileRow = {
  id: string;
  point_id: string;
  lang: string;
  audio_url: string | null;
  audio_hash: string | null;
  teaser_url: string | null;
  teaser_hash: string | null;
};

const { data: files, error } = await db
  .from("tour_point_voice_files")
  .select("id, point_id, lang, audio_url, audio_hash, teaser_url, teaser_hash")
  .or("audio_hash.is.null,teaser_hash.is.null");
if (error) throw error;
const rows = (files ?? []) as FileRow[];
console.log(`${rows.length} Datei-Zeilen ohne vollstaendige Marke`);

const pointIds = [...new Set(rows.map((r) => r.point_id))];
const texts = new Map<string, { audio_text: string | null; teaser_text: string | null }>();
for (let i = 0; i < pointIds.length; i += 100) {
  const { data, error: e2 } = await db
    .from("tour_point_audio")
    .select("point_id, lang, audio_text, teaser_text")
    .in("point_id", pointIds.slice(i, i + 100));
  if (e2) throw e2;
  for (const t of (data ?? []) as { point_id: string; lang: string; audio_text: string | null; teaser_text: string | null }[])
    texts.set(`${t.point_id}|${t.lang}`, t);
}

let updated = 0;
for (const r of rows) {
  const t = texts.get(`${r.point_id}|${r.lang}`);
  if (!t) continue;
  const patch: Record<string, string> = {};
  if (r.audio_url && r.audio_hash === null && t.audio_text?.trim()) patch.audio_hash = ttsTextHash(t.audio_text);
  if (r.teaser_url && r.teaser_hash === null && t.teaser_text?.trim()) patch.teaser_hash = ttsTextHash(t.teaser_text);
  if (!Object.keys(patch).length) continue;
  const { error: e3 } = await db.from("tour_point_voice_files").update(patch).eq("id", r.id);
  if (e3) throw e3;
  updated++;
}
console.log(`${updated} Zeilen markiert. Fertig.`);
