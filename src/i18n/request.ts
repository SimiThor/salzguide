import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
import de from "../../messages/de.json";

// Fehlt ein Key in einer Sprachdatei, rendert next-intl 4 den ROHEN Key-Pfad in die Seite:
// ein Koreaner sieht dann wörtlich „Home.heroTitle" im Button. HTTP 200, kein Build-Fehler,
// nur eine Konsolenzeile — im Persona-Test war genau das das Urteil: „die Seite ist kaputt,
// wenn die nicht mal ihre eigene Website hinkriegen, warum soll ich denen trauen?"
//
// Deshalb tief mit Deutsch (SOURCE_LOCALE) mergen: eine fehlende Übersetzung sieht dann nach
// einer Seite aus, die noch nicht übersetzt ist — nicht nach einer kaputten Seite. Das ist ein
// NETZ, kein Ersatz für Übersetzungen: `npm run i18n:check` bleibt die Instanz, die Lücken
// findet, denn genau diese Lücken macht der Merge ja unsichtbar.
type Messages = Record<string, unknown>;

function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key];
    // Nur echte Objekte weiter verschmelzen — Arrays (z. B. Ai.launcherBubbles) müssen
    // GANZ aus der Zielsprache kommen. Elementweise gemischt käme sonst eine halb
    // deutsche, halb koreanische Liste heraus.
    out[key] =
      prev && typeof prev === "object" && !Array.isArray(prev) &&
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(prev as Messages, value as Messages)
        : value;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages =
    locale === routing.defaultLocale
      ? (de as Messages)
      : deepMerge(
          de as Messages,
          (await import(`../../messages/${locale}.json`)).default as Messages,
        );

  return { locale, messages };
});
