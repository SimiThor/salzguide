// Robuster fetch für externe APIs + tolerantes JSON-Parsen von KI-Ausgaben.
// Reines Server-Util (kein "use server").
import { jsonrepair } from "jsonrepair";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// KI-Modelle liefern manchmal FAST-valides JSON (z.B. ein nicht-escapetes " in
// einem Titel). Erst normal parsen; scheitert das, mit jsonrepair reparieren.
// Gibt undefined zurück, wenn auch das nicht klappt.
export function safeJsonParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    // reparieren versuchen
  }
  try {
    return JSON.parse(jsonrepair(s));
  } catch {
    return undefined;
  }
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeoutMs = 20000,
  {
    retryOnTimeout = true,
    deadline,
  }: {
    // false: nach einem Zeitlimit NICHT neu starten. Für lange Aufrufe (Web-Recherche), bei
    // denen ein zweiter Anlauf nur das Zeitbudget der Funktion sprengt, statt zu helfen.
    retryOnTimeout?: boolean;
    // Feste Frist (ms seit Epoch) über ALLE Versuche: Jeder Versuch bekommt höchstens die
    // Restzeit. Sonst startet z.B. ein spät gemeldeter 529 mit vollem timeoutMs neu.
    deadline?: number;
  } = {},
): Promise<Response> {
  let lastErr: unknown;
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ms = deadline === undefined ? timeoutMs : Math.min(timeoutMs, deadline - Date.now());
    // Frist vorbei: die letzte echte Antwort zurückgeben (ehrlicher Status) oder den Fehler.
    if (deadline !== undefined && ms < 1000 && attempt > 0) break;
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(Math.max(ms, 1)),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        lastRes = res;
        lastErr = undefined;
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (res.status === 400 && url.startsWith("https://api.anthropic.com/")) await noteCreditProblem(res.clone());
      return res;
    } catch (err) {
      lastErr = err;
      lastRes = undefined;
      const isTimeout =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (isTimeout && !retryOnTimeout) throw err;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }
  if (lastRes) return lastRes;
  throw lastErr;
}

/**
 * Claude-Guthaben leer (Anton 27.11.2026: kein Zahlungsmittel hinterlegt, nur Aktionsguthaben, das sich SalzGuide mit
 * Steiner Studio teilt): Anthropic antwortet dann 400 mit "credit balance is too low". Einmal melden, damit es jemand
 * merkt, bevor Nutzer sich wundern. Wirft nie; ops wird erst hier geladen (dieses Modul bleibt frei von server-only).
 */
async function noteCreditProblem(res: Response): Promise<void> {
  try {
    const text = (await res.text()).slice(0, 2000);
    // "credit balance is too low" (Guthaben leer) oder "reached your specified API usage limits" (Limit in der Console).
    if (!/credit balance|usage limit/i.test(text)) return;
    const { logOps } = await import("./ops");
    await logOps("ai_credit_exhausted", {
      message: "Anthropic lehnt ab: Claude-Guthaben aufgebraucht.",
      group: "ai:credit",
    });
  } catch {
    /* Meldung ist Zugabe, nie ein Grund für einen zweiten Fehler */
  }
}
