import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./supabase/service";
import { synthesizeVoice } from "./tts";
import { elevenIdForVoice } from "./tts-voices";
import {
  ttsTextHash,
  fileState,
  fileCurrent,
  durationFromBytes,
  tourVoiceGate,
  type AudioKind,
  type PlanItem,
  type PlanReason,
  type VoicePlan,
  type VoiceRow,
  type TourGateMiss,
  type TourGateStop,
} from "./tts-rules";
export type { PlanItem, PlanReason, VoicePlan };
import { routing } from "@/i18n/routing";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der eine Vertonungs-Kern: vertont nur, was fehlt oder veraltet ist.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Drei Aufrufer, eine Regel: der Punkt-Editor (eine Sprache), "Vertonen" an der Runde (alle
// Stationen, alle Sprachen, Kostproben mit) und das Seed-Skript. Jeder Aufruf ist EINE Datei,
// damit er unter jeder Vercel-Zeitgrenze bleibt; die Schleife macht der Browser.
//
// Was hier NICHT passiert: das Loeschen ersetzter Dateien. Ein Admin kann den Punkt-Editor
// offen haben, waehrend an der Runde neu vertont wird; wuerde hier synchron geloescht, zeigte
// eine spaeter gespeicherte alte Zeile auf eine Datei, die es nicht mehr gibt. Der
// woechentliche Waisen-Sweep (lib/storage-orphans.ts) raeumt nach 48 Stunden, und nur, was
// keine Zeile mehr referenziert.

const BUCKET = "tour-audio";
const FILES = "tour_point_voice_files";
const TEXTS = "tour_point_audio";

type FileRow = {
  audio_url: string | null;
  audio_hash: string | null;
  teaser_url: string | null;
  teaser_hash: string | null;
};

const cols = (kind: AudioKind) =>
  kind === "kostprobe"
    ? { url: "teaser_url", hash: "teaser_hash", sec: "teaser_sec", text: "teaser_text" } as const
    : { url: "audio_url", hash: "audio_hash", sec: "duration_sec", text: "audio_text" } as const;

async function readFileRow(
  db: SupabaseClient,
  pointId: string,
  lang: string,
  voiceId: string,
): Promise<FileRow | null> {
  const { data } = await db
    .from(FILES)
    .select("audio_url, audio_hash, teaser_url, teaser_hash")
    .eq("point_id", pointId)
    .eq("lang", lang)
    .eq("voice_id", voiceId)
    .maybeSingle();
  return (data as FileRow | null) ?? null;
}

/** Liegt die Datei wirklich im Bucket? Eine Signatur auf ein fehlendes Objekt schlaegt fehl. */
async function objectExists(db: SupabaseClient, path: string): Promise<boolean> {
  const { error } = await db.storage.from(BUCKET).createSignedUrl(path, 60);
  return !error;
}

export type EnsureResult =
  | { ok: true; path: string; hash: string; skipped: boolean; chars: number }
  | { ok: false; error: string; status?: number };

/**
 * Sorgt dafuer, dass fuer (Punkt, Sprache, Stimme, Art) eine aktuelle Datei existiert.
 *
 * Aktuell heisst: Datei da, Objekt im Bucket da, Hash gleich dem Text (oder ohne Hash, also
 * Altbestand). Dann kommt der vorhandene Pfad zurueck, `skipped: true`, und ElevenLabs wird
 * nicht angerufen. `force` uebergeht das (schlechter Take), nur aus dem Punkt-Editor nach
 * Rueckfrage.
 *
 * Voraussetzung: die Textzeile (tour_point_audio) existiert, denn die Datei-Zeile haengt per
 * FK an ihr. tts-actions.ts schreibt den Text vorher, das Seed-Skript ebenso.
 */
export async function ensureVoiceFile(input: {
  pointId: string;
  lang: string;
  kind: AudioKind;
  voice: VoiceRow;
  text: string;
  force?: boolean;
  db?: SupabaseClient;
}): Promise<EnsureResult> {
  const db = input.db ?? createServiceClient();
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Kein Text zum Vertonen." };
  const elevenId = elevenIdForVoice(input.voice);
  if (!elevenId) return { ok: false, error: "voice_not_synthesizable" };
  const c = cols(input.kind);
  const hash = ttsTextHash(text);

  const look = async () => {
    const row = await readFileRow(db, input.pointId, input.lang, input.voice.id);
    const url = row?.[c.url] ?? null;
    const exists = url ? await objectExists(db, url) : false;
    return {
      url,
      state: fileState({ url, hash: row?.[c.hash] ?? null, objectExists: exists }, hash),
      storedHash: row?.[c.hash] ?? null,
    };
  };

  const before = await look();
  if (!input.force && before.url && fileCurrent(before.state))
    return { ok: true, path: before.url, hash: before.storedHash ?? hash, skipped: true, chars: 0 };

  const r = await synthesizeVoice({
    text,
    lang: input.lang,
    kind: input.kind,
    elevenVoiceId: elevenId,
    voiceKey: input.voice.key,
  });
  if (!r.ok) return r;

  // Zweiter Blick nach dem Aufruf: Hat ein paralleler Lauf (Doppelklick, zwei Tabs) dieselbe
  // Datei inzwischen geliefert, dann die eigene wieder wegraeumen und seine nehmen.
  if (!input.force) {
    const after = await look();
    if (after.url && after.url !== before.url && after.state === "ok") {
      await db.storage.from(BUCKET).remove([r.path]);
      return { ok: true, path: after.url, hash, skipped: true, chars: 0 };
    }
  }

  const { error } = await db.from(FILES).upsert(
    {
      point_id: input.pointId,
      lang: input.lang,
      voice_id: input.voice.id,
      [c.url]: r.path,
      [c.hash]: hash,
      tts_profile: r.profile,
    },
    { onConflict: "point_id,lang,voice_id" },
  );
  if (error) return { ok: false, error: "db" };
  // Die Dauer gehoert zum Text (Anzeige im Player), und sie ist bei konstanter Bitrate exakt.
  await db
    .from(TEXTS)
    .update({ [c.sec]: durationFromBytes(r.bytes) })
    .eq("point_id", input.pointId)
    .eq("lang", input.lang);
  return { ok: true, path: r.path, hash, skipped: false, chars: text.length };
}

// ── Der Plan: was eine Stimme fuer diese Punkte noch braucht ───────────────────────────

/**
 * Welche Dateien fuer diese Stimme fehlen oder veraltet sind, samt Zeichen (= Kosten).
 * Die Existenz im Bucket wird fuer alle Pfade in EINEM Aufruf geprueft.
 */
export async function planVoiceFiles(input: {
  pointIds: string[];
  voiceId: string;
  db?: SupabaseClient;
}): Promise<VoicePlan> {
  const db = input.db ?? createServiceClient();
  const empty: VoicePlan = { items: [], wanted: 0, chars: 0 };
  if (!input.pointIds.length) return empty;

  const [texts, files] = await Promise.all([
    db.from(TEXTS).select("point_id, lang, audio_text, teaser_text").in("point_id", input.pointIds),
    db
      .from(FILES)
      .select("point_id, lang, audio_url, audio_hash, teaser_url, teaser_hash")
      .in("point_id", input.pointIds)
      .eq("voice_id", input.voiceId),
  ]);
  const textRows = (texts.data as { point_id: string; lang: string; audio_text: string | null; teaser_text: string | null }[] | null) ?? [];
  const fileRows = (files.data as ({ point_id: string; lang: string } & FileRow)[] | null) ?? [];
  const fileBy = new Map(fileRows.map((f) => [`${f.point_id}|${f.lang}`, f]));

  const paths = fileRows.flatMap((f) => [f.audio_url, f.teaser_url]).filter((p): p is string => Boolean(p));
  const exists = new Set<string>();
  if (paths.length) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 60);
    for (const s of data ?? []) if (!s.error && s.path) exists.add(s.path);
  }

  const order = new Map(input.pointIds.map((id, i) => [id, i]));
  const langOrder = new Map((routing.locales as readonly string[]).map((l, i) => [l, i]));
  const items: PlanItem[] = [];
  let wanted = 0;
  let chars = 0;
  for (const t of textRows) {
    const f = fileBy.get(`${t.point_id}|${t.lang}`);
    for (const kind of ["voll", "kostprobe"] as const) {
      const c = cols(kind);
      const text = (t[c.text] ?? "").trim();
      if (!text) continue;
      wanted++;
      const url = f?.[c.url] ?? null;
      const state = fileState(
        { url, hash: f?.[c.hash] ?? null, objectExists: url ? exists.has(url) : false },
        ttsTextHash(text),
      );
      if (fileCurrent(state)) continue;
      items.push({ pointId: t.point_id, lang: t.lang, kind, chars: text.length, reason: state as PlanReason });
      chars += text.length;
    }
  }
  items.sort(
    (a, b) =>
      (order.get(a.pointId) ?? 0) - (order.get(b.pointId) ?? 0) ||
      (langOrder.get(a.lang) ?? 99) - (langOrder.get(b.lang) ?? 99) ||
      (a.kind === "voll" ? 0 : 1) - (b.kind === "voll" ? 0 : 1),
  );
  return { items, wanted, chars };
}

