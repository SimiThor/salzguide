// Sicherheits-Helfer: nur http(s)-Links als href zulassen. Verhindert
// gespeichertes XSS über `javascript:`/`data:`-URLs, die aus KI-Recherche oder
// Admin-Eingaben in Feldern wie source_url/website_url/ticket_url landen könnten
// (React rendert `javascript:`-hrefs sonst ungefiltert). Client- & server-sicher.
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    // Relative Pfade sind erlaubt (interne Links) – aber KEIN Backslash: Browser
    // normalisieren "\" zu "/", d.h. "/\evil.com" würde zu "//evil.com" (protocol-
    // relative -> Open Redirect). Nur genau ein führender "/" ohne "\" zulassen.
    if (
      trimmed.startsWith("/") &&
      !trimmed.startsWith("//") &&
      !trimmed.includes("\\")
    )
      return trimmed;
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

// Wie safeHttpUrl, erlaubt zusätzlich `tel:` und `mailto:` (Action-Tiles: Anrufen,
// E-Mail). Weiterhin blockiert: javascript:, data:, vbscript: usw.
const SAFE_SCHEMES = new Set(["http:", "https:", "tel:", "mailto:"]);
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Backslash-Bypass (siehe safeHttpUrl) auch hier ausschließen.
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.includes("\\")
  )
    return trimmed;
  try {
    return SAFE_SCHEMES.has(new URL(trimmed).protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Ein Tour-Slug, dem wir zutrauen, in einen Pfad eingesetzt zu werden. Kein Pfad, kein Link,
 * NUR der Slug.
 *
 * WARUM SO ENG: Nach dem Bezahlen soll der Gast dorthin zurück, wo er aufgehört hat, also in
 * seine laufende Runde. Der naheliegende Weg wäre, den Zielpfad mitzuschicken. Genau das ist
 * eine offene Weiterleitung: Wer den Parameter setzen kann, schickt den frisch bezahlten
 * Käufer auf eine fremde Seite, die aussieht wie unsere und nach seinen Zugangsdaten fragt.
 *
 * Deshalb reist hier nur ein Slug mit, und den Pfad baut der Server daraus selbst. Ein Wert,
 * der diese Prüfung besteht, kann den Pfad gar nicht verlassen: keine Schrägstriche, keine
 * Punkte, keine Doppelpunkte, keine Prozentzeichen, kein Backslash.
 */
export function safeTourSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const trimmed = slug.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(trimmed) ? trimmed : null;
}
