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
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr;
}
