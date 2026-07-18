import "server-only";
import { createServiceClient } from "./supabase/service";
import { getSpotCount } from "./spots";
import { LOCALES } from "@/i18n/locales";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";

// Die Umzugs-Mail an die Alt-Käufer: Texte aus dem Admin, Gestaltung aus dem Code.
//
// WARUM DER ADMIN NUR DIE TEXTE BEARBEITET UND NICHT DAS HTML:
// Anton wollte die Mail bearbeiten können. Ein Feld mit rohem HTML wäre die naheliegende
// Antwort und die falsche: Ein vergessenes </td> zerreisst die Mail in Outlook, und man
// sieht es erst, wenn sie bei 100 zahlenden Kunden liegt. Zurückholen kann man sie nicht.
// Also: Er schreibt die Worte, der Code baut den Rahmen. Was er tippen kann, kann nichts
// kaputtmachen — und die Vorschau zeigt genau das, was rausgeht.
//
// WARUM TABELLEN UND INLINE-STYLES (das sieht aus wie 2005, ist aber Absicht):
// Outlook rendert mit der Word-Engine. Kein flexbox, kein grid, keine externen Stylesheets,
// kein <style> im head, das man sich verlassen könnte. Was hier steht, ist der kleinste
// gemeinsame Nenner, der überall ankommt. Eine Mail, die nur in Gmail schön ist, ist keine
// schöne Mail.

/** Die Schlüssel in app_settings. Eine Stelle, damit Lesen und Schreiben nicht driften. */
export const MAIL_KEYS = {
  subject: "relaunch_mail_subject",
  headline: "relaunch_mail_headline",
  body: "relaunch_mail_body",
  cta: "relaunch_mail_cta",
} as const;

export type RelaunchMailTexts = {
  subject: string;
  headline: string;
  body: string;
  cta: string;
};

/**
 * Platzhalter für die Spot-Zahl. Wird beim Rendern durch den echten Stand ersetzt.
 *
 * Warum überhaupt ein Platzhalter, statt die Zahl hinzuschreiben: Eine getippte Zahl ist ab
 * dem nächsten Spot falsch, und eine Mail an 100 zahlende Kunden ist der schlechteste Ort,
 * um sich beim Zählen erwischen zu lassen. getSpotCount() rundet dazu nach UNTEN ("70+" bei
 * 76), damit die Aussage immer wahr bleibt.
 */
export const SPOTS_TOKEN = "{spots}";

/**
 * Platzhalter für die Zahl der Sprachen. Kommt aus LOCALES, und die Datei sagt über sich
 * selbst: "EINZIGE Quelle der Wahrheit für alle Sprachen der App". Also nicht danebenlegen.
 * Wer die zehnte Sprache einträgt, soll nicht daran denken müssen, dass eine alte Mail sie
 * verschweigt.
 */
export const LANGUAGES_TOKEN = "{languages}";

// Was drinsteht, wenn niemand etwas eingetragen hat. Nach BRAND_VOICE: Kumpel-Ton, du-Form,
// kurze Sätze, show don't sell, keine Marketing-Floskeln, kein Gedankenstrich. Der Vergleich
// mit "30 Tabs" ist ausdrücklich erlaubt (der mit einem Prospekt wäre es nicht: Prospekte
// sind für 18- bis 45-Jährige kein Referenzpunkt mehr, der Vergleich datiert uns).
export const MAIL_DEFAULTS: RelaunchMailTexts = {
  // „der", nicht „das": SalzGuide endet auf Guide, und das Genus eines Kompositums kommt
  // vom Grundwort. Duden führt „der Guide" (des Guides, die Guides), für die Person UND für
  // das Handbuch. Der Guide Michelin heisst im Deutschen aus demselben Grund „der".
  subject: "Der neue SalzGuide ist da 🏔️",
  headline: "Der neue SalzGuide ist da",
  // Ein Emoji pro Absatz, als Section-Icon (so steht es in CLAUDE.md). Es macht die
  // Aufzählung scanbar: Wer die Mail am Handy überfliegt, sieht in einer Sekunde, worum es
  // geht, ohne einen Satz zu lesen.
  body:
    // KEINE Karte im ersten Absatz mehr, obwohl sie das Herz der App ist.
    //
    // Diese Mail geht an Menschen, die schon bezahlt haben. Die hatten eine Karte mit
    // Spots. Wer sie damit begrüsst, erzählt ihnen im ersten Absatz etwas, das sie kennen,
    // und verschenkt genau den Absatz, den sie sicher lesen. Hier steht deshalb nur, was
    // es vorher NICHT gab: Toni, Events, neun Sprachen. Die Spot-Zahl fährt bei Toni mit.
    //
    // Nicht mehr "du hast die Antwort statt 30 offener Tabs": Der Vergleich sagt, was
    // WEGFÄLLT, und lässt den Leser selbst herausfinden, was er dafür bekommt. Toni
    // schlägt vor, also soll da stehen, dass er vorschlägt. Das Wetter ist gedeckt:
    // ai-assistant.ts hat ein eigenes get_weather-Werkzeug.
    `💬 Toni, unser KI-Guide, kennt alle ${SPOTS_TOKEN} Spots. Sag ihm, worauf du Lust hast, und er schlägt dir genau das vor, was zu dir passt. Aufs Wetter schaut er gleich mit.\n\n` +
    // Gedeckt durch search_events (ai-assistant.ts) und toggleSavedEvent.
    "📅 Frag ihn auch, was diese Woche läuft. Events kannst du jetzt speichern, genau wie Spots.\n\n" +
    // Das grösste neue Ding: Vorher Deutsch und Englisch, jetzt neun.
    //
    // Hier stand "Deine Gäste müssen nicht mehr raten, was eine Jausenstation ist". Der
    // Satz machte den Leser zum Gastgeber, aber der Leser IST der Nutzer. Er hat sich ein
    // Publikum erfunden, das es nicht gibt.
    //
    // Und damit die ehrliche Frage: Was bringen neun Sprachen jemandem, der Deutsch liest?
    // Direkt nichts. Also wird ihm auch kein Nutzen versprochen. Der trockene Witz sagt,
    // wie weit wir gegangen sind, ohne so zu tun, als sei das sein Gewinn. Nach BRAND_VOICE
    // ist das genau richtig: show, don't sell.
    //
    // ACHTUNG: "Koreanisch" ist an LOCALES gekoppelt (🇰🇷 ko). Fliegt die Sprache raus,
    // lügt dieser Satz. Bei einer Mail, die einmal zum Umzug rausgeht, ist das tragbar;
    // der Text lässt sich ausserdem im Admin ändern.
    `🌍 Und das alles in ${LANGUAGES_TOKEN} Sprachen statt in zwei. Sogar auf Koreanisch, falls du das brauchst.\n\n` +
    // Kein "Alle Geheimtipps offen" mehr. Das war eine Überschrift, kein Satz, und es
    // beantwortete die Frage nicht, die dieser Mensch wirklich hat: Bleibt mein Pro?
    "🎟️ Dein Pro läuft weiter. Unbegrenzt, ohne dass du nochmal zahlst.\n\n" +
    "⚡ Anmelden dauert 20 Sekunden: E-Mail rein, auf den Link tippen, drin. Passwort brauchst du keins.",
  // „ins" wäre „in das" und damit derselbe Fehler wie oben, nur versteckt.
  cta: "Rein in den neuen SalzGuide 🏔️",
};

