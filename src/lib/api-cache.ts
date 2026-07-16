import "server-only";
import { createServiceClient } from "./supabase/service";

// Generischer serverseitiger Cache über die Supabase-Tabelle `api_cache`
// (cache_key, payload jsonb, fetched_at, ttl Sekunden — nur service_role).
// Wiederverwendbar für Wetter, später Öffnungszeiten etc.
//
// - frischer Treffer -> Cache liefern (kein externer Call)
// - abgelaufen/leer -> fetcher() ausführen, Ergebnis cachen, liefern
// - fetcher-Fehler -> alten (stale) Wert liefern, sonst kurzer Fehler-Cache
//   (Backoff) mit null -> nicht bei jedem Request neu anfragen
// - Cache-Infrastruktur-Fehler -> trotzdem direkt fetchen (graceful degrade)

const ERROR_BACKOFF = 600; // 10 Min

type CacheRow = { payload: unknown; fetched_at: string; ttl: number | null };

export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const supabase = createServiceClient();

  let row: CacheRow | null = null;
  try {
    const { data } = await supabase
      .from("api_cache")
      .select("payload, fetched_at, ttl")
      .eq("cache_key", key)
      .maybeSingle();
    row = (data as CacheRow | null) ?? null;
  } catch {
    // Cache nicht lesbar -> ohne Cache weiter (unten)
  }

  if (row) {
    const age = Date.now() - Date.parse(row.fetched_at);
    const fresh = age < (row.ttl ?? 0) * 1000;
    if (fresh) return (row.payload as T | null) ?? null; // auch gecachtes null (Backoff)
  }

  try {
    const data = await fetcher();
    try {
      await supabase.from("api_cache").upsert(
        { cache_key: key, payload: data as object, fetched_at: new Date().toISOString(), ttl: ttlSeconds },
        { onConflict: "cache_key" },
      );
    } catch {
      /* Schreiben fehlgeschlagen -> egal, Daten trotzdem liefern */
    }
    return data;
  } catch {
    // Fetcher-Fehler: alten Wert liefern falls vorhanden (stale-while-error)
    if (row && row.payload != null) return row.payload as T;
    // sonst kurzer Backoff-Eintrag, damit nicht jeder Request neu anfragt
    try {
      await supabase.from("api_cache").upsert(
        { cache_key: key, payload: null, fetched_at: new Date().toISOString(), ttl: ERROR_BACKOFF },
        { onConflict: "cache_key" },
      );
    } catch {
      /* ignore */
    }
    return null;
  }
}
