// Der eigentliche Auflöser (läuft im Loader-Thread). Registriert wird er von alias-hook.mjs.
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(process.cwd() + "/src/").href;

// Nexts Server-Module (next/headers, next/server, next/cache) gibt es ausserhalb von Next nicht, und ausserhalb eines Requests wären
// sie ohnehin nicht benutzbar. Die Attrappe wirft, statt still etwas zurückzugeben: Ein
// Prüf-Skript, das versehentlich `headers()` aufruft, soll auffliegen und nicht messen.
const STUB = new URL("./next-stub.mjs", import.meta.url).href;

// `server-only` / `client-only` sind reine Marker-Pakete: Sie enthalten keinen Code, sondern
// bringen den BUNDLER zum Abbruch, wenn eine Datei auf der falschen Seite landet. Ausserhalb
// des Bundlers sind sie ein leeres Modul, und genau das ist hier richtig.
const EMPTY = "data:text/javascript,";

// `next()` liefert ein Promise, deshalb async: Ein synchrones try/catch bekäme den Fehler
// nie zu sehen und der Endungs-Nachschlag unten liefe ins Leere.
export async function resolve(specifier, context, next) {
  if (specifier === "next/headers" || specifier === "next/server" || specifier === "next/cache") {
    return { url: STUB, format: "module", shortCircuit: true };
  }
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: EMPTY, format: "module", shortCircuit: true };
  }
  const s = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
  try {
    return await next(s, context);
  } catch (err) {
    // TypeScript-Quellen importieren ohne Endung ("./supabase/service"), Node braucht sie.
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || /\.[a-z]+$/.test(s)) throw err;
    try {
      return await next(s + ".ts", context);
    } catch {
      return await next(s + "/index.ts", context);
    }
  }
}

// JSON-Importe (messages/*.json in mail-i18n.ts) trägt der Bundler ohne Attribut. Node verlangt
// `with { type: "json" }`; hier beim Laden nachreichen, damit der ECHTE Mail-Lader laufen kann
// statt eines Nachbaus im Prüf-Skript.
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    return nextLoad(url, { ...context, format: "json", importAttributes: { type: "json" } });
  }
  return nextLoad(url, context);
}
