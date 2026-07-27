// Löst „@/..." auf „src/..." auf, damit Prüf-Skripte die ECHTEN App-Module importieren
// können statt eine Kopie ihrer Logik. Aufruf:
//   node --experimental-strip-types --import ./scripts/lib/alias-hook.mjs scripts/<datei>.ts
//
// Ohne das müsste ein Skript jede Datei meiden, die irgendwo `@/` benutzt — und das sind
// genau die interessanten. Ein Prüf-Skript, das die Logik nachbaut, prüft seinen Nachbau.
//
// Die Auflösung selbst steht in alias-resolver.mjs (sie läuft in einem eigenen Thread).
import { register } from "node:module";

register("./alias-resolver.mjs", import.meta.url);
