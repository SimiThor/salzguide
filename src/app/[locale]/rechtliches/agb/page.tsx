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
        kostenlos. „SalzGuide Pro“ schaltet zusätzliche Inhalte und Funktionen frei (z. B.
        Geheimtipp-Spots, vollständige Audio-Touren, unbegrenzte Nutzung des KI-Assistenten).
        Inhalte werden laufend weiterentwickelt; ein Anspruch auf einen bestimmten Bestand einzelner
        Inhalte besteht nicht.
      </p>

      <h2>3. Registrierung &amp; Konto</h2>
      <p>
        Für bestimmte Funktionen ist ein kostenloses Konto erforderlich. Die Anmeldung erfolgt
        passwortlos (Magic-Link) oder über „Anmelden mit Google“. Du bist für die Sicherheit deines
        E-Mail- bzw. Google-Zugangs verantwortlich. Die Angaben müssen richtig und aktuell sein.
      </p>

      <h2>4. Vertragsschluss über SalzGuide Pro</h2>
      <p>
        Die Darstellung von Pro in der App ist eine Einladung zur Bestellung. Mit Klick auf den
        Zahlungs-Button gibst du ein verbindliches Angebot ab. Der Vertrag kommt zustande, sobald wir
        die Zahlung bestätigen bzw. den Zugang freischalten. Vertragssprache ist Deutsch.
      </p>

      <h2>5. Preise &amp; Zahlung</h2>
      <p>
        Es gilt der jeweils im Bestellvorgang angezeigte Preis inkl. gesetzlicher Umsatzsteuer.
        SalzGuide Pro ist eine <strong>einmalige Zahlung</strong> (kein Abo). Die Zahlungsabwicklung
        erfolgt über unseren Zahlungsdienstleister Stripe. Es gelten die dort verfügbaren
        Zahlungsarten. Eine Rechnung wird – soweit vorgesehen – elektronisch bereitgestellt.
      </p>

      <h2>6. Bereitstellung digitaler Inhalte</h2>
      <p>
        Der Pro-Zugang wird unmittelbar nach erfolgreicher Zahlung freigeschaltet und in deinem Konto
        bereitgestellt. Für die Nutzung sind ein internetfähiges Gerät und eine aktive
        Internetverbindung erforderlich.
      </p>

      <h2>7. Widerrufsrecht bei digitalen Inhalten</h2>
      <p>
        Als Verbraucher:in steht dir grundsätzlich ein 14-tägiges Widerrufsrecht zu (Details und
        Muster-Widerrufsformular siehe <Link href="/rechtliches/widerruf">Widerrufsbelehrung</Link>
        ).
      </p>
      <p>
        Bei digitalen Inhalten, die nicht auf einem körperlichen Datenträger geliefert werden,
        <strong>
          {" "}
          erlischt das Widerrufsrecht, wenn du ausdrücklich zustimmst, dass wir vor Ablauf der
          Widerrufsfrist mit der Ausführung beginnen, und du zur Kenntnis nimmst, dass du dadurch
          dein Widerrufsrecht verlierst
        </strong>{" "}
        (§ 18 Abs. 1 Z 11 FAGG). Diese Zustimmung holen wir im Bestellvorgang gesondert ein.
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
        Richtigkeit, Vollständigkeit und Aktualität; die Nutzung – insbesondere von Touren und
        Outdoor-Aktivitäten – erfolgt auf eigene Verantwortung. Wir haften unbeschränkt bei Vorsatz
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
