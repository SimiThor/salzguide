import { isOperatorClient } from "@/lib/analytics-operator";

// Messpunkt „Pro-Hinweis gesehen" (docs/34 §H): der Moment, in dem ein Gast auf gesperrten
// Pro-Inhalt stösst.
//
// WARUM ES DAS GIBT: Bis 09/2026 zählte die Messung Seitenaufrufe und Käufe, und dazwischen
// nichts. Bei einem einzigen Kauf nach dem Umzug liess sich nicht sagen, wo der Weg reisst:
// Sieht niemand die gesperrten Spots? Sehen sie sie und wollen nicht? Oder bricht die Kasse
// ab? Dieser Zähler beantwortet die erste Frage, `checkout_start` (lib/stripe-actions.ts)
// die dritte.
//
// Gezählt wird wie bei den Merkungen: eine ANZAHL mit Gerät, Land und Sprache, ohne
// Besucher-Hash. Die Datenschutzerklärung (h) sagt genau das zu.
//
// Bewusst eine eigene kleine Datei ohne Server-Importe: Die Aufrufstellen sind
// Client-Komponenten, und /api/track prüft gegen dieselbe Liste. Eine Datei, die
// `node:crypto` oder `next/headers` zieht (lib/analytics.ts), würde im Browser-Bündel
// den Build brechen.

/**
 * Wo der Hinweis erschien. Die Route nimmt NUR diese Werte an, alles andere wird verworfen,
 * sonst könnte jeder beliebigen Text in die Auswertung schreiben.
 *
 * - `sheet`: gesperrter Spot im Spot-Blatt (Explore-Regal, Pro-Pin auf jeder Karte)
 * - `spot-page`: gesperrte Spot-Seite, meist über einen alten Google-Link
 * - `related`: gesperrte Karte unter „Ähnliche Spots" auf einer freien Spot-Seite
 * - `water`: gesperrter See auf /wasser
 * - `tour-build`: Runden-Builder (Feature-Sperre, kein Spot)
 */
export const PRO_GATE_SURFACES = ["sheet", "spot-page", "related", "water", "tour-build"] as const;
export type ProGateSurface = (typeof PRO_GATE_SURFACES)[number];

export function isProGateSurface(v: unknown): v is ProGateSurface {
  return typeof v === "string" && (PRO_GATE_SURFACES as readonly string[]).includes(v);
}

/**
 * Meldet einen gesehenen Pro-Hinweis. Feuert und vergisst: Tracking darf nie etwas
 * aufhalten. Dieselben zwei Riegel wie der Seitenaufruf-Beacon (components/Analytics.tsx):
 * nur in Produktion, nie für den eingeloggten Betreiber.
 */
export function trackProGate(surface: ProGateSurface, locale: string): void {
  if (process.env.NODE_ENV !== "production") return;
  void isOperatorClient().then((operator) => {
    if (operator) return;
    void fetch("/api/track", {
      method: "POST",
      credentials: "omit", // cookieless wie der Seitenaufruf
      keepalive: true, // überlebt den Tipp auf „Pro freischalten", der die Seite wechselt
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "pro_gate", target: surface, locale }),
    }).catch(() => {});
  });
}
