import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Vergleich eines mitgeschickten Geheimnisses in konstanter Zeit.
 *
 * Ein gewöhnliches `===` bricht beim ersten falschen Zeichen ab. Wer die Antwortzeit misst,
 * kann ein Geheimnis daran Zeichen für Zeichen erraten. Bei einem Endpunkt hinter Vercels
 * Netzwerk ist das Rauschen zwar gross, aber der richtige Vergleich kostet hier nichts.
 *
 * Erst hashen, dann vergleichen: `timingSafeEqual` wirft bei ungleich langen Puffern, und
 * die Länge des Geheimnisses wäre selbst schon eine Auskunft. Über SHA-256 sind beide Seiten
 * immer 32 Byte lang.
 *
 * Eigene Datei, seit es ZWEI Maschinen-Endpunkte gibt (Cron und der Export-Rückkanal): Die
 * Warnung, die in lib/cron-guard.ts über der Prüfung steht, gilt für sie selbst genauso.
 * Zwei Kopien einer Sicherheitsprüfung sind zwei Gelegenheiten, sie unterschiedlich zu machen.
 */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Das Geheimnis aus einem `Authorization: Bearer …`-Kopf, oder null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}
