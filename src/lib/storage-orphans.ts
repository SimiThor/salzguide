import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collectStorageRefs,
  collectTourAudioPaths,
} from "../../scripts/lib/storage-refs.mjs";

// Wöchentlicher Waisen-Sweep über beide Storage-Buckets. DIE eine, wartungsarme
// Antwort auf alle Leck-Pfade: Uploads passieren im Browser VOR dem Speichern, also
// hinterlässt jedes verworfene Formular, jeder Datei-Tausch und jedes gelöschte
// Objekt (Tour, Punkt, Event, Local …) prinzipbedingt Dateien ohne Referenz. Statt
// in jede Action Lösch-Code zu streuen (viele Pfade, jeder einzeln vergessbar),
// räumt EIN Lauf pro Woche alles ab, worauf keine DB-Zeile mehr zeigt.
//
// SICHERHEIT VOR GRÜNDLICHKEIT – die drei Regeln, die falsches Löschen ausschliessen:
//
// 1. FAIL-CLOSED. Scheitert IRGENDEIN Tabellen-Read (Netz, fehlende Migration), wird
//    NICHTS gelöscht. Eine leere Antwort dürfte sonst heissen „nichts ist referenziert"
//    – und der Sweep würde den ganzen Bucket leeren. sel() wirft deshalb bei jedem
//    Fehler, statt [] zurückzugeben.
// 2. VOLLSTÄNDIG PAGINIERT. PostgREST kappt Antworten (Standard 1000 Zeilen). Eine
//    gekappte Referenzliste erklärt echte Dateien zu Waisen. selAll() blättert, bis
//    eine Seite kurz ist; dasselbe gilt fürs Bucket-Listing.
// 3. ALTERSSCHRANKE. Dateien jünger als 48 h bleiben stehen: Das schützt Uploads
//    offener Formulare (hochgeladen, noch nicht gespeichert) und Intro-Renders, deren
//    DB-Verweis erst nach dem Upload geschrieben wird.
//
// Die Referenzliste ist scripts/lib/storage-refs.mjs – EINE Quelle für Skripte und
// Server. Neue Spalte mit Storage-URL? NUR dort eintragen (die Datei erklärt, warum:
// eine doppelt gepflegte Liste hat genau so schon einmal ein benutztes Standbild
// gelöscht). `previews/` überspringt der Sweep: dafür ist prunePreviews zuständig,
// das zusätzlich verwaiste blur_url-SPALTEN zurücksetzt, nicht nur Dateien.

const MIN_AGE_MS = 48 * 60 * 60 * 1000;
/** Deckel pro Lauf und Bucket: Ein Amok-Lauf (Bug in der Referenzliste) bleibt begrenzt
 * und fällt im Log auf, bevor er einen ganzen Bucket leert. */
const MAX_DELETES_PER_RUN = 400;
const LIST_PAGE = 1000;
const SELECT_PAGE = 1000;

export type OrphanSweepResult = {
  ok: boolean;
  /** Dateien im Bucket (ohne previews/). */
  scanned: number;
  /** Unreferenziert UND älter als 48 h. */
  orphans: number;
  deleted: number;
  freedBytes: number;
  /** Waisen, die wegen des Lauf-Deckels liegen blieben (nächster Lauf holt sie). */
  capped: number;
  error?: string;
};

type StorageObject = { path: string; size: number; createdAt: number };

/** Eine Tabelle VOLLSTÄNDIG lesen. Wirft bei jedem Fehler (Regel 1), blättert (Regel 2). */
function makeSelAll(supabase: SupabaseClient) {
  return async (table: string, cols: string): Promise<Record<string, unknown>[]> => {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += SELECT_PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(cols)
        .range(from, from + SELECT_PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < SELECT_PAGE) return rows;
    }
  };
}

/** Bucket rekursiv listen (Ordner = Einträge ohne id), je Prefix paginiert. */
async function listBucket(
  supabase: SupabaseClient,
  bucket: string,
  prefix = "",
  depth = 0,
): Promise<StorageObject[]> {
  if (depth > 4) return [];
  const out: StorageObject[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    const items = data ?? [];
    for (const item of items) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) {
        // Ordner
        out.push(...(await listBucket(supabase, bucket, path, depth + 1)));
      } else {
        out.push({
          path,
          size: (item.metadata as { size?: number } | null)?.size ?? 0,
          createdAt: Date.parse(item.created_at ?? "") || 0,
        });
      }
    }
    if (items.length < LIST_PAGE) return out;
  }
}

