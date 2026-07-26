import "server-only";
import { LEGAL, legalAddress } from "./legal";
import { siteUrl } from "./site-url";
import { renderMailShell, renderMailShellText, type MailContent } from "./mail-layout";

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
// DEUTSCH, wie die anderen beiden Mails: Die AGB legen Deutsch als Vertragssprache fest, und
// die Rechtstexte sind bewusst nur deutsch (siehe lib/legal.ts). Eine Vertragsbestätigung in
// einer Sprache zu schicken, in der die Bedingungen gar nicht gelten, wäre kein Fortschritt.
//
// AUFBAU wie bei der Umzugs- und der Geschenk-Mail, mit denselben Bausteinen aus
// mail-layout.ts: Überschrift, kurze Absätze mit Emoji, Datenblock, EIN Knopf, die Blush-
// Kachel für die Angabe, an der alles hängt, Hinweis, Rechtslinks. Die Pflichtangaben stehen
// im Datenblock und nicht im Fliesstext, weil sie nachgeschlagen und nicht gelesen werden.

export const PRO_PURCHASE_SUBJECT = "Deine Kaufbestätigung: SalzGuide Pro";

/** Datum und Uhrzeit, wie sie in eine österreichische Vertragsbestätigung gehören. */
function atDateTime(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Intl.DateTimeFormat("de-AT", {
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
};

function content(r: ProPurchaseReceipt): MailContent {
  const base = siteUrl();

  return {
    subject: PRO_PURCHASE_SUBJECT,
    // „SalzGuide" wird vom Rahmen automatisch rot gesetzt, deshalb steht es in der Überschrift
    // und nicht nochmal darüber.
    headline: "Deine Bestätigung für SalzGuide Pro",
    body:
      "Danke dir. Hier steht schwarz auf weiss, was du gekauft hast. Bewahr die Mail auf, " +
      "sie ist deine Vertragsbestätigung.\n\n" +
      (r.guest
        ? "📩 Dein Zugang läuft auf die Adresse unten. Wenn du gerade nicht schon in der App " +
          "eingeloggt bist, melde dich damit an, ohne Passwort, du bekommst einen Link zum " +
          "Antippen. Dein Pro liegt dort bereit.\n\n"
        : "🗺️ Alle Pro-Inhalte sind ab sofort für dich offen. Aufmachen, Karte anschauen, " +
          "hinfahren. Mehr ist nicht zu tun.") +
      // Nur wenn die zwei Adressen auseinandergehen. Ein Satz, der in 99 von 100 Mails
      // fehlt, aber im hundertsten die Verwirrung verhindert, die sonst als Anfrage kommt.
      (r.accountEmail && r.accountEmail !== r.email
        ? `\n\n📮 Bezahlt hast du mit ${r.email}. Dein Pro liegt aber auf deinem Konto ` +
          `${r.accountEmail}, mit dieser Adresse meldest du dich an.`
        : ""),
    rows: [
      {
        label: "Leistung",
        value:
          "SalzGuide Pro, dauerhafte Freischaltung der digitalen Inhalte: Geheimtipp-Spots mit Insider-Tipp, Wanderungen mit Route, vollständige Audio-Touren. Gratis dazu: KI-Assistent ohne Limit (unentgeltliche Zugabe, kein Preisanteil).",
      },
      {
        label: "Preis",
        value: r.price ? `${r.price} inkl. USt., einmalig, kein Abo` : "einmalig, kein Abo",
      },
      { label: "Vertragsabschluss", value: atDateTime(r.paidAt) },
      { label: "Bestellreferenz", value: r.reference },
      {
        label: "Vertragspartner",
        value: `${LEGAL.company}, ${legalAddress()}, ${LEGAL.email}`,
      },
      { label: "Vertragssprache", value: "Deutsch" },
    ],
    // Der Knopf führt dorthin, wo das Gekaufte liegt, nicht ins Profil: Dort stünde nur, DASS
    // er Pro hat, und das weiss er nach dieser Mail bereits.
    cta: { label: "Pro-Spots anschauen", url: `${base}/de/explore` },
    // Die eine hervorgehobene Angabe: Mit dieser Adresse kommt er auf jedem Gerät herein.
    tile: { label: "Dein Zugang läuft auf", value: r.accountEmail || r.email },
    note: "Fragen zum Kauf? Antworte einfach auf diese Mail, wir lesen mit.",
    // Die zwei Angaben, die § 7 Abs. 3 FAGG verlangt: die Zustimmung wörtlich bestätigt und
    // mit Zeitpunkt, dazu die Belehrung, was das für das Rücktrittsrecht heisst. Leiser
    // gesetzt als die Nachricht, aber vollständig und auf demselben dauerhaften Datenträger.
    fineprint:
      `✍️ Deine Zustimmung beim Kauf: Du hast am ${atDateTime(r.consentAt ?? r.paidAt)} ` +
      "ausdrücklich verlangt, dass wir schon vor Ablauf der Rücktrittsfrist mit der Ausführung " +
      "beginnen, also sofort freischalten. Und du hast bestätigt, zur Kenntnis genommen zu " +
      "haben, dass du dadurch bei digitalen Inhalten dein Rücktrittsrecht (Widerrufsrecht) " +
      "verlierst und bei laufenden Leistungen mit deren vollständiger Erbringung " +
      "(§ 18 Abs. 1 Z 1 und 11 FAGG).\n\n" +
      "↩️ Was das heisst: Für die freigeschalteten Inhalte ist dein 14-tägiges Rücktrittsrecht " +
      "mit der sofortigen Freischaltung erloschen. Der KI-Assistent ohne Begrenzung ist eine " +
      "unentgeltliche Zugabe und nicht Teil der bezahlten Leistung; auf ihn entfällt kein " +
      "Preisanteil. Erklären kannst du einen Rücktritt jederzeit und ohne Begründung über das " +
      "Formular in der Widerrufsbelehrung, wir bestätigen den Eingang unverzüglich per E-Mail.",
    // Anklickbar und nicht als Adresse im Fliesstext, siehe `links` in mail-layout.ts.
    links: [
      { label: "Widerrufsbelehrung", url: `${base}/de/rechtliches/widerruf` },
      { label: "AGB", url: `${base}/de/rechtliches/agb` },
      { label: "Datenschutz", url: `${base}/de/rechtliches/datenschutz` },
    ],
  };
}

export function renderProPurchaseMail(r: ProPurchaseReceipt): string {
  return renderMailShell(content(r));
}

export function renderProPurchaseText(r: ProPurchaseReceipt): string {
  return renderMailShellText(content(r));
}
