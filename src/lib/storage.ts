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
