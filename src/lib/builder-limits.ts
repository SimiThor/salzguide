// Grenzen des Runden-Bauers (KI-Läufe kosten Geld: Claude und Routendienst). Client-sicher
// (keine Server-Importe): Die Web-Oberfläche nennt die Zahl im Hinweis, die Server-Teile
// (builder-quota.ts, App-API) zählen damit. EIN Zähler je Konto fuer Web UND App, so wie der
// Tageszähler von Toni.

/** Hoechstzahl gespeicherter eigener Runden je Konto. */
export const BUILDER_MAX_TOURS = 50;
/** Laeufe je Konto: 3 in 10 Minuten und 10 je 24 Stunden. */
export const BUILDER_BURST = { windowSeconds: 600, max: 3 } as const;
export const BUILDER_DAILY = { windowSeconds: 86_400, max: 10 } as const;
