import "server-only";
import { SOCIAL_PROFILES } from "./social";
import { mailTexts } from "./mail-i18n";
import { localeDir } from "@/i18n/locales";

// Der Rahmen für ALLE SalzGuide-Mails: Farben, Typografie, Knopf, Unterschrift.
//
// Warum das ein eigenes Modul ist: Es steckte in renderRelaunchMail() und war mit deren
// Inhalt verwoben. Bei der zweiten Mail (Pro geschenkt) hätte man es kopieren müssen, und
// ab da gäbe es zwei Wahrheiten für unser Rot und zwei Unterschriften, die beim nächsten
// Feinschliff auseinanderlaufen. Jetzt schreibt jede Mail nur noch ihre Worte.
//
// WARUM TABELLEN UND INLINE-STYLES (das sieht aus wie 2005, ist aber Absicht):
// Outlook rendert mit der Word-Engine. Kein flexbox, kein grid, keine externen Stylesheets,
// kein <style> im head, das man sich verlassen könnte. Was hier steht, ist der kleinste
// gemeinsame Nenner, der überall ankommt. Eine Mail, die nur in Gmail schön ist, ist keine
// schöne Mail.

/** Alles, was aus einem Text-Feld kommt, muss hier durch. Sonst wäre jedes < eine Lücke. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const ACCENT = "#cc2924";
export const INK = "#111111";
export const MUTED = "#6C5B57";
export const CREAM = "#faf6ec";

// Der Akzent auf Weiss heruntergemischt: 6% für die Fläche, 20% für den Rand.
//
// WARUM DIE KACHEL NICHT CREME IST: Sie war es, und Anton sah sofort das Problem.
// Der Seitengrund ist Creme, der Block darauf ist weiss. Eine cremefarbene Kachel IM
// weissen Block hat damit exakt die Farbe des Grundes und liest sich wie ein Loch, das
// jemand hineingestanzt hat, statt wie die eine Angabe, an der etwas hängt.
// Der Blush-Ton gehört zur Marke (es ist unser Rot), ist von Weiss UND von Creme klar zu
// unterscheiden, und ohne Ausrufezeichen oder Warnsymbol liest ihn niemand als Fehler.
// Feste Hex-Werte statt rgba(): Outlook rechnet keine Transparenz.
const WASH = "#fcf2f2";
const WASH_LINE = "#f5d4d3";

// Die neutrale Trennlinie für den Datenblock. Warmes Hellgrau, kein Reingrau: Der Grund ist
// Creme, ein kaltes Grau darauf sieht schmutzig aus. Fester Hex-Wert, weil Outlook keine
// Transparenz rechnet (siehe WASH).
const LINE = "#ebe6dc";

/**
 * „SalzGuide" in der Überschrift IST das Logo, also wird es auch so gesetzt: Akzentrot,
 * fett, eng. Genau so zeichnet es der Header der App (MobileHeader.tsx: text-accent,
 * font-bold, tracking-tight). Es gibt keine Logo-Datei, das Wort selbst ist die Marke.
 *
 * WARUM NICHT ALS ZEILE DARÜBER: Da stand es, in Versalien und gesperrt. Das war doppelt
 * gemoppelt (die Überschrift sagt „Der neue SalzGuide ist da", darüber nochmal
 * „SALZGUIDE") und dazu in einer Anmutung, die unser Logo gerade NICHT hat: Versalien und
 * Sperrung sind das Gegenteil von eng gesetzter Gemischtschreibung. Jetzt trägt die
 * Überschrift die Marke selbst, und niemand liest den Namen zweimal.
 *
 * Läuft NACH esc(): Der Ersatz bringt eigenes HTML herein, das nicht escaped werden darf.
 * „SalzGuide" überlebt esc() unverändert, deshalb greift der Ersatz danach zuverlässig.
 */
export function brandify(headline: string): string {
  return esc(headline)
    .split("SalzGuide")
    .join(`<span style="color:${ACCENT};">SalzGuide</span>`);
}

