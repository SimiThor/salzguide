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
