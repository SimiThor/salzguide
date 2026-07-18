import "server-only";
import { siteUrl } from "./site-url";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";

// Die Mail an jemanden, dem wir Pro geschenkt haben.
//
// WARUM DIE TEXTE HIER STEHEN UND NICHT IM ADMIN (anders als bei der Umzugs-Mail):
// Die Umzugs-Mail geht einmalig an alle Alt-Käufer, sie ist eine Ansprache und Anton wollte
// an den Worten feilen können. Diese hier ist eine Quittung: Sie geht einzeln raus, immer
// aus demselben Anlass, und sagt immer dasselbe. Ein Admin-Formular dafür wären drei
// Eingabefelder, die in 99% der Fälle unangetastet bleiben und im hundertsten versehentlich
// leer sind. Ändern geht per Commit, und die Vorschau im Admin zeigt vorher, was rausgeht.
//
// DEUTSCH, so wie die Umzugs-Mail: profiles.locale gibt es zwar seit dem ersten Commit,
// wird aber nirgends beschrieben und steht faktisch bei allen auf 'de'. Eine Sprachwahl
// vorzutäuschen, die es nicht gibt, wäre schlechter als eine ehrlich deutsche Mail.

/**
 * Betreff. Sagt die Sache im Betreff selbst, ohne "Wichtig" oder "Deine Anfrage":
 * Wer den nur in der Vorschau liest, weiss danach Bescheid.
 */
export const PRO_GIFT_SUBJECT = "Du hast SalzGuide Pro";

function content(): MailContent {
  return {
    subject: PRO_GIFT_SUBJECT,
    // "SalzGuide" wird vom Rahmen automatisch rot gesetzt, deshalb steht es in der
    // Überschrift und nicht nochmal darüber.
    headline: "SalzGuide Pro freigeschaltet",
    // Kein "wir haben dir Pro freigeschaltet" mehr: Das steht schon in der Überschrift,
    // und zweimal dasselbe Wort in zwei Zeilen liest sich wie ein Serienbrief.
    body:
      "Geht aufs Haus, du musst nichts bezahlen und nichts einlösen.\n\n" +
      "🔓 Alle Pro-Spots sind ab sofort für dich sichtbar, auch die, die sonst gesperrt sind.\n\n" +
      "🗺️ Aufmachen, Karte anschauen, hinfahren. Mehr ist nicht zu tun.",
    // Auf die Karte, nicht ins Profil: Dort ist das, was er jetzt neu sehen kann. Im Profil
    // stünde nur, DASS er Pro hat, und das weiss er nach dieser Mail bereits.
    cta: { label: "Pro-Spots anschauen", url: `${siteUrl()}/de/explore` },
    // Keine Adress-Kachel wie bei der Umzugs-Mail: Der Mensch hat schon ein Konto, er muss
    // sich nicht überlegen, mit welcher Adresse er sich anmeldet.
    tile: null,
    note: "Klappt was nicht? Antworte einfach auf diese Mail, wir lesen mit.",
  };
}

export function renderProGiftMail(): string {
  return renderMailShell(content());
}

export function renderProGiftText(): string {
  return renderMailShellText(content());
}
