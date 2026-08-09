// Erlaubnis-Liste der ÖFFENTLICHEN Routen unter /[locale] – die eine Quelle dafür,
// welche Pfad-FORMEN es in der App gibt. Der Proxy (src/proxy.ts) schreibt jeden Pfad,
// der hier NICHT matcht, auf den 404-Handler (src/app/404/route.ts) um. Hintergrund:
// Innerhalb des Seitenbaums kann Next seit 15.2 keine echte 404 mehr liefern, sobald
// gestreamt wird (Details im Kommentar von [locale]/[...rest]/page.tsx) – nur ein
// Route Handler darf den Status frei setzen.
//
// Erlaubnis-Liste statt Verbotsliste, wie bei declutterBasemap: Was nicht erklärt ist,
// existiert nicht. NEUE SEITE ANLEGEN => HIER EINE ZEILE ERGÄNZEN. Zwei Netze fangen
// das Vergessen: `npm run routes:check` gleicht die Liste maschinell mit dem echten
// Dateibaum unter src/app/[locale] ab, und zur Laufzeit fällt eine vergessene Route
// nicht hart aus, sondern auf die In-App-404 des Catch-alls (200+noindex).
//
// Dynamische Segmente sind bewusst [^/]+: ob ein Slug/eine ID existiert, entscheidet
// die jeweilige Seite selbst (notFound() -> In-App-404 mit noindex). Hier zählt nur
// die Form des Pfads. Statische Geschwister eines Slug-Musters (z. B. /touren/bauen)
// brauchen KEINE eigene Zeile, das Slug-Muster deckt ihre Form mit ab.
const PUBLIC_ROUTES: RegExp[] = [
  /^\/$/, // Startseite
  /^\/(explore|events|wasser|ki|gespeichert|support|ueber-uns|touren|pro|profil)$/,
  /^\/pro\/(aktivieren|rechnung)$/,
  /^\/profil\/daten$/,
  /^\/rechtliches\/(agb|datenschutz|impressum|widerruf)$/,
  /^\/spot\/[^/]+$/,
  /^\/touren\/meine\/[^/]+$/,
  /^\/touren\/[^/]+$/, // deckt auch /touren/bauen ab
  /^\/auth\/callback$/,
  /^\/admin(\/.*)?$/, // hat einen eigenen Wächter, unbekannte Unterpfade fängt er selbst
];

/** Existiert dieser Pfad (OHNE Locale-Präfix) als öffentliche Route? */
export function isPublicRoute(pathWithoutLocale: string): boolean {
  // Leerstring (nur "/de") und Trailing-Slash-Varianten auf eine Form bringen.
  const p = (pathWithoutLocale || "/").replace(/\/+$/, "") || "/";
  return PUBLIC_ROUTES.some((r) => r.test(p));
}