async function removeInChunks(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    // Ein fehlgeschlagener Block bricht nicht den Lauf: Die Dateien sind schon Waisen,
    // der nächste Wochenlauf versucht es erneut.
    if (error) console.error(`[orphan-sweep] remove ${bucket}:`, error.message);
    else deleted += chunk.length;
  }
  return deleted;
}

function sweepFiles(
  objects: StorageObject[],
  isReferenced: (path: string) => boolean,
  now: number,
): { orphans: StorageObject[]; capped: number } {
  const all = objects.filter((o) => !isReferenced(o.path) && now - o.createdAt > MIN_AGE_MS);
  const orphans = all.slice(0, MAX_DELETES_PER_RUN);
  return { orphans, capped: all.length - orphans.length };
}

/**
 * Beide Buckets aufräumen. Für den wöchentlichen Wartungs-Cron; braucht den
 * SERVICE-Client (Storage-Policies erlauben nur Admins, der Cron hat keine Session).
 */
export async function sweepOrphanMedia(supabase: SupabaseClient): Promise<OrphanSweepResult> {
  const now = Date.now();
  try {
    const selAll = makeSelAll(supabase);

    // ---- spot-media (öffentlich, Referenzen sind Public-URLs) ----
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL fehlt");
    const publicPrefix = `${base}/storage/v1/object/public/spot-media/`;
    const noop = async () => {};
    const referencedPaths = new Set<string>();
    for (const ref of await collectStorageRefs(selAll, noop, noop)) {
      if (ref.url.startsWith(publicPrefix)) {
        referencedPaths.add(decodeURIComponent(ref.url.slice(publicPrefix.length).split("?")[0]));
      }
    }
    if (referencedPaths.size === 0) {
      // Ein komplett leerer Referenz-Satz ist bei einer laufenden App kein plausibles
      // Ergebnis, sondern ein Symptom (frische DB ausgenommen). Lieber aussteigen.
      throw new Error("0 Referenzen gefunden – Sweep vorsorglich abgebrochen");
    }

    const spotMedia = (await listBucket(supabase, "spot-media")).filter(
      (o) => !o.path.startsWith("previews/"),
    );
    const a = sweepFiles(spotMedia, (p) => referencedPaths.has(p), now);

    // ---- tour-audio (privat, Referenzen sind Objekt-PFADE) ----
    const audioPaths = new Set(await collectTourAudioPaths(selAll));
    const tourAudio = await listBucket(supabase, "tour-audio");
    const b = sweepFiles(tourAudio, (p) => audioPaths.has(p), now);

    const deleted =
      (await removeInChunks(supabase, "spot-media", a.orphans.map((o) => o.path))) +
      (await removeInChunks(supabase, "tour-audio", b.orphans.map((o) => o.path)));
    const freedBytes = [...a.orphans, ...b.orphans].reduce((sum, o) => sum + o.size, 0);

    const result: OrphanSweepResult = {
      ok: true,
      scanned: spotMedia.length + tourAudio.length,
      orphans: a.orphans.length + b.orphans.length,
      deleted,
      freedBytes,
      capped: a.capped + b.capped,
    };
    console.log(
      `[orphan-sweep] ${result.scanned} Dateien geprüft, ${result.deleted} Waisen gelöscht` +
        ` (${(freedBytes / 1048576).toFixed(1)} MB)` +
        (result.capped ? `, ${result.capped} bis zum nächsten Lauf zurückgestellt` : ""),
    );
    return result;
  } catch (e) {
    // FAIL-CLOSED: lieber eine Woche lang ein paar Waisen zu viel als eine einzige
    // gelöschte Datei zu wenig.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[orphan-sweep] abgebrochen, nichts gelöscht:", msg);
    return { ok: false, scanned: 0, orphans: 0, deleted: 0, freedBytes: 0, capped: 0, error: msg };
  }
}
