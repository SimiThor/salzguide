// Übersetzt einen gescheiterten Anthropic-Aufruf in EINEN ehrlichen deutschen Satz.
// Reines Util (kein "use server", kein Netz), damit es ohne Schlüssel testbar ist.
//
// Warum es das gibt: Die Wochenrecherche meldete bei JEDEM Fehler „bitte Guthaben &
// Web-Suche prüfen". Ein Zeitlimit, ein abgelaufenes Modell oder ein abgelehnter Schlüssel
// sahen im Admin gleich aus, und man suchte an der falschen Stelle. Der Text hier landet im
// Admin und im Lebenszeichen des Crons; er enthält nie den Schlüssel, nur Status + Meldung
// der API (gekürzt).

const MAX_DETAIL = 180;

function short(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_DETAIL ? `${t.slice(0, MAX_DETAIL - 1)}…` : t;
}

// Anthropic liefert Fehler als { type: "error", error: { type, message } }.
function parseApiError(body: string): { type: string; message: string } {
  try {
    const j = JSON.parse(body) as { error?: { type?: unknown; message?: unknown } };
    return {
      type: typeof j.error?.type === "string" ? j.error.type : "",
      message: typeof j.error?.message === "string" ? j.error.message : "",
    };
  } catch {
    return { type: "", message: body };
  }
}

// HTTP-Antwort != 2xx -> Grund.
export function describeAnthropicHttpError(status: number, body: string): string {
  const { type, message } = parseApiError(body);
  const detail = message ? ` (${short(message)})` : "";
  const m = message.toLowerCase();

  if (m.includes("credit balance") || m.includes("billing"))
    return `Anthropic-Guthaben aufgebraucht: HTTP ${status}${detail}`;
  if (status === 401 || type === "authentication_error")
    return `Anthropic-Schlüssel abgelehnt: HTTP ${status}${detail}`;
  if (status === 403 || type === "permission_error")
    return `Anthropic verweigert den Zugriff: HTTP ${status}${detail}`;
  if (status === 404 || type === "not_found_error")
    return `Anthropic-Modell oder -Tool nicht gefunden: HTTP ${status}${detail}`;
  if (status === 429 || type === "rate_limit_error")
    return `Anthropic-Rate-Limit erreicht: HTTP ${status}${detail}`;
  if (status === 529 || type === "overloaded_error")
    return `Anthropic ist überlastet: HTTP ${status}${detail}`;
  if (status >= 500) return `Anthropic-Serverfehler: HTTP ${status}${detail}`;
  return `Anthropic hat die Anfrage abgelehnt: HTTP ${status}${detail}`;
}

// Geworfener Fehler (Zeitlimit, Netz) -> Grund. `timeoutMs` = das gesetzte Limit pro Aufruf.
export function describeAnthropicThrow(err: unknown, timeoutMs: number): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError")
    return `Zeitlimit: Anthropic hat nicht innerhalb von ${Math.round(timeoutMs / 1000)} s geantwortet.`;
  const msg = err instanceof Error ? err.message : String(err);
  return `Anthropic nicht erreichbar: ${short(msg) || "unbekannter Netzwerkfehler"}`;
}