/** Nur die Werte lesen, die jemand gesetzt hat; der Rest kommt aus MAIL_DEFAULTS. */
export async function getRelaunchMailTexts(): Promise<RelaunchMailTexts> {
  try {
    const { data } = await createServiceClient()
      .from("app_settings")
      .select("key, value")
      .in("key", Object.values(MAIL_KEYS));
    const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string | null]));
    const pick = (k: string, fallback: string) => {
      const v = map.get(k);
      // Leerer String zählt NICHT als gepflegt: Ein leergeräumtes Feld soll auf den
      // Standard zurückfallen, statt eine Mail ohne Überschrift zu verschicken.
      return typeof v === "string" && v.trim() ? v : fallback;
    };
    return {
      subject: pick(MAIL_KEYS.subject, MAIL_DEFAULTS.subject),
      headline: pick(MAIL_KEYS.headline, MAIL_DEFAULTS.headline),
      body: pick(MAIL_KEYS.body, MAIL_DEFAULTS.body),
      cta: pick(MAIL_KEYS.cta, MAIL_DEFAULTS.cta),
    };
  } catch {
    return MAIL_DEFAULTS;
  }
}

/**
 * Die Platzhalter durch den echten Stand ersetzen. Muss VOR dem Rendern laufen.
 *
 * Der Admin sieht in den Eingabefeldern weiter `{spots}` und `{languages}` statt der
 * Zahlen: Sonst würden sie beim ersten Speichern festgeschrieben und wären ab dem nächsten
 * Spot bzw. der nächsten Sprache falsch.
 *
 * Ist die Spot-Zahl nicht zu holen, steht dort "alle". Der Satz bleibt wahr und liest sich
 * genauso: "kennt alle Spots". Lieber eine Aussage ohne Zahl als eine geratene.
 */
export async function resolveTokens(texts: RelaunchMailTexts): Promise<RelaunchMailTexts> {
  let spots = "alle";
  try {
    const count = await getSpotCount();
    if (count) spots = count.rounded ? `${count.value}+` : String(count.value);
  } catch (e) {
    console.error("resolveTokens:", e);
  }
  // Die Sprachen kommen aus einer Konstante, nicht aus der Datenbank. Kein try nötig, und
  // wenn LOCALES leer wäre, hätte die App ganz andere Sorgen als diese Mail.
  const languages = String(LOCALES.length);
  const sub = (s: string) => s.split(SPOTS_TOKEN).join(spots).split(LANGUAGES_TOKEN).join(languages);
  return {
    subject: sub(texts.subject),
    headline: sub(texts.headline),
    body: sub(texts.body),
    cta: sub(texts.cta),
  };
}

/**
 * Die HTML-Fassung. `email` ist die Adresse des Empfängers und steht in der Mail, damit
 * er sieht, WELCHE er eingeben muss. Genau da scheitert es sonst: Wer drei Adressen hat,
 * probiert die falsche und denkt, sein Pro sei weg.
 *
 * Rahmen, Farben und Unterschrift kommen aus mail-layout.ts. Hier stehen nur noch die
 * Worte dieser einen Mail.
 */
export function renderRelaunchMail(texts: RelaunchMailTexts, email: string, loginUrl: string): string {
  return renderMailShell(mailContent(texts, email, loginUrl));
}

/** Die Reintext-Fassung. Kein Abklatsch: Sie muss für sich allein funktionieren. */
export function renderRelaunchText(texts: RelaunchMailTexts, email: string, loginUrl: string): string {
  return renderMailShellText(mailContent(texts, email, loginUrl));
}

/** Beide Fassungen aus derselben Quelle, damit HTML und Reintext nie auseinanderlaufen. */
function mailContent(texts: RelaunchMailTexts, email: string, loginUrl: string): MailContent {
  return {
    subject: texts.subject,
    headline: texts.headline,
    body: texts.body,
    cta: { label: texts.cta, url: loginUrl },
    tile: { label: "Melde dich mit dieser Adresse an:", value: email },
    note: "Klappt was nicht? Antworte einfach auf diese Mail, wir lesen mit.",
  };
}
