// Verstöße gegen die Inhalts-Richtlinie (CSP) einsammeln.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  WARUM ES DAS BRAUCHT
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Bis zum 11.08.2026 lief die CSP als `-Report-Only` und OHNE Meldeadresse. Ein Verstoß
// stand damit in der Konsole des Besuchers — also nirgends. Seit dem Umstellen auf scharf
// (next.config.ts) wiegt genau das schwer: Blockiert die Richtlinie etwas, das wir wirklich
// brauchen, dann verlässt die Anfrage den Browser nie. Der Server sieht keinen Fehler, das
// Logbuch bleibt still, und die Karte oder der Video-Tab sind trotzdem kaputt — nur eben
// bei den Besuchern, nicht bei uns.
//
// Diese Route ist der Gegenpart dazu: Der Browser meldet den Verstoß selbst (`report-uri`
// im Header), und er landet im Ops-Katalog wie jedes andere Signal.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  WARUM HIER KEIN SAME-ORIGIN-RIEGEL STEHT, obwohl es ein schreibender Endpunkt ist
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Die Hausregel (lib/same-origin.ts) gilt für Endpunkte, die unser eigenes JavaScript
// aufruft. Diese POSTs schickt aber der BROWSER selbst, und er hält sich dabei nicht an die
// Gepflogenheiten unseres Codes: Je nach Browser und Kontext kommt gar kein Origin-Kopf
// mit, oder das wörtliche "null" (jeder Verstoß aus einem sandboxed iframe — wir haben
// welche, siehe die Mail-Vorschau im Admin). `foreignOrigin()` würde beides abweisen und
// obendrein ein `suspicious_request` über uns selbst ins Logbuch schreiben. Genau der
// Fehler, den same-origin.ts am www-Fall schon einmal beschrieben hat.
//
// Was hier an seine Stelle tritt, ist die inhaltlich richtige Prüfung: Ein Bericht zählt
// nur, wenn die gemeldete SEITE auf unserem eigenen Host liegt. Wer von aussen POSTet, muss
// dafür unseren Host in den Bericht schreiben — und stößt dann auf dieselben Riegel wie
// api/ops/client-error: Größenlimit, IP-Bremse, Katalog-Deckel.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  WAS BEWUSST NICHT INS LOGBUCH GEHT
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   · `script-sample` — der Browser schickt darin bis zu 40 Zeichen des blockierten
//     Skripts. Das kann Seiteninhalt sein, im schlimmsten Fall ein Token aus einer
//     Inline-Zuweisung. Wird nicht ausgelesen, nicht geloggt, nicht gespeichert.
//   · Pfad und Query der blockierten URL — nur die HERKUNFT (Origin) wird notiert. Zum
//     Ergänzen der Policy braucht man den Host, sonst nichts, und in einer blockierten
//     URL kann ein Zugangstoken stehen.
//   · `original-policy` — das ist unser eigener Header, den kennen wir.
import { NextResponse, after } from "next/server";
import { logOps, bumpOpsCounter, subjectFromRequest } from "@/lib/ops";
import { scrubPath } from "@/lib/ops-scrub";
import { clientIp, classifyDevice } from "@/lib/analytics";

export const runtime = "nodejs";

/** Obergrenze je Adresse und Stunde. Ein Seitenaufruf meldet im Ernstfall mehrere Verstöße. */
const WINDOW_SECONDS = 3600;
const MAX_PER_IP = 30;

/** Ein Bericht ist ein paar hundert Byte. Alles darüber ist kein Browser. */
const MAX_BYTES = 8000;

/**
 * Herkünfte, die NIE von uns stammen: Browser-Erweiterungen und interne Seiten.
 *
 * Das ist der mit Abstand größte Teil dessen, was an einer scharfen CSP auflaufen würde.
 * Werbeblocker, Passwort-Manager und Übersetzer spritzen Skripte in fremde Seiten, die CSP
 * blockt sie korrekt, und mit dem Vorfall können wir nichts anfangen — es ist das Gerät des
 * Besuchers, nicht unsere App. Ungefiltert ersäufen sie jedes echte Signal.
 */
const NOISE_SCHEMES = [
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:",
  "webkit-masked-url:",
  "chrome:",
  "resource:",
  "about:",
];

/** Führendes „www." abwerfen — dieselbe Normalisierung wie in lib/same-origin.ts. */
const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/** Was der Browser statt einer URL schickt, wenn es keine gibt. */
const KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "data",
  "blob",
  "filesystem",
  "self",
  "media",
]);

/**
 * Blockierte URL auf das reduzieren, was zum Ergänzen der Policy taugt: die Herkunft.
 *
 * `null` heißt „Rauschen, wegwerfen".
 */
function blockedOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const v = raw.trim().toLowerCase();
  if (KEYWORDS.has(v)) return v;
  if (NOISE_SCHEMES.some((s) => v.startsWith(s))) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin.slice(0, 120);
    // blob:, data:, filesystem: — `origin` ist dort "null", das Schema ist die Aussage.
    return u.protocol.replace(":", "").slice(0, 40);
  } catch {
    return null;
  }
}

/** Ein Bericht, auf das reduziert, was wir behalten. */
type Report = { directive: string; blocked: string; documentUri: string };

/**
 * Zwei Formate, ein Ergebnis.
 *
 * `report-uri` (Firefox, Safari, Chrome) schickt `{"csp-report": {…}}` mit Bindestrich-
 * Schlüsseln, die Reporting-API schickt eine LISTE `[{type, body:{…}}]` mit camelCase.
 * Beide werden hier eingelesen, damit ein späterer Umstieg auf `Reporting-Endpoints` nichts
 * an dieser Route ändert.
 */
function parseReports(body: unknown): Report[] {
  const raw: unknown[] = Array.isArray(body) ? body : [body];
  const out: Report[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    // Reporting-API: nur CSP-Berichte, die Liste kann auch andere Arten tragen.
    if (typeof o.type === "string" && o.type !== "csp-violation") continue;
    const r = (o["csp-report"] ?? o.body ?? o) as Record<string, unknown>;
    if (!r || typeof r !== "object") continue;

    const directive = String(
      r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? r.violatedDirective ?? "",
    )
      .split(/\s/)[0]
      .slice(0, 40);
    // Nur echte Direktiv-Namen. Alles andere ist getippt, nicht vom Browser.
    if (!/^[a-z-]{3,40}$/.test(directive)) continue;

    const blocked = blockedOrigin(r["blocked-uri"] ?? r.blockedURL ?? r.blockedURI);
    if (!blocked) continue;

    const documentUri = String(r["document-uri"] ?? r.documentURL ?? o.url ?? "").slice(0, 400);
    if (!documentUri) continue;

    out.push({ directive, blocked, documentUri });
  }
  return out;
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // JETZT auslesen, nicht in `after()` — dort ist das Request-Objekt nicht mehr sicher
  // lesbar (dieselbe Falle wie in api/ops/client-error und api/track).
  const host = bareHost(req.headers.get("host") ?? "");
  const ip = clientIp(req);
  const subject = subjectFromRequest(req);
  const device = classifyDevice(req.headers.get("user-agent"));

  // Der Riegel: Die gemeldete Seite muss auf UNSEREM Host liegen (siehe Kopf). Der Vergleich
  // läuft gegen den Host DIESER Anfrage und nicht gegen siteUrl(), damit ein Preview-
  // Deployment seine eigenen Verstöße melden kann statt sie sich selbst wegzufiltern.
  const reports = parseReports(body).filter((r) => {
    try {
      return host !== "" && bareHost(new URL(r.documentUri).host) === host;
    } catch {
      return false;
    }
  });
  if (!reports.length) return new NextResponse(null, { status: 204 });

  // Mehrere Verstöße in einem Bericht sind normal (eine Seite, drei blockierte Kacheln).
  // Nach Direktive+Herkunft entdoppeln: Was uns interessiert, ist die LÜCKE, nicht wie oft
  // sie dieselbe Seite trifft.
  const unique = new Map(reports.map((r) => [`${r.directive}|${r.blocked}`, r]));

  // Die Antwort wartet auf nichts.
  after(async () => {
    if (ip) {
      const count = await bumpOpsCounter(`ops-csp:${subject}`, WINDOW_SECONDS);
      if (count > MAX_PER_IP) return;
    }
    for (const r of unique.values()) {
      let path: string | null = null;
      try {
        path = scrubPath(new URL(r.documentUri).pathname);
      } catch {
        /* schon gefiltert, aber die Route soll an einer URL nie sterben */
      }
      await logOps("csp_violation", {
        message: `${r.directive} hat ${r.blocked} blockiert.`,
        path,
        subject,
        // Direktive + Herkunft IST die Lücke, und nur sie gehört in den Fingerabdruck.
        // Anders als bei client_error bleibt das Gerät bewusst DRAUSSEN: Eine fehlende
        // Quelle in der Policy trifft alle Browser gleich, und mit dem Gerät im
        // Fingerabdruck zerfiele ein einziger echter Fehler in vier Zählungen — die
        // Schwelle griffe dann viermal später.
        group: `csp:${r.directive}:${r.blocked}`,
        detail: { direktive: r.directive, blockiert: r.blocked, geraet: device },
      });
    }
  });

  return new NextResponse(null, { status: 204 });
}
