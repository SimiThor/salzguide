// Nur eigene öffentliche Storage-URLs (spot-media-Bucket) zulassen.
//
// Die EINE Stelle für diese Prüfung. Vorher stand sie dreimal wortgleich im Code
// (spotMediaUrl in admin-actions, guardStorageUrl in tour-actions und
// tour-pool-actions) – und genau die Felder ohne die Prüfung (Spot-Fotos,
// Event-Bild) waren die Lücke: Eine fremde URL in der media-Tabelle bricht
// next/image (remotePatterns erlauben nur *.supabase.co) und lässt den Server
// beim Vorschau-Rendern beliebige Adressen abrufen (SSRF).
//
// Verhalten: leer/blank -> ok mit null (Feld ist optional). Fremde URL -> { ok: false },
// der Aufrufer antwortet mit dem Fehlercode "bad_url".
export function guardStorageUrl(
  url: string | null,
): { ok: true; url: string | null } | { ok: false } {
  const clean = typeof url === "string" && url.trim() ? url.trim() : null;
  if (!clean) return { ok: true, url: null };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!base || !clean.startsWith(`${base}/storage/v1/object/public/spot-media/`))
    return { ok: false };
  return { ok: true, url: clean };
}