// ── Das Publish-Gate der Runde, mit Daten gefuettert ───────────────────────────────────
/**
 * Fehlende oder veraltete Volldateien der Runden-Stimme ueber die VEROEFFENTLICHTEN Punkte
 * (nur die erscheinen). Reine DB-Frage, kein Storage (siehe tourVoiceGate).
 */
export async function loadTourVoiceMisses(
  db: SupabaseClient,
  pointIds: string[],
  voiceId: string,
): Promise<TourGateMiss[]> {
  if (!pointIds.length) return [];
  const [points, texts, files] = await Promise.all([
    db.from("tour_points").select("id, status").in("id", pointIds),
    db.from(TEXTS).select("point_id, lang, audio_text").in("point_id", pointIds),
    db.from(FILES).select("point_id, lang, audio_url, audio_hash").in("point_id", pointIds).eq("voice_id", voiceId),
  ]);
  const live = new Set(
    ((points.data as { id: string; status: string }[] | null) ?? [])
      .filter((p) => p.status === "published")
      .map((p) => p.id),
  );
  const stops = new Map<string, TourGateStop>();
  for (const id of pointIds) if (live.has(id)) stops.set(id, { pointId: id, textByLang: {}, files: {} });
  for (const t of (texts.data as { point_id: string; lang: string; audio_text: string | null }[] | null) ?? [])
    if (stops.has(t.point_id)) stops.get(t.point_id)!.textByLang[t.lang] = t.audio_text ?? "";
  for (const f of (files.data as { point_id: string; lang: string; audio_url: string | null; audio_hash: string | null }[] | null) ?? [])
    if (stops.has(f.point_id)) stops.get(f.point_id)!.files[f.lang] = { url: f.audio_url, hash: f.audio_hash };
  return tourVoiceGate([...stops.values()], routing.locales);
}

