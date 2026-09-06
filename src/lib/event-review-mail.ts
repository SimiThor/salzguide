import { esc, ACCENT, INK, MUTED, CREAM } from "./mail-layout";

// Die Mail, die montags kommt, wenn die KI-Wochenrecherche durch ist.
//
// WARUM ES SIE GIBT: Der Cron läuft seit jeher montags um fünf und legt die Fundstücke als
// ENTWURF an, damit nichts ungeprüft live geht. Nur sagte das niemandem jemand. Wer nicht
// von sich aus ins Admin schaut, hat einen Stapel Entwürfe, der wächst, und Veranstaltungen,
// die vorbeigehen, während sie in der Prüfliste liegen (nach vierzehn Tagen räumt
// purgeStaleDrafts sie sogar weg, siehe lib/event-research.ts). Die Freigabe von Hand ist
// gewollt, ein unsichtbarer Posteingang nicht.
//
// WARUM SIE DEN GANZEN STAPEL ZEIGT und nicht nur die Funde dieses Laufs: „Was liegt bei mir?"
// ist die Frage, mit der man montags aufs Handy schaut. Wer letzte Woche nicht dazu kam, muss
// das nicht aus zwei Mails zusammenrechnen. Nebenbei ist es der Grund, warum diese Mail
// überhaupt eine Erinnerung sein kann: Sie kommt auch dann, wenn die Recherche nichts Neues
// gefunden hat, aber noch etwas offen ist.
//
// WARUM NICHT renderMailShell() AUS mail-layout.ts: Dieselbe Begründung wie bei der Alarm-Mail
// (lib/ops-mail.ts) und der Export-Mail (lib/intro-export-mail.ts). Der Rahmen dort ist für
// Nutzer-Mails gebaut, mit Begrüssung, Unterschrift, Social-Links und Abmeldezeile in dreizehn
// Sprachen. Diese Mail geht an uns selbst, immer auf Deutsch, und hat genau einen Zweck: den
// Knopf in die Prüfliste. Übernommen sind Farben und Bauweise (Tabellen, Inline-Styles, weil
// Outlook mit der Word-Engine rendert).

/**
 * Die Adresse, die in der Mail steht. KEIN direkter Link auf die Admin-Seite.
 *
 * Der Grund ist der Klick vom Handy aus, Wochen später: Wer dort nicht mehr angemeldet ist,
 * landet auf einer Admin-Seite, die ihn wortlos aufs Profil wirft (siehe admin/layout.tsx),
 * und nach dem Anmelden auf der Karte. Das Ziel wäre weg, und man müsste sich durchklicken.
 * Diese Route prüft erst, wer da klopft, und hängt das Ziel notfalls als `next` an den Login.
 * Ein Klick, egal in welchem Zustand das Telefon ist.
 */
export const EVENTS_REVIEW_ENTRY = "/api/admin/events-review";

/**
 * Wohin diese Route weiterleitet, ohne Sprach-Präfix.
 *
 * `status=draft` setzt den Filter der Prüfliste gleich auf „Entwurf": Wer aus dieser Mail
 * kommt, will genau die sehen und sonst nichts. Die Route hängt die Sprache davor,
 * `npm run routes:check` prüft, dass es die Seite noch gibt.
 */
export const EVENTS_REVIEW_TARGET = "/admin/events?status=draft";

/** Eine Zeile der Prüfliste, schon fertig formatiert (der Server rechnet, die Mail zeigt). */
export type ReviewLine = {
  /** „Do. 10.09., 19:00" oder „Do. 10.09., ganztägig". */
  when: string;
  title: string;
  /** Ort, falls die Recherche einen gefunden hat. */
  where: string | null;
};

export type EventReviewMailInput = {
  /** Offene Entwürfe insgesamt (ab heute). Der Grund für die Mail. */
  pending: number;
  /** Die ersten davon, chronologisch. Absichtlich gekürzt, siehe LIST_LIMIT im Aufrufer. */
  lines: ReviewLine[];
  /** Wie viele Entwürfe dieser Lauf gerade neu angelegt hat. */
  found: number;
  /**
   * Der Zeitraum, den dieser Lauf durchsucht hat („08.09. bis 21.09.").
   * Null = alle Wochen waren schon protokolliert, gesucht wurde nichts.
   */
  range: string | null;
  /** Die volle Adresse für den Knopf (siehe EVENTS_REVIEW_ENTRY). */
  reviewUrl: string;
  /** Wann der Lauf fertig war. */
  at: Date;
};

export type EventReviewMail = { subject: string; html: string; text: string };

/** Zeitpunkt in der Sprache und Zone, in der Anton liest. Vercel läuft auf UTC. */
function stamp(d: Date): string {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(d);
}

function events(n: number): string {
  return n === 1 ? "1 Event" : `${n} Events`;
}

