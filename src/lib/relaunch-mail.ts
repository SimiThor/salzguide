import "server-only";
import { createServiceClient } from "./supabase/service";
import { getSpotCount } from "./spots";
import { LOCALES } from "@/i18n/locales";

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
  subject: "Das neue SalzGuide ist da 🏔️",
  headline: "Das neue SalzGuide ist da",
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
  cta: "Rein ins neue SalzGuide 🏔️",
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

/** Alles, was aus einem Text-Feld kommt, muss hier durch. Sonst wäre jedes < eine Lücke. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * „SalzGuide" in der Überschrift IST das Logo, also wird es auch so gesetzt: Akzentrot,
 * fett, eng. Genau so zeichnet es der Header der App (MobileHeader.tsx: text-accent,
 * font-bold, tracking-tight). Es gibt keine Logo-Datei, das Wort selbst ist die Marke.
 *
 * WARUM NICHT ALS ZEILE DARÜBER: Da stand es, in Versalien und gesperrt. Das war doppelt
 * gemoppelt (die Überschrift sagt „Das neue SalzGuide ist da", darüber nochmal
 * „SALZGUIDE") und dazu in einer Anmutung, die unser Logo gerade NICHT hat: Versalien und
 * Sperrung sind das Gegenteil von eng gesetzter Gemischtschreibung. Jetzt trägt die
 * Überschrift die Marke selbst, und niemand liest den Namen zweimal.
 *
 * Läuft NACH esc(): Der Ersatz bringt eigenes HTML herein, das nicht escaped werden darf.
 * „SalzGuide" überlebt esc() unverändert, deshalb greift der Ersatz danach zuverlässig.
 */
function brandify(headline: string): string {
  return esc(headline)
    .split("SalzGuide")
    .join(`<span style="color:${ACCENT};">SalzGuide</span>`);
}

const ACCENT = "#cc2924";
const INK = "#111111";
const MUTED = "#6C5B57";
const CREAM = "#faf6ec";

// Der Akzent auf Weiss heruntergemischt: 6% für die Fläche, 20% für den Rand.
//
// WARUM DIE ADRESS-KACHEL NICHT CREME IST: Sie war es, und Anton sah sofort das Problem.
// Der Seitengrund ist Creme, der Block darauf ist weiss. Eine cremefarbene Kachel IM
// weissen Block hat damit exakt die Farbe des Grundes und liest sich wie ein Loch, das
// jemand hineingestanzt hat, statt wie die eine Angabe, an der die Anmeldung hängt.
// Der Blush-Ton gehört zur Marke (es ist unser Rot), ist von Weiss UND von Creme klar zu
// unterscheiden, und ohne Ausrufezeichen oder Warnsymbol liest ihn niemand als Fehler.
// Feste Hex-Werte statt rgba(): Outlook rechnet keine Transparenz.
const WASH = "#fcf2f2";
const WASH_LINE = "#f5d4d3";

/**
 * Die Verabschiedung. Ein Mensch, kein Absender-Block.
 *
 * Hier stand zuerst LEGAL.company ("Anton Steiner"), also die Zeile aus dem Impressum, und
 * genau so las sie sich auch: als Rechtstext am Ende einer Mail, die vorher wie ein Kumpel
 * klingt. Bei einer Marke, die auf "zwei echte Locals" gebaut ist, unterschreibt ein
 * Mensch, keine Firma.
 *
 * Danach stand hier "Anton von SalzGuide", aber mit dem Wort SalzGuide wieder als Logo
 * gesetzt: rot, fett, verlinkt. Damit war es keine Verabschiedung mehr, sondern eine
 * Absenderzeile mit einem Vornamen davor. Eine Unterschrift wird nicht gebrandet. Also:
 * schlichter Text, ein Zug mit der Feder, fertig.
 *
 * Der Absender bleibt trotzdem erkennbar: Die Mail kommt von EMAIL_FROM, geht mit replyTo
 * an LEGAL.email zurück, und der Knopf darüber verlinkt auf die Seite.
 */
const SIGNOFF = "Anton von SalzGuide";

/**
 * Der Gruß darüber. Ohne ihn endete die Mail mit einer Hilfe-Zeile und dann dem Namen:
 * ein Brief ohne Verabschiedung.
 *
 * "aus Salzburg" statt nur "Liebe Grüße": Der Ort ist der ganze Punkt der Marke, und es
 * kostet drei Wörter. "Servus" wäre österreichischer, liest sich aber für die Deutschen
 * unter den Empfängern eher als Begrüßung denn als Abschied.
 */
const GREETING = "Liebe Grüße aus Salzburg";

/**
 * Die HTML-Fassung. `email` ist die Adresse des Empfängers und steht in der Mail, damit
 * er sieht, WELCHE er eingeben muss. Genau da scheitert es sonst: Wer drei Adressen hat,
 * probiert die falsche und denkt, sein Pro sei weg.
 *
 * Aufbau: Überschrift mit dem Logo darin, Absätze mit je einem Emoji, Knopf, Adress-Kachel,
 * Verabschiedung. Die Mail öffnet direkt mit der Aussage, ohne Emoji davor: Über der
 * Überschrift stand ein 🏔️, und es nahm ihr die Bühne, statt sie anzukündigen. Die Emojis
 * sitzen dort, wo sie etwas markieren, nämlich an den Absätzen.
 *
 * ACHTUNG beim Bearbeiten: Das hier ist ein Template-Literal, kein JSX. `{/* … *\/}` ist
 * hier KEIN Kommentar, sondern Text, der in der Mail landet. Kommentare gehören hier
 * herauf oder in ein <!-- -->.
 */
export function renderRelaunchMail(texts: RelaunchMailTexts, email: string, loginUrl: string): string {
  const paragraphs = texts.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(texts.subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
    <tr><td style="padding:36px 32px 8px;">
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${INK};">${brandify(texts.headline)}</h1>
      ${paragraphs}
    </td></tr>

    <tr><td style="padding:8px 32px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center"
        style="border-radius:999px;background:${ACCENT};">
        <a href="${esc(loginUrl)}" style="display:block;padding:15px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(texts.cta)}</a>
      </td></tr></table>
    </td></tr>

    <tr><td style="padding:16px 32px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};border:1px solid ${WASH_LINE};border-radius:14px;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED};">Melde dich mit dieser Adresse an:</p>
          <p style="margin:5px 0 0;font-size:17px;font-weight:700;color:${INK};word-break:break-all;">${esc(email)}</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
        Klappt was nicht? Antworte einfach auf diese Mail, wir lesen mit.
      </p>
      <p style="margin:22px 0 0;font-size:15px;line-height:1.7;color:${INK};">
        ${GREETING}<br>${SIGNOFF}
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** Die Reintext-Fassung. Kein Abklatsch: Sie muss für sich allein funktionieren. */
export function renderRelaunchText(texts: RelaunchMailTexts, email: string, loginUrl: string): string {
  return (
    `${texts.headline}\n\n` +
    `${texts.body}\n\n` +
    `${texts.cta}: ${loginUrl}\n\n` +
    `Melde dich mit dieser Adresse an: ${email}\n\n` +
    `Klappt was nicht? Antworte einfach auf diese Mail.\n\n` +
    `${GREETING}\n${SIGNOFF}`
  );
}
