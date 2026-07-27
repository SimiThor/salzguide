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
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  ZWEI DINGE, DIE ERST BEI VIELEN GLEICHZEITIGEN BESUCHERN AUFFALLEN
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 1. DER ANSTURM AUF DEN ABGELAUFENEN EINTRAG („cache stampede"). Der Ablauf oben ist für
//    EINEN Aufrufer richtig gedacht: Ist der Eintrag alt, hol die Daten neu. Stehen aber in
//    der Sekunde, in der die Wassertemperatur abläuft, 200 Leute auf der Seite, dann sehen
//    alle 200 denselben abgelaufenen Eintrag und starten alle 200 denselben externen
//    Aufruf. Genau dann, wenn viel los ist, prügeln wir also am härtesten auf eine fremde
//    API ein, die uns dafür sperren darf — und schreiben 200 Mal dasselbe Ergebnis zurück.
//    Der Riegel unten (`inflight`) lässt den ERSTEN los und hängt die anderen 199 an
//    dessen Versprechen. Ein Aufruf statt 200, dasselbe Ergebnis für alle.
//
// 2. EINE DATENBANK-ABFRAGE, UM ZU ERFAHREN, DASS SICH NICHTS GEÄNDERT HAT. Auch ein
//    perfekter Treffer kostete bisher einen Roundtrip zu Supabase, pro Besucher, pro
//    Seitenaufruf — bei einer Wassertemperatur, die eine Stunde lang dieselbe bleibt. Der
//    kurze Speicher im Prozess (`memo`) fängt das ab.
//
// Beide Schichten leben PRO INSTANZ. Das ist der Punkt: Sie sollen den Weg zur Datenbank
// und nach draussen abkürzen, nicht die Wahrheit ersetzen. Die Wahrheit steht weiter in
// `api_cache`, und dort landet auch weiterhin jedes Ergebnis.

const ERROR_BACKOFF = 600; // 10 Min

/**
 * Wie lange ein Ergebnis im Prozess liegen bleibt, bevor wieder in der Tabelle nachgesehen
 * wird. Bewusst kurz und immer kleiner als die eigentliche TTL: Ein Eintrag, den ein
 * anderer Lauf gerade erneuert hat, soll nicht minutenlang veraltet ausgeliefert werden.
 */
const MEMO_MAX_MS = 60_000;

type CacheRow = { payload: unknown; fetched_at: string; ttl: number | null };

const memo = new Map<string, { value: unknown; until: number }>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T | null;

  // Läuft für diesen Schlüssel schon eine Auflösung? Dann anhängen statt danebenlaufen.
  // Das deckt beide Fälle ab: den externen Aufruf UND die Abfrage der Tabelle.
  const running = inflight.get(key);
  if (running) return (await running) as T | null;

  const task = resolve<T>(key, ttlSeconds, fetcher).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return (await task) as T | null;
}

async function resolve<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  const supabase = createServiceClient();

  const remember = (value: T | null, ttl: number) => {
    memo.set(key, { value, until: Date.now() + Math.min(ttl * 1000, MEMO_MAX_MS) });
    return value;
  };

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
    const ttl = row.ttl ?? 0;
    if (age < ttl * 1000) {
      // auch gecachtes null (Backoff) ist eine gültige Antwort
      return remember((row.payload as T | null) ?? null, ttl);
    }
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
    return remember(data, ttlSeconds);
  } catch {
    // Fetcher-Fehler: alten Wert liefern falls vorhanden (stale-while-error)
    if (row && row.payload != null) {
      // Kurz merken, aber NICHT mit der vollen TTL: Der Wert ist ja schon abgelaufen, wir
      // liefern ihn nur, weil die Quelle gerade nicht will.
      return remember(row.payload as T, ERROR_BACKOFF);
    }
    // sonst kurzer Backoff-Eintrag, damit nicht jeder Request neu anfragt
    try {
      await supabase.from("api_cache").upsert(
        { cache_key: key, payload: null, fetched_at: new Date().toISOString(), ttl: ERROR_BACKOFF },
        { onConflict: "cache_key" },
      );
    } catch {
      /* ignore */
    }
    return remember(null, ERROR_BACKOFF);
  }
}