// GRUSS UND UNTERSCHRIFT stehen jetzt in messages/*.json unter `Mail.greeting` und
// `Mail.signoff`, in allen neun Sprachen (siehe mail-i18n.ts). Die Begründungen dahinter
// gelten unverändert und deshalb hier, wo der Rahmen sie benutzt:
//
// UNTERSCHRIFT: Ein Mensch, kein Absender-Block. Hier stand zuerst LEGAL.company ("Anton
// Steiner"), also die Zeile aus dem Impressum, und genau so las sie sich auch: als Rechtstext
// am Ende einer Mail, die vorher wie ein Kumpel klingt. Bei einer Marke, die auf "zwei echte
// Locals" gebaut ist, unterschreibt ein Mensch, keine Firma. Danach stand da "Anton von
// SalzGuide" mit dem Wort SalzGuide als Logo gesetzt: rot, fett, verlinkt. Damit war es keine
// Verabschiedung mehr, sondern eine Absenderzeile mit einem Vornamen davor. Eine Unterschrift
// wird nicht gebrandet, deshalb läuft sie NICHT durch brandify(). Der Absender bleibt trotzdem
// erkennbar: Die Mail kommt von EMAIL_FROM, geht mit replyTo an LEGAL.email zurück, und der
// Knopf darüber verlinkt auf die Seite.
//
// GRUSS: Ohne ihn endete die Mail mit einer Hilfe-Zeile und dann dem Namen, also ein Brief
// ohne Verabschiedung. "aus Salzburg" statt nur "Liebe Grüße": Der Ort ist der ganze Punkt
// der Marke, und es kostet drei Wörter.

/**
 * Die Profile am Fuss jeder Mail. Zwei Text-Links, aus derselben Quelle wie Fusszeile und
 * Menüs (lib/social.ts).
 *
 * WARUM TEXT UND KEINE ICONS: Ein Icon in einer Mail ist ein Bild von einem Server, und die
 * meisten Clients laden Bilder erst nach dem Antippen von „Bilder anzeigen". Eine Fusszeile,
 * die im Standardfall aus zwei leeren Kästchen besteht, ist schlechter als eine, die immer
 * lesbar ist. Ausserdem müsste jedes Icon als Datei gehostet und beim Umzug mitgenommen
 * werden. Text kostet nichts und kommt überall an.
 *
 * Aufzählung mit Trennzeichen statt „Instagram und TikTok": Kommt ein dritter Kanal dazu,
 * ändert sich hier nichts.
 *
 * `follow` kommt aus der Sprache des Empfängers (Mail.follow). Die Namen der Kanäle sind
 * Eigennamen und bleiben, wie sie sind.
 */