/** Die Zeilen des Datenblocks. Eine Quelle für HTML und Reintext. */
function rows(input: EventReviewMailInput): [string, string][] {
  const out: [string, string][] = [];

  // „0 neu" steht bewusst mit da, wenn der Lauf tatsächlich gesucht hat: Sonst liest sich die
  // Mail wie ein frischer Fund, obwohl der Stapel nur liegen geblieben ist.
  if (input.range) {
    out.push(["Neu gefunden", `${input.found} für ${input.range}`]);
  } else {
    out.push(["Neu gefunden", "nichts, alle Wochen waren schon durchsucht"]);
  }
  out.push(["Offen insgesamt", events(input.pending)]);
  out.push(["Lauf fertig", `${stamp(input.at)} Uhr`]);
  return out;
}

/**
 * Eine Listenzeile im Reintext, zweizeilig: Titel oben, Wann und Wo darunter.
 *
 * Nicht alles in eine Zeile: `when` trägt selbst schon einen Mittelpunkt („Fr., 31.07. ·
 * 19:00"), und mit Titel und Ort dahinter stünden vier gleiche Trennzeichen nebeneinander.
 * Man sieht dann nicht mehr, wo die Veranstaltung anfängt. Im HTML macht die Typografie
 * denselben Unterschied, dort steht der Titel fett darüber.
 */
function lineText(l: ReviewLine): string {
  const below = [l.when, l.where].filter(Boolean).join(" · ");
  return `· ${l.title}\n  ${below}`;
}

/**
 * Die Mail: drei Zahlen, die Liste, ein Knopf.
 *
 * Rein und ohne Datenbank, damit die Vorschau unter /admin/settings/mails genau das rendern
 * kann, was rausgeht, ohne dafür einen Recherche-Lauf zu brauchen.
 */
export function renderEventReviewMail(input: EventReviewMailInput): EventReviewMail {
  const subject = `[SalzGuide] ${events(input.pending)} ${
    input.pending === 1 ? "wartet" : "warten"
  } auf Freigabe`;
  const headline = `${events(input.pending)} ${
    input.pending === 1 ? "wartet" : "warten"
  } auf dich`;
  const rest = input.pending - input.lines.length;
  const hint = "Ein Tipp je Zeile: „→ live“ schaltet frei, „✕“ lehnt ab und löscht.";

  const text = [
    `WOCHENRECHERCHE: ${headline.toUpperCase()}`,
    "",
    ...rows(input).map(([k, v]) => `${k}: ${v}`),
    "",
    ...input.lines.map(lineText),
    ...(rest > 0 ? [`· und ${rest} weitere`] : []),
    "",
    `Prüfen: ${input.reviewUrl}`,
    "",
    hint,
    "",
    "(Automatische Meldung vom SalzGuide-Server.)",
  ].join("\n");

  const dataRows = rows(input)
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;color:${MUTED};font-size:13px;vertical-align:top;white-space:nowrap;">${esc(key)}</td>
          <td style="padding:8px 0;color:${INK};font-size:13px;vertical-align:top;word-break:break-word;">${esc(value)}</td>
        </tr>`,
    )
    .join("");

  // Die Liste als Tabelle mit einer Zelle je Zeile, nicht als <ul>: Outlook rückt Listen
  // unvorhersehbar ein und setzt eigene Aufzählungszeichen davor.
  const listRows = input.lines
    .map(
      (l) => `
        <tr>
          <td style="padding:9px 0;border-top:1px solid #f1ece1;">
            <div style="color:${INK};font-size:14px;font-weight:600;line-height:1.35;">${esc(l.title)}</div>
            <div style="margin-top:2px;color:${MUTED};font-size:12px;line-height:1.4;">${esc(
              [l.when, l.where].filter(Boolean).join(" · "),
            )}</div>
          </td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">

    <tr><td style="background:${ACCENT};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>

    <tr><td style="padding:24px 24px 4px 24px;">
      <div style="color:${MUTED};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Wochenrecherche</div>
      <div style="margin-top:6px;color:${INK};font-size:20px;font-weight:700;line-height:1.3;">${esc(headline)}</div>
    </td></tr>

    <tr><td style="padding:12px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${dataRows}</table>
    </td></tr>

    <tr><td style="padding:16px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${listRows}</table>
      ${
        rest > 0
          ? `<div style="margin-top:10px;color:${MUTED};font-size:12px;">und ${rest} weitere in der Liste</div>`
          : ""
      }
    </td></tr>

    <tr><td style="padding:20px 24px 0 24px;">
      <a href="${esc(input.reviewUrl)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 26px;border-radius:999px;">Events prüfen</a>
    </td></tr>

    <tr><td style="padding:14px 24px 24px 24px;">
      <div style="color:${MUTED};font-size:13px;line-height:1.55;">${esc(hint)}</div>
    </td></tr>

    <tr><td style="padding:0 24px 22px 24px;">
      <div style="border-top:1px solid #ebe6dc;padding-top:12px;color:${MUTED};font-size:11px;line-height:1.5;">
        Automatische Meldung vom SalzGuide-Server.
      </div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}
