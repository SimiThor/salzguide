// Marketing-Routen: öffentliche Seiten, die das Produkt für Leute erklären, die es noch
// nicht kennen. Sie tragen KEINE App-Navigation (keine Tab-Leiste, kein App-Header, keine
// schwebende Toni-Blase) — solche Chrome würde neue Besucher wahllos in die App streuen,
// statt sie durch die Story zur Karte zu führen. Sie bringen ihre eigene, reduzierte
// Navigation mit.
//
// EINE Quelle für alle Stellen, die das wissen müssen (AppChrome, ToniLauncher). Stünde
// die Prüfung überall einzeln, driften die Stellen garantiert auseinander.
//
// Pfade OHNE Sprach-Präfix — `usePathname()` aus @/i18n/navigation liefert genau das.
const MARKETING_ROUTES: readonly string[] = ["/"];

export function isMarketingRoute(pathname: string): boolean {
  return MARKETING_ROUTES.includes(pathname);
}