function socialFooterHtml(follow: string): string {
  const links = SOCIAL_PROFILES.map(
    (p) =>
      `<a href="${esc(p.url)}" style="color:${MUTED};text-decoration:underline;">${esc(p.label)}</a>`,
  ).join(` <span style="color:#bbb;">·</span> `);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
    <tr><td align="center" style="padding:16px 24px 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">${esc(follow)} ${links}</p>
    </td></tr>
  </table>`;
}

/** Was eine Mail an den Rahmen übergibt. Alles ausser `locale`/`subject`/`headline` ist optional. */
export type MailContent = {
  /**
   * Die Sprache des EMPFÄNGERS, nicht die des Absenders und nicht die der gerade offenen
   * Seite. Steuert Gruss, Unterschrift, Fusszeile und das `lang`-Attribut.
   *
   * PFLICHTFELD, obwohl "de" ein bequemer Standard wäre: Ein Standard hätte genau den Fehler
   * gemacht, den es hier zu verhindern gilt. Wer eine neue Mail baut und die Sprache nicht
   * durchreicht, bekommt keinen deutschen Brief an einen Koreaner, sondern einen
   * TypeScript-Fehler.
   */
  locale: string;
  /** Steht im <title> und sollte dem Betreff der Mail entsprechen. */
  subject: string;
  /** Trägt die Marke selbst, "SalzGuide" darin wird automatisch rot gesetzt. */
  headline: string;
  /** Fliesstext. Leerzeile trennt Absätze, einfacher Umbruch bleibt Umbruch. */
  body: string;
  /** Der eine Knopf. Ohne ihn hat die Mail kein Ziel, deshalb bewusst fast immer gesetzt. */
  cta?: { label: string; url: string } | null;
  /** Die Blush-Kachel für die EINE Angabe, an der etwas hängt (z.B. die Anmeldeadresse). */
  tile?: { label: string; value: string } | null;
  /** Kleine graue Zeile darunter, z.B. der Hinweis aufs Antworten. */
  note?: string | null;
  /**
   * Der Datenblock: Angaben, die zusammengehören und nachgelesen werden (Leistung, Preis,
   * Zeitpunkt, Vertragspartner). Steht zwischen Text und Knopf.
   *
   * WARUM NEUTRAL UND NICHT ALS ZWEITE BLUSH-KACHEL: Es darf nur eine hervorgehobene Sache
   * pro Mail geben, sonst hebt sich nichts mehr hervor. Die Kachel ist die EINE Angabe, an
   * der etwas hängt; dieser Block ist Nachschlagewerk. Deshalb bekommt er nur eine feine
   * Linie und keine Farbe. Als Rahmen-Baustein und nicht als Fliesstext, weil „Preis: 19,90 €"
   * in einem Absatz wie ein Tippfehler aussieht und in jeder Mail neu erfunden würde.
   *
   * Mit `url` wird der Wert zum Link (z.B. „Rechnung ansehen"). Aus demselben Grund wie bei
   * `links`: Eine Adresse im Fliesstext liefe durch esc() und bliebe blosser Text. In der
   * Reintext-Fassung steht dann die URL selbst, sonst wäre die Zeile dort eine Sackgasse.
   */
  rows?: readonly { label: string; value: string; url?: string }[] | null;
  /**
   * Das Kleingedruckte, ganz unten: Pflichtangaben, die dastehen müssen, aber nicht die
   * Nachricht sind (z.B. die dokumentierte §-18-Zustimmung in der Kaufbestätigung).
   *
   * WARUM NICHT IM `body`: Als 16px-Fliesstext ganz oben wiegen zwei Absätze Gesetzestext
   * schwerer als der Grund, aus dem die Mail kommt. Die Kaufbestätigung sah damit aus wie
   * eine Rechtsbelehrung mit Dank obendrauf, während die anderen Mails aus drei kurzen
   * Absätzen bestehen. Hier unten steht es leiser, ist aber vollständig da und auf demselben
   * dauerhaften Datenträger. Leerzeile trennt Absätze, wie im `body`.
   */
  fineprint?: string | null;
  /**
   * Kleine Links am Fuss der Nachricht (z.B. AGB, Widerrufsbelehrung, Datenschutz).
   *
   * Muss ein Baustein sein und darf nicht im `body` stehen: Der Fliesstext läuft durch esc(),
   * eine Adresse darin bleibt also blosser Text. In Gmail wird daraus vielleicht ein Link, in
   * Outlook nicht. Eine Rechtsbelehrung, deren Verweise nicht anklickbar sind, ist keine.
   */
  links?: readonly { label: string; url: string }[] | null;
};

/**
 * Die HTML-Fassung.
 *
 * Aufbau in drei Zeilen, und die Aufteilung ist die aus der Umzugs-Mail: Überschrift mit
 * dem Logo darin und die Absätze; dann der Knopf; dann Kachel, Hinweis und Verabschiedung.
 * Die Mail öffnet direkt mit der Aussage, ohne Emoji davor: Über der Überschrift stand ein
 * 🏔️, und es nahm ihr die Bühne, statt sie anzukündigen. Emojis sitzen dort, wo sie etwas
 * markieren, nämlich an den Absätzen.
 *
 * ACHTUNG beim Bearbeiten: Das hier ist ein Template-Literal, kein JSX. `{/* … *\/}` ist
 * hier KEIN Kommentar, sondern Text, der in der Mail landet. Kommentare gehören hier
 * herauf oder in ein <!-- -->.
 */
export async function renderMailShell(c: MailContent): Promise<string> {
  const t = await mailTexts(c.locale);
  const paragraphs = c.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const ctaRow = c.cta
    ? `
    <tr><td style="padding:8px 32px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center"
        style="border-radius:999px;background:${ACCENT};">
        <a href="${esc(c.cta.url)}" style="display:block;padding:15px 24px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(c.cta.label)}</a>
      </td></tr></table>
    </td></tr>`
    : "";

  const tileBlock = c.tile
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};border:1px solid ${WASH_LINE};border-radius:14px;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED};">${esc(c.tile.label)}</p>
          <p style="margin:5px 0 0;font-size:17px;font-weight:700;color:${INK};word-break:break-all;">${esc(c.tile.value)}</p>
        </td></tr>
      </table>`
    : "";

  // Der Datenblock. Eine Zeile pro Angabe, Bezeichnung links darüber, Wert darunter fett —
  // nicht zweispaltig: In 320px-Breite bricht eine Tabelle mit zwei Spalten so um, dass
  // Bezeichnung und Wert nicht mehr beieinanderstehen. Übereinander hält immer.
  const rowsBlock = c.rows?.length
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;">
        ${c.rows
          .map(
            (r, i) => `<tr><td style="padding:${i === 0 ? "14px" : "10px"} 16px ${
              i === c.rows!.length - 1 ? "14px" : "10px"
            };${i > 0 ? `border-top:1px solid ${LINE};` : ""}">
          <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">${esc(r.label)}</p>
          <p style="margin:3px 0 0;font-size:15px;line-height:1.5;font-weight:600;color:${INK};word-break:break-word;">${
            r.url
              ? `<a href="${esc(r.url)}" style="color:${INK};text-decoration:underline;">${esc(r.value)}</a>`
              : esc(r.value)
          }</p>
        </td></tr>`,
          )
          .join("")}
      </table>`
    : "";

  const noteBlock = c.note
    ? `
      <p style="margin:${c.tile ? "18px" : "0"} 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
        ${esc(c.note)}
      </p>`
    : "";

  const fineprintBlock = c.fineprint
    ? c.fineprint
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(
          (p, i) =>
            `<p style="margin:${i === 0 ? "18px" : "10px"} 0 0;font-size:13px;line-height:1.65;color:${MUTED};">${esc(p).replace(/\n/g, "<br>")}</p>`,
        )
        .join("")
    : "";

  const linksBlock = c.links?.length
    ? `
      <p style="margin:16px 0 0;font-size:13px;line-height:1.8;color:${MUTED};">
        ${c.links
          .map(
            (l) =>
              `<a href="${esc(l.url)}" style="color:${MUTED};text-decoration:underline;">${esc(l.label)}</a>`,
          )
          .join(' &nbsp;·&nbsp; ')}
      </p>`
    : "";

  // `lang` und `dir` sind kein Beiwerk: Sie sagen dem Vorleser, in welcher Sprache er die
  // Mail spricht, und Gmail entscheidet daran, ob es eine Übersetzung anbietet. Stand hier
  // fest "de", bot Gmail einem Koreaner an, seine koreanische Mail zu übersetzen.
  return `<!doctype html>
<html lang="${esc(c.locale)}" dir="${localeDir(c.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
    <tr><td style="padding:36px 32px 8px;">
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${INK};">${brandify(c.headline)}</h1>
      ${paragraphs}${rowsBlock}
    </td></tr>
${ctaRow}
    <tr><td style="padding:16px 32px 32px;">${tileBlock}${noteBlock}${fineprintBlock}${linksBlock}
      <p style="margin:22px 0 0;font-size:15px;line-height:1.7;color:${INK};">
        ${esc(t.greeting)}<br>${esc(t.signoff)}
      </p>
    </td></tr>
  </table>
  <!-- Die Profile stehen UNTER der weissen Karte, auf dem Creme-Grund: Sie gehören zur
       Fusszeile, nicht zur Nachricht. Genau so sitzt die Icon-Reihe auch in der App. -->
  ${socialFooterHtml(t.follow)}
</td></tr></table>
</body></html>`;
}