// ── Was ein Punkt braucht: seine Runden und seine Dateien ──────────────────────────────
export type PointTourUsage = { tourId: string; title: string; status: "draft" | "published"; voiceId: string };

/** In welchen Runden ein Punkt steckt, mit deren Stimme. Entwuerfe mit, der Editor zeigt sie. */
export async function loadPointTourUsage(db: SupabaseClient, pointId: string): Promise<PointTourUsage[]> {
  const { data } = await db
    .from("tour_stops")
    .select("tours(id, status, voice_id, tour_translations(lang, title))")
    .eq("point_id", pointId);
  const out: PointTourUsage[] = [];
  for (const r of (data as unknown as Record<string, unknown>[] | null) ?? []) {
    const t = r.tours as Record<string, unknown> | null;
    if (!t || typeof t.voice_id !== "string") continue;
    const trs = (t.tour_translations as { lang: string; title: string }[] | null) ?? [];
    out.push({
      tourId: t.id as string,
      title: trs.find((x) => x.lang === "de")?.title ?? trs[0]?.title ?? "(ohne Titel)",
      status: t.status === "published" ? "published" : "draft",
      voiceId: t.voice_id,
    });
  }
  return out;
}

export type PointFileMap = Record<string, Record<string, { url: string | null; hash: string | null; teaserUrl: string | null; teaserHash: string | null }>>;

/** voiceId -> lang -> Dateien eines Punkts. */
export async function loadPointFiles(db: SupabaseClient, pointId: string): Promise<PointFileMap> {
  const { data } = await db
    .from(FILES)
    .select("lang, voice_id, audio_url, audio_hash, teaser_url, teaser_hash")
    .eq("point_id", pointId);
  const out: PointFileMap = {};
  for (const f of (data as ({ lang: string; voice_id: string } & FileRow)[] | null) ?? []) {
    (out[f.voice_id] ??= {})[f.lang] = {
      url: f.audio_url,
      hash: f.audio_hash,
      teaserUrl: f.teaser_url,
      teaserHash: f.teaser_hash,
    };
  }
  return out;
}
