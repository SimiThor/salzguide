// Fehler aus dem Browser melden. Der Gegenpart zu instrumentation.ts, die nur Serverfehler
// sieht.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
//  WARUM ES DAS BRAUCHT, UND WARUM ES DER GEFÄHRLICHSTE ENDPUNKT DER APP IST
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// BRAUCHEN: Ein Fehler, der erst im Browser auftritt (kaputte Karte auf einem alten iPhone,
// eine Bibliothek, die auf Safari 16 anders tickt), erreicht den Server nie. Er sieht für uns
// aus wie ein zufriedener Besucher, der einfach weggeht. Ohne diese Route ist die halbe App
// — alles unter "use client", also Karte, Sheets, Chat, Upload — ein blinder Fleck.
//
// GEFÄHRLICH: Das hier ist ein SCHREIBENDER Endpunkt, den jeder im Netz aufrufen kann, und
// er schreibt in genau die Tabelle, die uns im Ernstfall den Überblick geben soll. Wer sie
// vollmüllt, macht das Logbuch unlesbar und die Datenbank voll — ohne eine einzige Lücke
// auszunutzen. Dieselbe Überlegung steht über api/track/route.ts, nur wiegt sie hier
// schwerer: Reichweitendaten sind ersetzbar, das Fehlerbild nicht.
//
// Vier Riegel, in dieser Reihenfolge (billig zuerst):
//   1. Same-Origin  — kein fremdes Skript kippt hier etwas ein.
//   2. Grössenlimit — 4 KB, danach 413. Ein Stacktrace ist kleiner.
//   3. IP-Bremse    — 20 Meldungen pro Stunde und Adresse. Ein echter Mensch erzeugt in
//                     einer Stunde keine zwanzig verschiedenen Abstürze; ein Skript schon.
//   4. Der Katalog  — `client_error` schreibt höchstens 20 Zeilen je Fingerabdruck und
//                     Fenster (siehe ROWS_PER_WINDOW in lib/ops.ts), zählt aber weiter.
//
// Was NICHT hereinkommt: Der Client bestimmt die Ereignis-Art nicht. Er darf genau eine
// melden. Sonst könnte jemand einen „Kritisch"-Alarm auslösen und uns per Fernbedienung
// Mails schicken.
import { NextResponse, after } from "next/server";
import { logOps, bumpOpsCounter, subjectFromRequest } from "@/lib/ops";
import { scrubPath, scrubText } from "@/lib/ops-scrub";
import { clientIp, classifyDevice } from "@/lib/analytics";

export const runtime = "nodejs";

/** Obergrenze je Adresse und Stunde. Grosszügig für Menschen, eng für Schleifen. */
const WINDOW_SECONDS = 3600;
const MAX_PER_IP = 20;

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* ungültig -> passt unten nicht und wird abgelehnt */
    }
    if (host !== req.headers.get("host")) {
      after(() =>
        logOps("suspicious_request", {
          message: `Fehlermeldung von fremder Herkunft (${host || "unlesbar"}) abgewiesen.`,
          path: "/api/ops/client-error",
          subject: subjectFromRequest(req),
          group: "origin:client-error",
        }),
      );
      return new NextResponse(null, { status: 403 });
    }
  }
  if (Number(req.headers.get("content-length") ?? 0) > 4000) {
    return new NextResponse(null, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const message = scrubText(body.message, 300);
  if (!message) return new NextResponse(null, { status: 204 });

  // JETZT auslesen, nicht in `after()`: Dort ist das Request-Objekt nicht mehr sicher
  // lesbar, und `clientIp(req)` wäre dann eine stille Null (dieselbe Falle wie in
  // api/track/route.ts).
  const ip = clientIp(req);
  const subject = subjectFromRequest(req);
  const device = classifyDevice(req.headers.get("user-agent"));
  const path = scrubPath(typeof body.path === "string" ? body.path : null);
  const digest = scrubText(body.digest, 40) || null;
  // Woher die Meldung kommt: aus einer React-Fehlergrenze oder von window.onerror.
  const source = body.source === "global" ? "global" : "seite";

  // Die Antwort wartet auf nichts. Ein Browser, der gerade abgestürzt ist, soll nicht auch
  // noch auf unsere Datenbank warten.
  after(async () => {
    if (ip) {
      const count = await bumpOpsCounter(`ops-client-err:${subject}`, WINDOW_SECONDS);
      if (count > MAX_PER_IP) return;
    }
    await logOps("client_error", {
      message,
      path,
      subject,
      // Nach Meldung UND Gerät gruppieren: „geht nur auf iPhones kaputt" ist die halbe
      // Diagnose, und ohne das Gerät im Fingerabdruck fällt sie unter den Tisch.
      group: `client:${device}:${message.replace(/\d+/g, "#").slice(0, 120)}`,
      detail: { geraet: device, herkunft: source, digest },
    });
  });

  return new NextResponse(null, { status: 204 });
}
