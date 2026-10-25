import "server-only";

import { BrouterProvider } from "./brouter";
import { LocalRoutingProvider } from "./local";
import { RoutingError, type RoutingProvider } from "./types";

export * from "./types";

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * ROUTING_URL prüfen. Das Token geht als Bearer mit jeder Anfrage raus: nur über https,
 * ausser der Dienst läuft auf dieser Maschine (Entwicklung, Prüfskripte). Eine kaputte
 * Adresse ist ein Konfigurationsfehler, kein Netzfehler.
 */
function parseRoutingUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RoutingError("config", "ROUTING_URL ist keine gültige Adresse (docs/42).");
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback(u.hostname)))
    throw new RoutingError("config", "ROUTING_URL muss mit https:// beginnen (docs/42).");
  return raw;
}

/**
 * Wählt den Routendienst (docs/42, Abschnitt 2).
 *
 * ROUTING_URL gesetzt: immer BRouter (mit ROUTING_TOKEN, wenn gesetzt). Ohne Adresse springt
 * der Testadapter ein, aber nur ausserhalb der Produktion. In Produktion ohne Dienst gibt
 * es einen klaren Fehler statt still erfundener Linien.
 *
 * `timeoutMs`: Frist für diesen Aufruf (Editor und Paket 20 s, Umrouten 8 s).
 */
export function getRoutingProvider(opts: { timeoutMs?: number } = {}): RoutingProvider {
  const url = process.env.ROUTING_URL;
  if (url) return new BrouterProvider(parseRoutingUrl(url), process.env.ROUTING_TOKEN || undefined, opts);
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production")
    throw new RoutingError("config", "Kein Routendienst eingerichtet: ROUTING_URL fehlt (docs/42).");
  return new LocalRoutingProvider();
}
