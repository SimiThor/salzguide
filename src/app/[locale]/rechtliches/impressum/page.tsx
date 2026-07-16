import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import LegalShell from "@/components/LegalShell";
import { LEGAL, legalAddress, legalMetadata } from "@/lib/legal";

export const metadata: Metadata = legalMetadata("impressum", "Impressum");

export default async function ImpressumPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LegalShell locale={locale} title="Impressum" updated={LEGAL.updated}>
      <p>
        Offenlegung gemäß §&nbsp;5 E-Commerce-Gesetz (ECG), §&nbsp;14 Unternehmensgesetzbuch
        (UGB) und §&nbsp;25 Mediengesetz (MedienG).
      </p>

      <h2>Medieninhaber &amp; Diensteanbieter</h2>
      <p>
        <strong>{LEGAL.company}</strong> ({LEGAL.legalForm})
        <br />
        {legalAddress()}
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
        <br />
        Telefon: {LEGAL.phone}
      </p>

      <h2>Unternehmensgegenstand</h2>
      <p>{LEGAL.trade}</p>

      <h2>Umsatzsteuer &amp; Gewerbe</h2>
      <p>
        UID-Nummer: {LEGAL.vatId}
        <br />
        GISA-Zahl: {LEGAL.gisa}
      </p>

      <h2>Gewerbe &amp; Aufsicht</h2>
      <p>
        Mitglied der {LEGAL.chamber}.
        <br />
        Gewerbebehörde: {LEGAL.authority}
        <br />
        Berufsrecht: Gewerbeordnung (GewO), abrufbar unter{" "}
        <a href="https://www.ris.bka.gv.at" target="_blank" rel="noopener noreferrer">
          www.ris.bka.gv.at
        </a>
        .
      </p>

      <h2>Grundlegende Richtung (Blattlinie)</h2>
      <p>{LEGAL.editorialLine}</p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        Die Europäische Online-Streitbeilegungs-Plattform (OS-Plattform) wurde mit
        20.&nbsp;Juli&nbsp;2025 eingestellt; ein Link darauf entfällt daher. Wir sind nicht
        verpflichtet und grundsätzlich nicht bereit, an Streitbeilegungsverfahren vor einer
        Verbraucherschlichtungsstelle teilzunehmen. Verbraucher:innen können sich freiwillig an
        die{" "}
        <a href="https://ombudsstelle.at" target="_blank" rel="noopener noreferrer">
          Internet Ombudsstelle
        </a>{" "}
        wenden. Bei Fragen oder Beschwerden erreichst du uns jederzeit direkt unter{" "}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
      </p>

      <h2>Haftung für Inhalte &amp; Links</h2>
      <p>
        Die Inhalte dieser Anwendung werden mit größtmöglicher Sorgfalt erstellt. Für Richtigkeit,
        Vollständigkeit und Aktualität – insbesondere bei Öffnungszeiten, Wegen, Wetter- und
        Veranstaltungsdaten – wird keine Gewähr übernommen. Unser Angebot enthält Verweise auf
        externe Websites Dritter, auf deren Inhalte wir keinen Einfluss haben; für diese ist stets
        der jeweilige Anbieter verantwortlich.
      </p>

      <h2>Urheberrecht</h2>
      <p>
        Sämtliche Inhalte (Texte, Fotos, Videos, Karten, Audio-Touren, Software) sind urheberrechtlich
        geschützt. Eine Verwertung außerhalb der gesetzlich zulässigen Fälle bedarf der vorherigen
        schriftlichen Zustimmung von {LEGAL.company}. Kartendaten stammen von Mapbox und
        OpenStreetMap-Mitwirkenden.
      </p>
    </LegalShell>
  );
}
