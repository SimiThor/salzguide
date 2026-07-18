import "server-only";

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
export const SIGNOFF = "Anton von SalzGuide";

/**
 * Der Gruß darüber. Ohne ihn endete die Mail mit einer Hilfe-Zeile und dann dem Namen:
 * ein Brief ohne Verabschiedung.
 *
 * "aus Salzburg" statt nur "Liebe Grüße": Der Ort ist der ganze Punkt der Marke, und es
 * kostet drei Wörter. "Servus" wäre österreichischer, liest sich aber für die Deutschen
 * unter den Empfängern eher als Begrüßung denn als Abschied.
 */
export const GREETING = "Liebe Grüße aus Salzburg";

/** Was eine Mail an den Rahmen übergibt. Alles ausser `subject`/`headline` ist optional. */
export type MailContent = {
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
export function renderMailShell(c: MailContent): string {
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

  const noteBlock = c.note
    ? `
      <p style="margin:${c.tile ? "18px" : "0"} 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
        ${esc(c.note)}
      </p>`
    : "";

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;">
    <tr><td style="padding:36px 32px 8px;">
      <h1 style="margin:0 0 20px;font-size:28px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${INK};">${brandify(c.headline)}</h1>
      ${paragraphs}
    </td></tr>
${ctaRow}
    <tr><td style="padding:16px 32px 32px;">${tileBlock}${noteBlock}
      <p style="margin:22px 0 0;font-size:15px;line-height:1.7;color:${INK};">
        ${GREETING}<br>${SIGNOFF}
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** Die Reintext-Fassung. Kein Abklatsch: Sie muss für sich allein funktionieren. */
export function renderMailShellText(c: MailContent): string {
  return [
    c.headline,
    c.body,
    c.cta ? `${c.cta.label}: ${c.cta.url}` : null,
    c.tile ? `${c.tile.label} ${c.tile.value}` : null,
    c.note,
    `${GREETING}\n${SIGNOFF}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
