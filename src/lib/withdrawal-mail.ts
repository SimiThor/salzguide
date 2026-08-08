import "server-only";
import { LEGAL, legalAddress } from "./legal";
import { fill, mailTexts } from "./mail-i18n";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";
import { bcp47, DEFAULT_LOCALE } from "@/i18n/locales";

// Die Eingangsbestätigung eines Widerrufs.
//
// PFLICHT, keine Höflichkeit: Art. 11 Abs. 3 VRRL / § 11 Abs. 2 FAGG verlangen, dass der
// Eingang einer online abgegebenen Widerrufserklärung UNVERZÜGLICH auf einem dauerhaften
// Datenträger bestätigt wird. Der Zeitpunkt gehört hinein, weil er die Frist wahrt.
//
// WARUM SIE JETZT WIE UNSERE ANDEREN MAILS AUSSIEHT: Sie war die letzte, die als nackter
// Text rausging, mit den Angaben als „Name: …"-Zeilen im Fliesstext. Ausgerechnet die Mail,
// die jemand bekommt, der gerade sein Geld zurückwill, sah damit aus wie eine Systemmeldung.
// Jetzt trägt sie denselben Rahmen wie die Kaufbestätigung, und die Angaben stehen im
// Datenblock, wo Nachschlagbares hingehört.
//
// WARUM DER WORTLAUT DEUTSCH BLEIBT, während der Rest übersetzt ist: Dieselbe Begründung wie
// bei der Kaufbestätigung, sie steht ausführlich im Kopf von pro-purchase-mail.ts. Kurz: Die
// Rechtstexte auf der Seite sind deutsch und verbindlich, eine Bestätigung kann nicht in mehr
// Sprachen gelten als der Vertrag, den sie beendet. Eine Zeile in der Sprache des Lesers sagt,
// warum dort Deutsch steht.

export type WithdrawalReceipt = {
  name: string;
  email: string;
  address: string;
  contract: string;
  orderDate: string;
  note: string;
  /** Eingangszeitpunkt (ISO). Der fristwahrende Moment. */
  receivedAt: string;
  /** Sprache des Absenders, aus der Seite, auf der das Formular stand. */
  locale: string;
};

/** Der Wortlaut und der Hinweis. DEUTSCH, siehe Kopf dieser Datei. */
const DECLARATION_DE =
  "Deine Widerrufserklärung im Wortlaut: Hiermit widerrufe ich den abgeschlossenen Vertrag " +
  "über die Erbringung der folgenden Dienstleistung: Freischaltung von SalzGuide Pro.\n\n" +
  "Hinweis: Bei digitalen Inhalten, deren Ausführung mit deiner ausdrücklichen Zustimmung " +
  "bereits begonnen hat, kann das Widerrufsrecht erloschen sein (§ 18 FAGG).";

function dateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  // Zeitzone bleibt Wien: Der Eingangszeitpunkt ist eine Tatsache über unser Geschäft und
  // muss in jeder Fassung derselbe Moment sein. Nur die Schreibweise folgt dem Leser.
  return new Intl.DateTimeFormat(bcp47(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(when);
}

async function content(r: WithdrawalReceipt): Promise<MailContent> {
  const locale = r.locale;
  const all = await mailTexts(locale);
  const t = all.withdrawal;
  const received = dateTime(r.receivedAt, locale);

  return {
    locale,
    subject: t.subject,
    headline: t.headline,
    body: fill(t.body, { name: r.name, receivedAt: received }),
    // Die Angaben so, wie sie hereingekommen sind. Leere Felder fallen raus, statt als
    // „Anschrift: —" dazustehen: Was nicht ausgefüllt wurde, gehört nicht in die Bestätigung.
    rows: [
      { label: t.rowReceived, value: received },
      { label: t.rowName, value: r.name },
      { label: t.rowEmail, value: r.email },
      ...(r.address ? [{ label: t.rowAddress, value: r.address }] : []),
      { label: t.rowContract, value: r.contract },
      ...(r.orderDate ? [{ label: t.rowOrderDate, value: r.orderDate }] : []),
      ...(r.note ? [{ label: t.rowNote, value: r.note }] : []),
    ],
    // KEIN Knopf. Sonst hat jede unserer Mails einen, und hier gibt es nichts anzutippen:
    // Der Vorgang läuft bei uns weiter, nicht bei ihm. Ein „Zur App"-Knopf unter einem
    // Widerruf wäre die Aufforderung, doch bitte dazubleiben.
    cta: null,
    // Die kurze Zeile, mit der jede unserer Mails endet. Steht hier und nicht als dritter
    // Absatz im Fliesstext: Bei einem Widerruf zählt, dass die Angaben unten stimmen, und
    // der Hinweis darauf gehört an dieselbe Stelle wie in allen anderen Mails.
    //
    // Und jetzt auch mit demselben Wortlaut: Mail.reply. Eine eigene Fassung stand hier, weil
    // es sie geben konnte, nicht weil ein Widerruf einen anderen Nachsatz braucht.
    note: all.reply,
    // Der Hinweis „das darunter steht auf Deutsch" NUR, wenn die Mail nicht deutsch ist.
    // In der deutschen Fassung wäre er die Erklärung, dass ein deutscher Text deutsch ist,
    // also genau die Zeile, über die jemand stolpert und sich fragt, was ihm entgeht.
    // Als erster Absatz des Kleingedruckten, wie in pro-purchase-mail.ts: Er kündigt an,
    // was darunter kommt, und steht deshalb direkt davor.
    fineprint: [
      locale === DEFAULT_LOCALE ? null : t.legalDe,
      DECLARATION_DE,
      `${LEGAL.company}, ${legalAddress()}, ${LEGAL.email}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** Betreff, HTML und Reintext in einem Zug — aus derselben Quelle, damit nichts driftet. */
export async function renderWithdrawal(r: WithdrawalReceipt): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const c = await content(r);
  return {
    subject: c.subject,
    html: await renderMailShell(c),
    text: await renderMailShellText(c),
  };
}
