import "server-only";
import { siteUrl } from "./site-url";
import { mailTexts } from "./mail-i18n";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";

// Die Mail an jemanden, dem wir Pro geschenkt haben.
//
// WARUM DIE TEXTE NICHT IM ADMIN STEHEN (anders als bei der Umzugs-Mail):
// Die Umzugs-Mail geht einmalig an alle Alt-Käufer, sie ist eine Ansprache und Anton wollte
// an den Worten feilen können. Diese hier ist eine Quittung: Sie geht einzeln raus, immer
// aus demselben Anlass, und sagt immer dasselbe. Ein Admin-Formular dafür wären drei
// Eingabefelder, die in 99% der Fälle unangetastet bleiben und im hundertsten versehentlich
// leer sind. Ändern geht per Commit, und die Vorschau im Admin zeigt vorher, was rausgeht.
//
// DIE SPRACHE kommt aus `profiles.locale`, also aus der Sprache, in der sich dieser Mensch
// zuletzt angemeldet hat (siehe auth/callback/route.ts). Hier stand einmal, die Mail sei
// bewusst deutsch, weil `profiles.locale` zwar existiere, aber nirgends beschrieben werde und
// faktisch bei allen auf 'de' stehe. Das stimmte, und es war der Fehler, nicht der Grund:
// Der Wert wird jetzt gepflegt.

function content(locale: string, t: Awaited<ReturnType<typeof mailTexts>>): MailContent {
  return {
    locale,
    subject: t.gift.subject,
    // "SalzGuide" wird vom Rahmen automatisch rot gesetzt, deshalb steht es in der
    // Überschrift und nicht nochmal darüber.
    headline: t.gift.headline,
    body: t.gift.body,
    // Auf die Karte, nicht ins Profil: Dort ist das, was er jetzt neu sehen kann. Im Profil
    // stünde nur, DASS er Pro hat, und das weiss er nach dieser Mail bereits.
    // Der Link führt in SEINE Sprache, nicht nach /de: Eine Mail auf Koreanisch, die auf eine
    // deutsche Seite zeigt, hört mitten im Satz auf.
    cta: { label: t.gift.cta, url: `${siteUrl()}/${locale}/explore` },
    // Keine Adress-Kachel wie bei der Umzugs-Mail: Der Mensch hat schon ein Konto, er muss
    // sich nicht überlegen, mit welcher Adresse er sich anmeldet.
    tile: null,
    note: t.reply,
  };
}

/** Betreff, HTML und Reintext in einem Zug — aus derselben Quelle, damit nichts driftet. */
export async function renderProGift(locale: string): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const t = await mailTexts(locale);
  const c = content(locale, t);
  return {
    subject: c.subject,
    html: await renderMailShell(c),
    text: await renderMailShellText(c),
  };
}
