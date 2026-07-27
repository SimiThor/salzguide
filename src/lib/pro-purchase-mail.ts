import "server-only";
import { LEGAL, legalAddress } from "./legal";
import { siteUrl } from "./site-url";
import { fill, mailTexts } from "./mail-i18n";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";
import { bcp47, DEFAULT_LOCALE } from "@/i18n/locales";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Kaufbestätigung. Keine Höflichkeit, sondern Bedingung (c).
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// § 18 Abs. 1 Z 11 FAGG nimmt digitale Inhalte nur dann vom Rücktrittsrecht aus, wenn DREI
// Dinge zusammenkommen: das ausdrückliche Verlangen nach sofortiger Ausführung, die
// Kenntnisnahme des Verlusts und die Bestätigung des Vertrags nach § 7 Abs. 3 FAGG.
// Die ersten zwei holt das Häkchen im Checkout ein. Die dritte gab es bis 07/2026 nicht.
//
// Ohne sie bleibt das Rücktrittsrecht bestehen, obwohl im Checkout stand, es erlösche. Und
// für digitale Inhalte gibt es dann nicht einmal Wertersatz (§ 16 FAGG nimmt sie ausdrücklich
// aus): Jemand könnte alles lesen, alle Touren hören und den vollen Preis zurückverlangen.
// Der Zahlungsbeleg von Stripe schliesst die Lücke nicht, er nennt Betrag und Produkt, aber
// keine Zustimmung, keine Widerrufsbelehrung und keine Vertragsbedingungen.
//
// § 7 Abs. 3 verlangt „auf einem dauerhaften Datenträger" und „spätestens vor Beginn der
// Dienstleistungserbringung". Deshalb geht diese Mail raus, BEVOR Pro freigeschaltet wird
// (siehe pro-purchase.ts), und deshalb ist sie eine Mail und kein Bildschirm: Eine Webseite
// ist kein dauerhafter Datenträger, ein Postfach schon.
//
// ── WARUM DAS KLEINGEDRUCKTE DEUTSCH BLEIBT, WÄHREND DER REST ÜBERSETZT IST ──
//
// Alles, was der Käufer verstehen MUSS, um zu wissen, was er gekauft hat, kommt in seiner
// Sprache: Leistung, Preis, Zeitpunkt, Vertragspartner, Bestellreferenz. Das Kleingedruckte
// darunter (die dokumentierte §-18-Zustimmung und ihre Folge) bleibt deutsch, und das ist
// eine bewusste Entscheidung, keine Lücke:
//
//   - Die AGB legen Deutsch als Vertragssprache fest, und die Rechtstexte auf der Seite sind
//     nur deutsch (lib/legal.ts, Legal.deOnly: „rechtlich verbindlich ist die deutsche
//     Fassung"). Eine Bestätigung kann nicht in mehr Sprachen gelten als der Vertrag, den
//     sie bestätigt.
//   - Dieser Absatz IST der Nachweis. Eine Übersetzung, die eine Nuance verschiebt, macht
//     den Nachweis angreifbar, und zwar genau dann, wenn er gebraucht wird.
//
// Damit das niemanden ratlos zurücklässt, steht eine Zeile in SEINER Sprache darüber
// (`purchase.legalDe`), die sagt, warum dort Deutsch steht. ANTON: Wenn ein Anwalt das
// anders sieht, ist der Umbau klein — die Texte hängen alle an messages/*.json.

