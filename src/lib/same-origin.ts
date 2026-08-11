// Same-Origin-Riegel für schreibende Endpunkte — DIE EINE Entscheidung, ob ein
// Origin-Header „unsere Seite" ist. Vorher stand derselbe Vergleich dreimal im Code
// (api/track, api/ops/client-error, api/ai/chat), und alle drei hatten denselben Fehler:
//
// www IST UNSERE SEITE. www.salzguide.com leitet per 308 auf salzguide.com um, aber ein
// Beacon aus einem alten Tab (Lesezeichen, Google-Index, bfcache aus der WordPress-Zeit)
// FOLGT dieser Umleitung: Der Browser schickt den POST erneut an die Apex-Domain und
// lässt dabei den ursprünglichen Origin (www) im Header stehen. Ergebnis am 10.08.2026:
// „Beacon von fremder Herkunft (www.salzguide.com) abgewiesen" — eine Sicherheits-
// Meldung über uns selbst, die das suspicious_request-Signal entwertet, und ein
// verlorener Seitenaufruf obendrein.
//
// Deshalb vergleicht dieser Riegel BEIDE Seiten ohne führendes „www.". Das ist sicher:
// Gestrippt wird nur das Label samt Punkt, „wwwsalzguide.com" oder „www.evil.com"
// bleiben fremd. Mehr Normalisierung (Subdomains, Ports raten) gibt es bewusst nicht —
// alles andere als Apex und www ist wirklich fremd.
//
// KEIN Origin-Header ist erlaubt und bleibt es: Nicht jeder Browser schickt ihn bei
// same-origin, und ein Angreifer auf der Kommandozeile setzt ohnehin jeden Header.
// Was dann schützt, sind die Limits dahinter (Begründung im Kopf von api/track).

/** Führendes „www." abwerfen und Groß/Klein egalisieren. Nur für den Vergleich. */
const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/**
 * Ist dieser Request ein Cross-Site-Schreibzugriff?
 *
 * Rückgabe `null` heißt: in Ordnung (kein Origin-Header, oder Origin gehört zu uns).
 * Alles andere ist der fremde Host für die Logbuch-Meldung („unlesbar", wenn der
 * Header kein gültiger Origin war — auch das ist ein Ablehnungsgrund, ein Browser
 * schickt nie einen kaputten Origin).
 */
export function foreignOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    /* ungültig (auch das wörtliche "null" sandboxter iframes) -> ablehnen */
  }
  if (!originHost) return "unlesbar";
  const host = req.headers.get("host") ?? "";
  return host && bareHost(originHost) === bareHost(host) ? null : originHost;
}
