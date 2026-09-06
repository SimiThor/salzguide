// Clean-Fassungen der Intro-Videos auf Abruf: die gemeinsamen Festlegungen.
//
// KEIN `import "server-only"`, und das ist Absicht, keine Nachlässigkeit: Diese Datei wird
// AUCH von scripts/render-intro.ts geladen, das per `node --experimental-strip-types` läuft
// und keinen Next-Build kennt. Ein server-only-Import darin würde nicht nur das Skript
// kippen, sondern über die Importkette jede Seite der App (das ist schon passiert, siehe
// die Notiz „server-only kippt alles"). Deshalb steht hier ausschliesslich, was ohne Server
// gilt: Namen, Fristen, Pfadform. Alles, was einen Supabase-Client oder Secrets braucht,
// steht in lib/intro-export-server.ts.
//
// DIE EINE ZAHL: EXPORT_TTL_DAYS wird an DREI Stellen gebraucht, und wenn die auseinander
// laufen, merkt es niemand rechtzeitig:
//   1. die Gültigkeit der Signed-URL in der Mail,
//   2. der Satz „gültig bis …" im Mailtext,
//   3. der tägliche Aufräum-Lauf, der die Datei wieder löscht.
// Ist (3) kürzer als (1), zeigt die Mail auf eine Datei, die es nicht mehr gibt. Ist (3)
// länger, liegt Rohmaterial herum, das niemand mehr laden kann. Deshalb eine Konstante.

/** Privater Bucket (Migration 0067). Kein Public-Read, Download nur per Signed-URL. */
export const EXPORT_BUCKET = "exports";

/** Unterordner im Bucket. Der Aufräum-Lauf listet genau diesen. */
export const EXPORT_DIR = "intro-clean";

/** Wie lange eine angeforderte Clean-Fassung abholbar ist. Siehe Kommentar oben. */
export const EXPORT_TTL_DAYS = 7;

/**
 * Wohin der Runner die fertige Datei legt.
 *
 * Mit Zeitstempel statt festem Namen je Spot: Fordert man denselben Spot zweimal an, sind es
 * zwei Dateien. Das ist gewollt. Bei einem festen Namen würde der zweite Export den ersten
 * überschreiben, und der Link aus der ERSTEN Mail lieferte plötzlich ein anderes Video als
 * angekündigt (dazu die Frage, ob das CDN die alte Fassung noch ausliefert). Bei ~6 MB je
 * Datei und sieben Tagen Frist ist der Platz kein Argument.
 */
export function introExportPath(slug: string, when: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${when.getUTCFullYear()}${p(when.getUTCMonth() + 1)}${p(when.getUTCDate())}` +
    `-${p(when.getUTCHours())}${p(when.getUTCMinutes())}`;
  return `${EXPORT_DIR}/${slug}-${stamp}.mp4`;
}

/**
 * Der Dateiname, unter dem der Download landet.
 *
 * Er steht in der Signed-URL (`?download=…`) und ist der Grund, warum ein Tipp am iPhone die
 * Datei SPEICHERT, statt sie nur abzuspielen: Ohne diesen Parameter liefert Supabase
 * `Content-Disposition: inline`, Safari zeigt einen Player, und das Video liegt nirgends.
 */
export function introExportFileName(slug: string): string {
  return `intro-${slug}-clean.mp4`;
}

/**
 * Ist das ein Pfad, für den wir einen Link ausstellen dürfen?
 *
 * Der Pfad kommt vom GitHub-Runner, also von aussen. Ohne diese Prüfung könnte, wer das
 * Secret hat, sich eine Signed-URL auf JEDE Datei im Bucket ausstellen lassen. Der Bucket
 * enthält heute nur Exporte, aber diese Route soll nicht der Grund sein, warum das so
 * bleiben muss.
 */
export function isIntroExportPath(path: string): boolean {
  return /^intro-clean\/[a-z0-9-]+-\d{8}-\d{4}\.mp4$/.test(path);
}

/** Wann ein jetzt erzeugter Link abläuft. Eine Rechnung, damit Mail und Löschung sie teilen. */
export function introExportExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
}
