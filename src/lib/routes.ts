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

// Vollflächige Karten-Ansichten: Die Karte liegt als `fixed inset-0 z-0` über dem
// Dokumentfluss. Alles, was normal im Fluss steht, malt der Browser DARUNTER (positioniert
// schlägt statisch) — es ist unsichtbar, aber weiterhin mit Tab erreichbar, wird von der
// Sprachausgabe vorgelesen und macht das Dokument um seine Höhe scrollbar: Am iPhone zieht
// man dann die fixe Karte am Gummiband, ohne zu wissen, woran. Solche Inhalte (heute: die
// Rechts-Fußzeile) gehören dort deshalb gar nicht gerendert.
//
// Die Prüfung stand vorher IN der Fußzeile und ist genau daran schon einmal gedriftet: Bis
// 07/2026 war dort nur „/" gelistet (damals die Karte), /wasser hatte dieselbe Vollbild-Karte
// und fehlte — die Fußzeile lag dort von Anfang an hinter der Karte. Hier steht sie neben
// isMarketingRoute, wo Routen-Wissen hingehört, und mit dabei steht, WER sie erfüllt:
//   /explore                     -> components/Explore.tsx
//   /wasser                      -> components/WaterExplore.tsx
//   /touren/<slug>               -> components/tours/TourView.tsx
//   /touren/meine/<id>           -> components/tours/TourView.tsx
//   /touren/<slug>/navigation    -> components/tours/nav/BikeNavScreen.tsx
// NICHT dabei: /touren (normale Liste) und /touren/bauen (TourBuilder läuft im Fluss, dort
// gehört die Fußzeile sichtbar hin).
//
// Wer eine neue Vollbild-Karte baut, ändert diese Funktion — sonst hängt die nächste
// unsichtbare Fußzeile hinter ihr.
const FULLSCREEN_MAP_ROUTES: readonly string[] = ["/explore", "/wasser"];

export function isFullscreenMapRoute(pathname: string): boolean {
  if (FULLSCREEN_MAP_ROUTES.includes(pathname)) return true;
  return pathname.startsWith("/touren/") && pathname !== "/touren/bauen";
}

// Vollständig eigene Bildschirme OHNE jede App-Navigation drumherum: zusätzlich zu dem,
// was isFullscreenMapRoute schon abdeckt (die Fussleiste), fällt hier auch noch Header,
// Tab-Leiste und die schwebende Toni-Blase weg. Heute nur die S-Bike-Turn-by-Turn-
// Navigation (docs/40): Auf dem Fahrrad ist jede Fläche, die einen wegnavigieren kann,
// ein Sicherheitsrisiko, und Tab-Leiste/Toni-Blase fressen dort genau den Platz, den die
// Abbiege-Anzeige braucht. Eine normale Tour-Detailseite (/touren/<slug>) behält Header
// UND Tab-Leiste, nur die Fussleiste ist dort schon weg (isFullscreenMapRoute) – diese
// Funktion prüft ZUSÄTZLICH, nicht ANSTELLE davon.
//
// Wer einen weiteren so immersiven Screen baut, ergänzt ihn HIER statt an AppChrome/
// ToniLauncher einzeln vorbeizuprüfen – siehe die Begründung bei isFullscreenMapRoute.
export function isImmersiveRoute(pathname: string): boolean {
  return /^\/touren\/[^/]+\/navigation$/.test(pathname);
}
