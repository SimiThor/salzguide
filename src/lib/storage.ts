// Cache-Dauer für Storage-Uploads, in Sekunden als String (Supabase-Format).
//
// Ein Jahr ist hier gefahrlos, weil JEDER Upload einen frischen UUID-Pfad bekommt und
// mit upsert:false schreibt: Unter einer URL liegt für immer dasselbe Bild. Ein neues
// Foto bekommt eine neue URL – ein Cache kann also nie veralten.
//
// Ohne diesen Wert setzt Supabase max-age=3600, d.h. der Browser lädt jedes Foto
// stündlich neu. Bei einer bildlastigen Startseite ist das der Unterschied zwischen
// "lädt sofort" und "lädt jedes Mal".
//
// ACHTUNG beim Wiederverwenden: Sobald irgendwo ein FESTER Pfad + upsert:true benutzt
// wird, darf dieser Wert dort NICHT gesetzt werden – sonst friert ein altes Bild ein.
export const IMMUTABLE_CACHE_SECONDS = "31536000";

/**
 * Der öffentliche Bucket für alle Bilder und Videos der App.
 *
 * Der Name stand als lokale Konstante in image-upload.ts, blur-preview.ts und (beim Bau der
 * Instagram-Kacheln) fast ein drittes Mal daneben. Drei Kopien eines Bucket-Namens sind
 * harmlos, solange niemand den Bucket umbenennt, und genau deshalb steht er jetzt hier.
 */
export const MEDIA_BUCKET = "spot-media";

/**
 * Objekt-Pfad im Bucket aus einer öffentlichen Storage-URL zurückgewinnen (zum Löschen).
 * `null`, wenn die URL nicht aus unserem Bucket stammt.
 *
 * Das `null` ist die eigentliche Aufgabe der Funktion, nicht der Sonderfall: Ein Löschlauf
 * bekommt seine Pfade aus Datenbank-Spalten, in denen theoretisch jede URL stehen kann.
 * Was nicht sicher aus unserem Bucket kommt, wird nicht angefasst.
 *
 * Reiner String-Umbau, kein I/O — läuft deshalb im Browser wie am Server.
 */
export function storagePathFromUrl(url: string): string | null {
  const marker = `/${MEDIA_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  // Query und Anker abschneiden. Der Waisen-Sweep (storage-orphans.ts) tut das seit jeher,
  // diese Funktion nicht - und ein `?t=123` an einer URL hätte hier zu einem Pfad geführt,
  // den es im Bucket nicht gibt. `remove()` meldet darauf KEINEN Fehler, es löscht nur
  // nichts: Die Datei bliebe still liegen, und im Log stünde nichts.
  const path = url.slice(i + marker.length).split(/[?#]/)[0];
  return path ? decodeURIComponent(path) : null;
}
