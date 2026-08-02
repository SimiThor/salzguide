import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LegalShell from "@/components/LegalShell";
import { LEGAL, legalMetadata } from "@/lib/legal";

export const metadata: Metadata = legalMetadata("agb", "Allgemeine Geschäftsbedingungen");

export default async function AgbPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LegalShell locale={locale} title="Allgemeine Geschäftsbedingungen (AGB)" updated={LEGAL.updated}>
      <h2>1. Geltungsbereich &amp; Anbieter</h2>
      <p>
        Diese AGB gelten für die Nutzung der Anwendung {LEGAL.brand} (nachfolgend „App“) sowie für
        den kostenpflichtigen Zugang „SalzGuide Pro“. Anbieter und Vertragspartner ist{" "}
        <strong>{LEGAL.company}</strong>, {LEGAL.street}, {LEGAL.zip} {LEGAL.city},{" "}
        {LEGAL.country} (nachfolgend „wir“). Abweichenden Bedingungen wird widersprochen.
      </p>

      <h2>2. Leistungsbeschreibung</h2>
      <p>
        Die App bietet einen digitalen Reise- und Freizeitführer für das Salzburger Land mit
        kuratierten Orten, Karten, Audio-Touren und einem KI-Assistenten. Ein Grundumfang ist
        kostenlos.
      </p>
      {/* WARUM DIESE TRENNUNG SO GENAU BESCHRIEBEN IST: Digitale INHALTE und laufend erbrachte
          DIENSTLEISTUNGEN haben verschiedene Rücktrittsregeln (§ 18 Abs. 1 Z 11 gegenüber Z 1
          FAGG), und der EuGH hat am 09.07.2026 (C-234/25) klargestellt, dass die Einordnung
          objektiv erfolgt: Eine Klausel, in der der Kunde den Verlust seines Rechts bestätigt,
          bewirkt nichts, wenn die Leistung in Wahrheit eine laufende ist. Deshalb ist hier
          sauber getrennt, was bezahlt wird (Inhalte) und was dazukommt, ohne bezahlt zu werden
          (das erhöhte Toni-Tageslimit). Wer das ändert, ändert die Rechtslage mit.
          „Erhöht", NIE „ohne Limit": PRO_LIMIT in api/ai/chat/route.ts deckelt bewusst
          (Kostenschutz); der Text hier muss dem Code entsprechen, nicht umgekehrt. */}
      <p>
        <strong>Gegenstand des Kaufs von „SalzGuide Pro“ sind digitale Inhalte:</strong> die
        gesperrten Spots samt Insider-Tipp, Wanderungen mit Route sowie die vollständigen
        Audio-Touren. Sie werden mit der Zahlung dauerhaft freigeschaltet. Inhalte werden laufend
        weiterentwickelt; ein Anspruch auf einen bestimmten Bestand einzelner Inhalte besteht nicht.
      </p>
      <p>
        Der KI-Assistent „Toni“ steht allen Nutzer:innen zur Verfügung, ohne Konto und ohne Kauf,
        begrenzt auf eine Anzahl von Fragen pro Tag. Für Pro-Käufer:innen erhöhen wir dieses
        Tageslimit (derzeit 15 statt 5 Fragen).
        <strong> Diese Erhöhung ist eine unentgeltliche Zugabe und nicht Teil der bezahlten
        Leistung</strong> (siehe Punkt 5); wir können sie ändern oder einstellen, ohne dass der
        Kauf davon berührt wird. Toni beantwortet Fragen anhand unserer eigenen Inhalte. Bist du
        angemeldet, nutzt er deinen gespeicherten Chat-Verlauf und die Art deiner gemerkten Spots
        für passendere Antworten; ein Werbeprofil entsteht daraus nicht (Details in der
        Datenschutzerklärung, Punkt 3d).
      </p>

      <h2>3. Registrierung &amp; Konto</h2>
      <p>
        Für bestimmte Funktionen ist ein kostenloses Konto erforderlich. Die Anmeldung erfolgt
        passwortlos (Magic-Link) oder über „Anmelden mit Google“. Du bist für die Sicherheit deines
        E-Mail- bzw. Google-Zugangs verantwortlich. Die Angaben müssen richtig und aktuell sein.
      </p>
      {/* Muss beschreiben, was der Code WIRKLICH tut: Seit 07/2026 läuft der Kauf ohne Konto
          davor, und das Konto entsteht aus der bei Stripe angegebenen Adresse (siehe
          lib/pro-purchase.ts). Stand hier weiterhin nur „für den Kauf ist ein Konto nötig",
          wären die AGB an der einzigen Stelle falsch, an der Geld fließt. */}
      <p>
        <strong>Für den Kauf von SalzGuide Pro brauchst du vorher kein Konto.</strong> Du bezahlst
        zuerst; das Konto entsteht danach automatisch aus der E-Mail-Adresse, die du im Bezahlvorgang
        angegeben hast. Den Zugang dazu erhältst du passwortlos per Link an genau diese Adresse. Gib
        deshalb eine Adresse an, auf die du Zugriff hast: Sie ist dein Zugang zu Pro auf allen
        Geräten. Hast du mit dieser Adresse schon ein Konto, wird Pro diesem Konto zugeordnet.
      </p>

      <h2>4. Vertragsschluss über SalzGuide Pro</h2>
      <p>
        Die Darstellung von Pro in der App ist eine Einladung zur Bestellung. Mit Klick auf
        „Jetzt kaufen“ gibst du eine verbindliche, zahlungspflichtige Bestellung ab; die Zahlung
        selbst wickelst du anschließend bei unserem Zahlungsdienstleister ab. Der Vertrag kommt
        zustande, sobald wir die Zahlung bestätigen bzw. den Zugang freischalten. Vertragssprache
        ist Deutsch.
      </p>
      <p>
        Unmittelbar nach dem Kauf senden wir dir die Bestätigung des Vertrags auf einem dauerhaften
        Datenträger per E-Mail (§ 7 Abs. 3 FAGG). Sie enthält die Leistung, den bezahlten Preis, den
        Zeitpunkt, die Bestellreferenz, unsere Kontaktdaten sowie deine im Bestellvorgang erteilte
        Zustimmung samt Belehrung zum Rücktrittsrecht. Bewahre diese E-Mail auf.
      </p>

      <h2>5. Preise &amp; Zahlung</h2>
      <p>
        Es gilt der jeweils im Bestellvorgang angezeigte Preis inkl. gesetzlicher Umsatzsteuer.
        SalzGuide Pro ist eine <strong>einmalige Zahlung</strong> (kein Abo). Der Kaufpreis
        entfällt zur Gänze auf die digitalen Inhalte nach Punkt 2; auf die unentgeltliche Zugabe
        (erhöhtes Toni-Tageslimit) entfällt kein Preisanteil. Die Zahlungsabwicklung
        erfolgt über unseren Zahlungsdienstleister Stripe. Es gelten die dort verfügbaren
        Zahlungsarten. Eine Rechnung wird – soweit vorgesehen – elektronisch bereitgestellt.
      </p>

      <h2>6. Bereitstellung digitaler Inhalte</h2>
      <p>
        Der Pro-Zugang wird unmittelbar nach erfolgreicher Zahlung freigeschaltet. Hast du kein Konto,
        entsteht es dabei aus der von dir angegebenen E-Mail-Adresse (siehe Punkt 3); dein Zugang
        steht ab diesem Moment bereit, auch wenn du dich erst später anmeldest. Für die Nutzung sind
        ein internetfähiges Gerät und eine aktive Internetverbindung erforderlich.
      </p>

      <h2>7. Rücktritts- bzw. Widerrufsrecht</h2>
      {/* Der Abschnitt trägt zwei Namen, weil das Gesetz und die Umgangssprache
          auseinandergehen: Das FAGG spricht von „Rücktritt", die EU-Richtlinie und der
          Widerrufsbutton aus dem VerbRÄG 2026 von „Widerruf". Beide Bezeichnungen sind
          zulässig; die App verwendet sie gleichbedeutend, damit niemand zwei Rechte vermutet,
          wo es eines gibt. Der Rest muss beschreiben, was der Code TUT: Die Bestätigung nach
          § 7 Abs. 3 FAGG geht jetzt raus (lib/pro-purchase-mail.ts), und sie ist die dritte
          Bedingung dafür, dass das Recht überhaupt erlischt. Ohne sie stünde hier eine
          Behauptung, die nicht gilt. */}
      <p>
        Als Verbraucher:in steht dir ein 14-tägiges Rücktrittsrecht zu, das auch Widerrufsrecht
        genannt wird; das FAGG spricht von Rücktritt, die europäische Richtlinie von Widerruf. Wir
        verwenden beide Wörter gleichbedeutend. Details, Fristen und das Muster-Formular findest du in
        der <Link href="/rechtliches/widerruf">Widerrufsbelehrung</Link>; erklären kannst du den
        Rücktritt jederzeit login-frei über das dortige Formular.
      </p>
      <p>
        Bei digitalen Inhalten, die nicht auf einem körperlichen Datenträger geliefert werden,
        <strong>
          {" "}
          erlischt dieses Recht, wenn du ausdrücklich verlangst, dass wir vor Ablauf der Frist mit
          der Ausführung beginnen, du zur Kenntnis nimmst, dass du es dadurch verlierst, und wir dir
          die Vertragsbestätigung auf einem dauerhaften Datenträger zur Verfügung gestellt haben
        </strong>{" "}
        (§ 18 Abs. 1 Z 11 FAGG). Zustimmung und Kenntnisnahme holen wir im Bestellvorgang gesondert
        ein; die Bestätigung senden wir dir unmittelbar nach dem Kauf per E-Mail (siehe Punkt 4).
      </p>
      <p>
        Die unentgeltliche Zugabe (erhöhtes Toni-Tageslimit, Punkt 2) ist nicht Teil der
        bezahlten Leistung. Auf sie entfällt kein Preisanteil, es gibt für sie also nichts
        zurückzuzahlen. Würde ein laufend erbrachter Teil dennoch als entgeltlich angesehen, bliebe
        das Rücktrittsrecht insoweit bis zur vollständigen Erbringung bestehen und ein Wertersatz
        bemäße sich nach § 16 FAGG; für die bereitgestellten digitalen Inhalte fällt kein Wertersatz
        an.
      </p>

      <h2>8. Nutzungsrechte &amp; Pflichten</h2>
      <p>
        Wir räumen dir ein einfaches, nicht übertragbares Recht zur persönlichen, nicht-kommerziellen
        Nutzung der App und der Pro-Inhalte ein. Nicht gestattet sind insbesondere: Weitergabe von
        Zugangsdaten, automatisiertes Auslesen (Scraping), Umgehung technischer Schutzmaßnahmen,
        missbräuchliche Nutzung des KI-Assistenten sowie jede Vervielfältigung oder öffentliche
        Zugänglichmachung der Inhalte über den privaten Gebrauch hinaus.
      </p>

      <h2>9. Verfügbarkeit &amp; Änderungen</h2>
      <p>
        Wir bemühen uns um einen möglichst unterbrechungsfreien Betrieb, schulden jedoch keine
        bestimmte Verfügbarkeit. Wartung, Weiterentwicklung und technisch bedingte Ausfälle sind
        möglich. Funktionen und Inhalte können angepasst werden, solange der wesentliche
        Vertragszweck von Pro erhalten bleibt.
      </p>

      <h2>10. Gewährleistung &amp; Haftung</h2>
      <p>
        Es gelten die gesetzlichen Gewährleistungsrechte. Für unentgeltliche Inhalte (z. B. Wege-,
        Wetter-, Öffnungszeiten- und Veranstaltungsangaben) übernehmen wir keine Gewähr für
        Richtigkeit, Vollständigkeit und Aktualität. Unabhängig davon, ob ein Inhalt kostenlos oder
        Teil von Pro ist, gilt: Wanderungen, Touren und Outdoor-Aktivitäten unternimmst du auf
        eigene Verantwortung. Unsere Wege-, Zeit- und Schwierigkeitsangaben sind Anhaltspunkte und
        ersetzen weder eigene Einschätzung noch Ausrüstung, Kondition und aktuelle Verhältnisse
        (Wetter, Schnee, Sperren). Wir haften unbeschränkt bei Vorsatz
        und grober Fahrlässigkeit sowie bei Personenschäden. Bei leichter Fahrlässigkeit haften wir
        nur für die Verletzung wesentlicher Vertragspflichten und begrenzt auf den vertragstypisch
        vorhersehbaren Schaden. Zwingende Verbraucherschutzbestimmungen bleiben unberührt.
      </p>

      <h2>11. Laufzeit, Kündigung &amp; Kontolöschung</h2>
      <p>
        SalzGuide Pro ist eine Einmalzahlung ohne laufende Verpflichtung. Dein kostenloses Konto
        kannst du jederzeit selbst im Bereich{" "}
        <Link href="/profil/daten">„Deine Daten &amp; Datenschutz“</Link> löschen. Mit der
        Kontolöschung
        endet auch der Zugang zu Pro-Inhalten.
      </p>

      <h2>12. Änderung dieser AGB</h2>
      <p>
        Wir können diese AGB mit Wirkung für die Zukunft ändern, etwa bei geänderter Rechtslage oder
        neuen Funktionen. Über wesentliche Änderungen informieren wir in geeigneter Weise. Es gilt
        die jeweils hier veröffentlichte Fassung (Stand siehe oben).
      </p>

      <h2>13. Anwendbares Recht &amp; Gerichtsstand</h2>
      <p>
        Es gilt österreichisches Recht unter Ausschluss der Verweisungsnormen und des UN-Kaufrechts.
        Zwingende Schutzbestimmungen des Staates, in dem du als Verbraucher:in deinen gewöhnlichen
        Aufenthalt hast, bleiben unberührt. Gegenüber Verbraucher:innen gelten die gesetzlichen
        Gerichtsstände.
      </p>

      <h2>14. Datenschutz</h2>
      <p>
        Informationen zur Verarbeitung deiner personenbezogenen Daten findest du in unserer{" "}
        <Link href="/rechtliches/datenschutz">Datenschutzerklärung</Link>.
      </p>

      <h2>15. Schlussbestimmungen</h2>
      <p>
        Sollte eine Bestimmung unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen
        unberührt. Kontakt: <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </p>
    </LegalShell>
  );
}