/** Die Reintext-Fassung. Kein Abklatsch: Sie muss für sich allein funktionieren. */
export async function renderMailShellText(c: MailContent): Promise<string> {
  const t = await mailTexts(c.locale);
  return [
    c.headline,
    c.body,
    // Derselbe Datenblock, nur als „Bezeichnung: Wert"-Zeilen. Er trägt bei einer
    // Kaufbestätigung die Pflichtangaben und darf in der Reintext-Fassung nicht fehlen.
    // Trägt eine Zeile einen Link, steht hier die URL: Ein „Rechnung ansehen" ohne
    // Adresse wäre im Reintext eine Sackgasse.
    c.rows?.length
      ? c.rows.map((r) => `${r.label}: ${r.url ?? r.value}`).join("\n")
      : null,
    c.cta ? `${c.cta.label}: ${c.cta.url}` : null,
    c.tile ? `${c.tile.label} ${c.tile.value}` : null,
    c.note,
    c.fineprint,
    c.links?.length ? c.links.map((l) => `${l.label}: ${l.url}`).join("\n") : null,
    `${t.greeting}\n${t.signoff}`,
    // Dieselbe Fusszeile wie in der HTML-Fassung, nur als lesbare Adressen: In der
    // Reintext-Mail gibt es keinen verlinkten Namen, ein „Instagram" ohne URL wäre eine
    // Sackgasse.
    SOCIAL_PROFILES.map((p) => `${p.label}: ${p.url}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
