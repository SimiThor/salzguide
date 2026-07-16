import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LegalShell from "@/components/LegalShell";
import { LEGAL, legalAddress, legalMetadata } from "@/lib/legal";

export const metadata: Metadata = legalMetadata("datenschutz", "Datenschutzerklärung");

export default async function DatenschutzPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LegalShell locale={locale} title="Datenschutzerklärung" updated={LEGAL.updated}>
      <p>
        Wir nehmen den Schutz deiner personenbezogenen Daten ernst. Diese Erklärung informiert dich
        gemäß Datenschutz-Grundverordnung (DSGVO), österreichischem Datenschutzgesetz (DSG) und
        Telekommunikationsgesetz 2021 (TKG) darüber, welche Daten wir verarbeiten, zu welchem Zweck
        und welche Rechte dir zustehen.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>
        <strong>{LEGAL.company}</strong>
        <br />
        {legalAddress()}
        <br />
        E-Mail: <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </p>

      <h2>2. Grundsätze</h2>
      <p>
        Wir verarbeiten Daten nur, soweit es für den Betrieb der App nötig ist, auf Basis einer
        Rechtsgrundlage und – wo möglich – datensparsam bzw. pseudonymisiert. Server und Datenbank
        stehen in der EU (Supabase, Region Frankfurt/Deutschland).
      </p>

      <h2>3. Welche Daten wir verarbeiten</h2>
      <h3>a) Konto &amp; Login</h3>
      <p>
        Für Registrierung und Anmeldung verarbeiten wir deine E-Mail-Adresse. Die Anmeldung erfolgt
        passwortlos per Magic-Link oder über „Anmelden mit Google“. Bei Google-Login erhalten wir
        von Google deine E-Mail-Adresse und die Bestätigung, dass sie verifiziert ist. Optional
        speichern wir deine Einwilligung zum Newsletter samt Zeitpunkt. Die Angabe der E-Mail-Adresse
        ist für Registrierung, Login und Kauf erforderlich; ohne sie können diese Funktionen nicht
        bereitgestellt werden. Deine Newsletter-Einwilligung kannst du jederzeit über den Abmeldelink
        in jeder E-Mail oder in deinem Profil widerrufen.
      </p>
      <h3>b) Nutzung der App</h3>
      <p>
        Gespeicherte Spots/Events, selbst erstellte Touren und ähnliche Einstellungen werden deinem
        Konto zugeordnet, damit sie dir geräteübergreifend zur Verfügung stehen.
      </p>
      <h3>c) KI-Assistent „Toni“</h3>
      <p>
        Stellst du dem KI-Assistenten Fragen, wird dein Text zur Beantwortung an unseren
        KI-Dienstleister (Anthropic) übermittelt. Bitte gib dort keine sensiblen personenbezogenen
        Daten ein. Zur Verbesserung des Angebots speichern wir ausschließlich anonyme Auswertungen
        (z. B. Themen-Kategorien) ohne Bezug zu deiner Person, deinem Konto oder deiner IP.
      </p>
      <h3>d) Kauf von SalzGuide Pro</h3>
      <p>
        Die Zahlung wickelt unser Zahlungsdienstleister Stripe ab. Zahlungsdaten (z. B.
        Kartendaten) werden ausschließlich von Stripe verarbeitet und erreichen unsere Server nicht.
        Wir speichern deinen Pro-Status, den Zeitpunkt und eine Stripe-Kundenkennung, um die
        Freischaltung deinem Konto zuzuordnen.
      </p>
      <h3>e) Bot-Schutz am Login</h3>
      <p>
        Zum Schutz vor automatisiertem Missbrauch (Bots, Massen-Mailversand) setzen wir Cloudflare
        Turnstile ein. Dabei werden technische Signale deines Browsers sowie deine IP-Adresse durch
        Cloudflare verarbeitet, um „Mensch oder Bot“ zu unterscheiden.
      </p>
      <h3>f) Server-Logs &amp; Sicherheit</h3>
      <p>
        Beim Aufruf fallen technisch notwendige Verbindungsdaten an (z. B. gekürzte/verarbeitete
        IP-Adresse, Zeitpunkt, aufgerufene Ressource), die der Auslieferung, Stabilität und
        Missbrauchsabwehr dienen.
      </p>
      <h3>g) Reichweitenmessung (cookielos)</h3>
      <p>
        Wir messen die Nutzung datenschonend, <strong>ohne Cookies</strong> und ohne dich
        wiederzuerkennen. IP-Adressen werden nie gespeichert, sondern nur über einen täglich
        wechselnden Zufallswert kurzzeitig gehasht (danach anonym). Es entsteht kein Personenbezug;
        ein Cookie-Banner ist dafür nicht erforderlich (§ 165 TKG).
      </p>
      <h3>h) Cookies</h3>
      <p>
        Wir verwenden ausschließlich <strong>technisch notwendige Cookies</strong>, die für
        Anmeldung und Sitzung erforderlich sind (insbesondere das Login-/Session-Cookie von Supabase
        sowie eine zufällige Gast-Kennung). Diese sind für den Betrieb unbedingt erforderlich; eine
        Einwilligung ist dafür nicht nötig (§ 165 Abs. 3 TKG). Marketing- oder Tracking-Cookies
        setzen wir nicht.
      </p>
      <h3>i) Online-Widerruf</h3>
      <p>
        Nutzt du das Online-Widerrufsformular, verarbeiten wir die angegebenen Daten (Name,
        E-Mail-Adresse, Vertrags-/Bestellkennung, ggf. Anschrift) zur Bearbeitung deines Widerrufs
        und für die gesetzlich vorgeschriebene Eingangsbestätigung. Rechtsgrundlage ist die Erfüllung
        einer rechtlichen Verpflichtung sowie die Vertragsabwicklung.
      </p>

      <h2>4. Rechtsgrundlagen</h2>
      <ul>
        <li>
          <strong>Vertrag (Art. 6 Abs. 1 lit. b DSGVO):</strong> Konto, gespeicherte Inhalte,
          Bereitstellung und Abwicklung von SalzGuide Pro.
        </li>
        <li>
          <strong>Einwilligung (Art. 6 Abs. 1 lit. a DSGVO):</strong> Newsletter. Widerruf jederzeit
          mit Wirkung für die Zukunft möglich.
        </li>
        <li>
          <strong>Berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO):</strong> Sicherheit und
          Missbrauchsabwehr (Turnstile, Rate-Limits), stabiler Betrieb, cookielose
          Reichweitenmessung.
        </li>
        <li>
          <strong>Rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c DSGVO):</strong> Aufbewahrung von
          Rechnungs-/Buchhaltungsdaten (§ 132 BAO).
        </li>
      </ul>

      <h2>5. Empfänger &amp; Auftragsverarbeiter</h2>
      <p>
        Wir setzen sorgfältig ausgewählte Dienstleister ein, mit denen – soweit erforderlich –
        Auftragsverarbeitungsverträge (Art. 28 DSGVO) bestehen:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> – Datenbank, Authentifizierung, Speicher (Hosting in der EU).
        </li>
        <li>
          <strong>Vercel</strong> – Hosting/Auslieferung der Anwendung (CDN).
        </li>
        <li>
          <strong>Stripe</strong> – Zahlungsabwicklung.
        </li>
        <li>
          <strong>Anthropic</strong> – KI-Assistent und KI-gestützte Inhalte.
        </li>
        <li>
          <strong>Google</strong> – „Anmelden mit Google“ sowie Öffnungszeiten (Google Places).
        </li>
        <li>
          <strong>Mapbox</strong> (mit OpenStreetMap) – Kartendarstellung.
        </li>
        <li>
          <strong>Cloudflare</strong> – Bot-Schutz (Turnstile).
        </li>
        <li>
          <strong>ElevenLabs</strong> – Sprachausgabe der Audio-Touren.
        </li>
        <li>
          <strong>Open-Meteo</strong> – Wetterdaten (es werden nur gerundete Koordinaten des
          jeweiligen Ortes übermittelt, keine personenbezogenen Daten).
        </li>
        <li>
          <strong>Resend</strong> bzw. Supabase-Mailversand – Versand von System-, Login- und
          Widerruf-Bestätigungs-E-Mails.
        </li>
      </ul>

      <h2>6. Übermittlung in Drittländer</h2>
      <p>
        Einzelne Dienstleister haben ihren Sitz in den USA. Übermittlungen erfolgen nur bei
        geeigneten Garantien: entweder auf Basis eines Angemessenheitsbeschlusses (EU-U.S. Data
        Privacy Framework, sofern der Anbieter zertifiziert ist) oder gestützt auf
        Standardvertragsklauseln der EU-Kommission samt ergänzender Schutzmaßnahmen.
      </p>

      <h2>7. Speicherdauer</h2>
      <ul>
        <li>Kontodaten: bis zur Löschung deines Kontos durch dich oder auf deine Anfrage.</li>
        <li>Anonyme KI-Auswertungen: ohne Personenbezug; Roh-Nutzungsdaten der KI max. 90 Tage.</li>
        <li>Reichweitenmessung: nach spätestens 2 Tagen anonym, danach ohne Personenbezug.</li>
        <li>Rechnungs-/Zahlungsdaten: gesetzliche Aufbewahrungsfrist (i. d. R. 7 Jahre, § 132 BAO).</li>
      </ul>

      <h2>8. Deine Rechte</h2>
      <p>Dir stehen jederzeit folgende Rechte zu:</p>
      <ul>
        <li>Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17),</li>
        <li>Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20),</li>
        <li>Widerspruch gegen Verarbeitungen auf Basis berechtigter Interessen (Art. 21),</li>
        <li>Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (Art. 7 Abs. 3).</li>
      </ul>
      <p>
        Auskunft, Export und Löschung kannst du großteils selbst im Bereich{" "}
        <Link href="/profil/daten">„Deine Daten &amp; Datenschutz“</Link> in deinem Profil
        ausführen. Es
        besteht kein automatisiertes Entscheidungsverfahren mit rechtlicher Wirkung; der
        KI-Assistent liefert ausschließlich unverbindliche Informationen.
      </p>

      <h2>9. Beschwerderecht</h2>
      <p>
        Du hast das Recht auf Beschwerde bei einer Aufsichtsbehörde. In Österreich ist dies die
        Österreichische Datenschutzbehörde, Barichgasse 40–42, 1030 Wien,{" "}
        <a href="https://www.dsb.gv.at" target="_blank" rel="noopener noreferrer">
          www.dsb.gv.at
        </a>
        .
      </p>

      <h2>10. Änderungen</h2>
      <p>
        Wir passen diese Datenschutzerklärung an, wenn sich die Rechtslage oder unsere Verarbeitungen
        ändern. Es gilt die jeweils hier veröffentlichte Fassung (Stand siehe oben).
      </p>
    </LegalShell>
  );
}
