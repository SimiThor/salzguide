import "server-only";
import de from "../../messages/de.json";
import { DEFAULT_LOCALE, safeLocale } from "@/i18n/locales";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Worte aller Mails, in jeder Sprache. Eine Quelle.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM IN messages/*.json UND NICHT IN EINE EIGENE TS-DATEI:
// Weil dort schon ein Wächter steht. `npm run i18n:check` vergleicht alle neun Dateien
// gegen Deutsch und meldet fehlende Schlüssel, verschobene Platzhalter und Gedankenstriche.
// Eine eigene Tabelle im Code hätte diesen Wächter nicht, und eine Mail ist der schlechteste
// Ort für eine Lücke: Eine halbe Seite kann man nachbessern, eine verschickte Mail nicht.
//
// WARUM TROTZDEM EIN EIGENER LADER UND NICHT next-intl:
// Zwei Gründe, und beide sind Fallen, in die man genau einmal tappt.
//   1. Mails entstehen auch dort, wo es keine Anfrage mit Sprache gibt: Der Stripe-Webhook
//      ruft niemand über /de oder /ko auf, er kommt von Stripes Servern. next-intl holt
//      seine Sprache aus dem Anfrage-Kontext; hier gibt es keinen. Dieser Lader nimmt die
//      Sprache als Argument und funktioniert überall gleich.
//   2. `Mail` gehört NICHT in den Browser. Der Layout-Provider schickt sonst jeden
//      Mail-Text an jeden Besucher (siehe app/[locale]/layout.tsx, dort wird der
//      Namensraum wieder herausgenommen).
//
// FEHLT EINE ÜBERSETZUNG, steht Deutsch da und nicht „undefined". Dieselbe Entscheidung wie
// in i18n/request.ts, aus demselben Grund: Ein deutscher Satz sieht nach einer Sprache aus,
// die noch fehlt. „undefined" sieht nach einer kaputten Firma aus.

export type MailTexts = (typeof de)["Mail"];

type Dict = Record<string, unknown>;

/** Deutsch als Netz unter jede Sprache legen. Bewusst dieselbe Bauart wie i18n/request.ts. */
function deepMerge(base: Dict, override: Dict): Dict {
  const out: Dict = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key];
    out[key] =
      prev && typeof prev === "object" && !Array.isArray(prev) &&
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(prev as Dict, value as Dict)
        : value;
  }
  return out;
}

// Einmal je Sprache laden. Der Stripe-Webhook und der Anmelde-Versand laufen oft, und die
// Datei ändert sich zur Laufzeit nie.
const cache = new Map<string, MailTexts>();

/**
 * Die Mail-Texte einer Sprache. `locale` darf roh hereinkommen, safeLocale() nagelt ihn fest.
 *
 * Wirft nie: Ist die Sprachdatei kaputt oder fehlt sie, kommt Deutsch zurück. Eine Mail, die
 * gar nicht rausgeht, ist schlechter als eine in der falschen Sprache.
 */
export async function mailTexts(locale: string): Promise<MailTexts> {
  const code = safeLocale(locale);
  const hit = cache.get(code);
  if (hit) return hit;

  let texts = de.Mail as MailTexts;
  if (code !== DEFAULT_LOCALE) {
    try {
      const mod = (await import(`../../messages/${code}.json`)) as {
        default: { Mail?: Dict };
      };
      if (mod.default?.Mail) {
        texts = deepMerge(de.Mail as Dict, mod.default.Mail) as MailTexts;
      }
    } catch (e) {
      console.error("[mail] Sprachdatei nicht ladbar, fällt auf Deutsch zurück:", code, e);
    }
  }
  cache.set(code, texts);
  return texts;
}

/**
 * Platzhalter füllen: `fill("Hallo {name}", { name: "Anna" })`.
 *
 * Absichtlich winzig und ohne ICU: In einer Mail gibt es keine Pluralformen und keine
 * Datums-Formate, nur Einsetzungen. `npm run i18n:check` prüft die Platzhalter aller neun
 * Sprachen gegen Deutsch, deshalb kann hier kein unbekannter Name auftauchen.
 *
 * Ein fehlender Wert lässt den Platzhalter stehen, statt „undefined" zu schreiben: So sieht
 * man in der Vorschau sofort, was nicht gefüllt wurde.
 */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => vars[key] ?? all);
}