/** Datum und Uhrzeit, in der Schreibweise des Empfängers. */
function dateTime(iso: string | null, locale: string): string {
  const d = iso ? new Date(iso) : new Date();
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  // Die ZEITZONE bleibt Europe/Vienna, auch für einen Käufer in Seoul: Der Zeitpunkt des
  // Vertragsabschlusses ist eine Tatsache über unser Geschäft, keine Ansichtssache. Nur die
  // Schreibweise richtet sich nach dem Leser.
  return new Intl.DateTimeFormat(bcp47(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(when);
}

export type ProPurchaseReceipt = {
  /** Die Adresse, mit der bezahlt wurde. Dorthin geht diese Mail. */
  email: string;
  /**
   * Die Adresse, unter der der Zugang liegt, also die des Kontos.
   *
   * MEISTENS DIESELBE wie oben, aber eben nicht immer: Wer eingeloggt kauft, bekommt Pro
   * auf sein KONTO gutgeschrieben (über die User-ID, nicht über die E-Mail). Hat sein
   * Stripe-Kunde keine Adresse hinterlegt, tippt er an der Kasse eine ein, und die kann eine
   * andere sein. Stünde dann hier die Zahladresse, schickte die Bestätigung ihn an ein
   * Postfach, unter dem sein Pro gar nicht liegt. Beim Gast-Kauf sind beide identisch, weil
   * das Konto genau aus der Zahladresse entsteht.
   */
  accountEmail: string;
  /** Preis, wie bezahlt (z.B. „19,90 €"). Leer, wenn Stripe nichts geliefert hat. */
  price: string;
  /** Zeitpunkt des Vertragsabschlusses (ISO), der Moment der Zahlung. */
  paidAt: string | null;
  /** Zeitpunkt der §-18-Zustimmung (ISO), aus den Stripe-Metadaten. */
  consentAt: string | null;
  /** Zahlungskennung als Bestellreferenz für Rückfragen und das Widerrufsformular. */
  reference: string;
  /**
   * Als Gast gekauft (ohne Konto davor)?
   *
   * Bewusst NICHT „hat der Auto-Login geklappt": Diese Mail geht raus, bevor das entschieden
   * ist (§ 7 Abs. 3 verlangt sie vor Beginn der Ausführung), und der Webhook weiss es nie.
   * Deshalb sagt der Gast-Absatz nur, WOMIT man hereinkommt. Das stimmt in jedem Fall, auch
   * für den, der längst in der App steht.
   */
  guest: boolean;
  /** Sprache des Käufers, aus den Stripe-Metadaten (siehe stripe-actions.ts). */
  locale: string;
};

/**
 * Das Kleingedruckte. DEUTSCH, siehe Kopf dieser Datei.
 *
 * Steht hier im Code und nicht in messages/*.json, weil es dort acht Übersetzungen anfordern
 * würde, die es nicht geben soll: `npm run i18n:check` verlangt jeden Schlüssel in jeder
 * Sprache, und genau dieser eine soll nur auf Deutsch existieren.
 */
function fineprintDe(r: ProPurchaseReceipt): string {
  return (
    `✍️ Deine Zustimmung beim Kauf: Du hast am ${dateTime(r.consentAt ?? r.paidAt, "de")} ` +
    "ausdrücklich verlangt, dass wir schon vor Ablauf der Rücktrittsfrist mit der Ausführung " +
    "beginnen, also sofort freischalten. Und du hast bestätigt, zur Kenntnis genommen zu " +
    "haben, dass du dadurch dein Rücktrittsrecht (Widerrufsrecht) für die Inhalte verlierst " +
    "(§ 18 Abs. 1 Z 11 FAGG).\n\n" +
    "↩️ Was das heisst: Für die freigeschalteten Inhalte ist dein 14-tägiges Rücktrittsrecht " +
    "mit der sofortigen Freischaltung erloschen. Der KI-Assistent ohne Begrenzung ist eine " +
    "unentgeltliche Zugabe und nicht Teil der bezahlten Leistung; auf ihn entfällt kein " +
    "Preisanteil. Erklären kannst du einen Rücktritt jederzeit und ohne Begründung über das " +
    "Formular in der Widerrufsbelehrung, wir bestätigen den Eingang unverzüglich per E-Mail."
  );
}

async function content(r: ProPurchaseReceipt): Promise<MailContent> {
  const base = siteUrl();
  const locale = r.locale;
  const all = await mailTexts(locale);
  const t = all.purchase;

  return {
    locale,
    subject: t.subject,
    // „SalzGuide" wird vom Rahmen automatisch rot gesetzt, deshalb steht es in der Überschrift
    // und nicht nochmal darüber.
    headline: t.headline,
    body:
      `${t.intro}\n\n` +
      (r.guest ? t.guest : t.member) +
      // Nur wenn die zwei Adressen auseinandergehen. Ein Satz, der in 99 von 100 Mails
      // fehlt, aber im hundertsten die Verwirrung verhindert, die sonst als Anfrage kommt.
      (r.accountEmail && r.accountEmail !== r.email
        ? `\n\n${fill(t.otherAddress, { paid: r.email, account: r.accountEmail })}`
        : ""),
    rows: [
      { label: t.rowService, value: t.rowServiceValue },
      {
        label: t.rowPrice,
        value: r.price ? fill(t.rowPriceValue, { price: r.price }) : t.rowPriceUnknown,
      },
      { label: t.rowContract, value: dateTime(r.paidAt, locale) },
      { label: t.rowReference, value: r.reference },
      {
        label: t.rowPartner,
        value: `${LEGAL.company}, ${legalAddress()}, ${LEGAL.email}`,
      },
      { label: t.rowLanguage, value: t.rowLanguageValue },
    ],
    // Der Knopf führt dorthin, wo das Gekaufte liegt, nicht ins Profil: Dort stünde nur, DASS
    // er Pro hat, und das weiss er nach dieser Mail bereits. In SEINER Sprache, sonst hört
    // die Mail beim Antippen mitten im Satz auf.
    cta: { label: t.cta, url: `${base}/${locale}/explore` },
    // Die eine hervorgehobene Angabe: Mit dieser Adresse kommt er auf jedem Gerät herein.
    tile: { label: t.tileLabel, value: r.accountEmail || r.email },
    note: t.note,
    // Die zwei Angaben, die § 7 Abs. 3 FAGG verlangt: die Zustimmung wörtlich bestätigt und
    // mit Zeitpunkt, dazu die Belehrung, was das für das Rücktrittsrecht heisst. Leiser
    // gesetzt als die Nachricht, aber vollständig und auf demselben dauerhaften Datenträger.
    // Die Zeile davor erklärt in der Sprache des Lesers, warum darunter Deutsch steht — aber
    // nur, wenn der Leser kein Deutsch liest. In der deutschen Fassung wäre sie die Erklärung,
    // dass ein deutscher Text deutsch ist, also genau die Zeile, über die jemand stolpert und
    // sich fragt, was ihm entgeht.
    fineprint:
      locale === DEFAULT_LOCALE ? fineprintDe(r) : `${t.legalDe}\n\n${fineprintDe(r)}`,
    // Anklickbar und nicht als Adresse im Fliesstext, siehe `links` in mail-layout.ts. Die
    // Rechtstexte selbst sind deutsch, deshalb zeigen die Links auf /de.
    links: [
      { label: t.linkWithdrawal, url: `${base}/de/rechtliches/widerruf` },
      { label: t.linkTerms, url: `${base}/de/rechtliches/agb` },
      { label: t.linkPrivacy, url: `${base}/de/rechtliches/datenschutz` },
    ],
  };
}

/** Betreff, HTML und Reintext in einem Zug — aus derselben Quelle, damit nichts driftet. */
export async function renderProPurchase(r: ProPurchaseReceipt): Promise<{
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
