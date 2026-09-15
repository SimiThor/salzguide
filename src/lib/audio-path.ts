// Objekt-PFAD einer Audiodatei im privaten Bucket tour-audio, wie er aus dem Browser kommt
// (manueller MP3-Upload). Keine URL, kein "..", nur ein Dateiname mit Audio-Endung.
// Eine Datei, weil sowohl die Punkt-Actions als auch die Datei-Actions ihn brauchen.
export function guardAudioPath(
  path: string | null,
): { ok: true; path: string | null } | { ok: false } {
  const clean = typeof path === "string" && path.trim() ? path.trim() : null;
  if (!clean) return { ok: true, path: null };
  if (clean.length > 200 || clean.includes("://") || clean.startsWith("/") || clean.includes(".."))
    return { ok: false };
  if (!/^[A-Za-z0-9._/-]+\.(mp3|m4a|aac|ogg|wav)$/i.test(clean)) return { ok: false };
  return { ok: true, path: clean };
}
