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
        von Google deine E-Mail-Adresse und die Bestätigung, dass sie verifiziert ist. Die Angabe
        der E-Mail-Adresse ist für Registrierung, Login und Kauf erforderlich; ohne sie können diese
        Funktionen nicht bereitgestellt werden.
      </p>
      <h3>b) Newsletter</h3>
      {/* Muss beschreiben, was der Code WIRKLICH tut (Art. 13 DSGVO). Seit dem Umbau des
          Logins ist das ein Double-Opt-in: Das Häkchen im Formular reist nur als Merker am
          Bestätigungslink mit, gespeichert wird die Einwilligung erst im Auth-Callback,
          also nachdem der Link im betreffenden Postfach geöffnet wurde. Wer eine fremde
          Adresse einträgt, erzeugt damit keine Einwilligung. Siehe profil/actions.ts und
          auth/callback/route.ts. */}
      <p>
        Der Newsletter ist freiwillig und vom Konto unabhängig: Du kannst dich anmelden, ohne ihn zu
        abonnieren, und du bekommst ohne dein Häkchen keine Werbung von uns. Setzt du das Häkchen
        beim Anmelden, speichern wir deine Einwilligung erst, wenn du den Link in der E-Mail an
        diese Adresse geöffnet hast (Double-Opt-in) &ndash; zusammen mit dem Zeitpunkt, damit wir die
        Einwilligung nachweisen können. Widerrufen kannst du jederzeit mit Wirkung für die Zukunft,
        über den Abmeldelink in jeder E-Mail oder in deinem Profil unter „Daten &amp; Einwilligungen“.
        Der Widerruf ist genauso einfach wie die Erteilung und kostet dich nichts.
      </p>
      <h3>c) Nutzung der App</h3>
      <p>
        Gespeicherte Spots/Events, selbst erstellte Touren und ähnliche Einstellungen werden deinem
        Konto zugeordnet, damit sie dir geräteübergreifend zur Verfügung stehen.
      </p>
      <h3>d) KI-Assistent „Toni“</h3>
      <p>
        Stellst du dem KI-Assistenten Fragen, wird dein Text zur Beantwortung an unseren
        KI-Dienstleister (Anthropic) übermittelt. Bitte gib dort keine sensiblen personenbezogenen
        Daten ein. Bist du angemeldet, speichern wir deinen Chat-Verlauf, damit du ihn später
        wieder öffnen kannst: bis du ihn löschst, spätestens 24 Monate nach der letzten
        Aktivität; er ist im Datenexport enthalten. Als Gast wird kein Verlauf auf unseren
        Servern gespeichert. Angemeldet nutzt Toni außerdem die Art deiner gemerkten Spots
        (z.&nbsp;B. Seen oder Wanderungen) für passendere Vorschläge; ein Werbeprofil entsteht
        daraus nicht. Zur Verbesserung des Angebots speichern wir ausschließlich anonyme
        Auswertungen (z.&nbsp;B. Themen-Kategorien) ohne Bezug zu deiner Person, deinem Konto
        oder deiner IP. Wo überall KI mithilft, erklärt unsere Seite{" "}
        <Link href="/ki">„Mit Liebe und KI gemacht“</Link>.
      </p>
      <h3>e) Kauf von SalzGuide Pro</h3>
      {/* Muss beschreiben, was der Code WIRKLICH tut (Art. 13 DSGVO). Seit dem Gast-Kauf ist
          das mehr als vorher: Pro lässt sich ohne Konto kaufen, die E-Mail kommt aus Stripes
          Kasse, und aus ihr entsteht danach das Konto. Gespeichert wird die Zeile in
          pro_purchases (Migration 0053). Siehe lib/pro-purchase.ts. */}
      <p>
        Du kannst Pro ohne Konto kaufen. Die Zahlung wickelt unser Zahlungsdienstleister Stripe
        ab. Zahlungsdaten (z. B. Kartendaten) werden ausschließlich von Stripe verarbeitet und
        erreichen unsere Server nicht. Von Stripe erhalten wir die E-Mail-Adresse, mit der du
        bezahlt hast, den bezahlten Betrag und die Kennungen des Vorgangs (Checkout-Sitzung,
        Kunden- und Zahlungskennung). Das speichern wir mit dem Zeitpunkt, um dir den Zugang zu
        geben, die Freischaltung deinem Konto zuzuordnen und den Kauf im Rückerstattungs- oder
        Streitfall belegen zu können. Hast du noch kein Konto, entsteht es aus genau dieser
        Adresse; du bekommst den Zugang dazu passwortlos per Link an dieselbe Adresse.
        Rechtsgrundlage ist die Erfüllung des Vertrags (Art. 6 Abs. 1 lit. b DSGVO), für die
        Aufbewahrung des Zahlungsvorgangs zusätzlich unsere gesetzlichen Aufbewahrungspflichten
        (Art. 6 Abs. 1 lit. c DSGVO). Löschst du dein Konto, bleibt der Zahlungsvorgang als
        Nachweis bestehen, ohne Verknüpfung zu einem Konto.
      </p>
      <h3>f) Bot-Schutz an unseren Formularen</h3>
      {/* Stand bis 07/2026 als „Bot-Schutz am Login" da und war damit zu eng: Turnstile läuft
          auch am Support- und am Widerrufsformular (verifyTurnstile in support-actions.ts und
          rechtliches/widerruf/actions.ts). Wer hier ein Formular ergänzt, ergänzt die Liste. */}
      <p>
        Zum Schutz vor automatisiertem Missbrauch (Bots, Massen-Mailversand) setzen wir an unseren
        Formularen Cloudflare Turnstile ein: beim Anmelden, beim Absenden einer Support-Anfrage und
        beim Online-Widerruf. Dabei werden technische Signale deines Browsers sowie deine IP-Adresse
        durch Cloudflare verarbeitet, um „Mensch oder Bot“ zu unterscheiden.
      </p>
      <h3>g) Server-Logs &amp; Sicherheit</h3>
      {/* Nannte bis 07/2026 nur die Verbindungsdaten des Hosters und verschwieg, dass wir
          selbst zwei Dinge schreiben: die Zähler gegen Missbrauch (Migration 0055,
          lib/login-link.ts + api/track) und das Betriebs-Logbuch (Migration 0056, lib/ops.ts).
          In beiden steht ein aus der IP-Adresse gebildetes Pseudonym. Eine Verarbeitung, die
          in der Erklärung nicht vorkommt, ist ein Verstoß gegen Art. 13 DSGVO, auch wenn in
          der Tabelle nur Hashwerte stehen. */}
      <p>
        Beim Aufruf fallen technisch notwendige Verbindungsdaten an (z. B. gekürzte/verarbeitete
        IP-Adresse, Zeitpunkt, aufgerufene Ressource), die der Auslieferung, Stabilität und
        Missbrauchsabwehr dienen. Zusätzlich führen wir selbst zwei Aufzeichnungen:
      </p>
      <ul>
        <li>
          <strong>Zähler gegen Missbrauch:</strong> Damit niemand ein fremdes Postfach mit
          Anmeldelinks zuschütten oder unsere Messung vollschreiben kann, zählen wir
          kurzzeitig, wie oft von derselben Stelle etwas kommt. Als Schlüssel dient nie die
          Adresse selbst, sondern ein daraus errechneter Hashwert. Diese Zähler löschen wir
          täglich, sobald sie älter als einen Tag sind.
        </li>
        <li>
          <strong>Betriebs-Logbuch:</strong> Fehler, abgewiesene Zugriffe und Änderungen im
          Verwaltungsbereich halten wir fest, um Störungen und Angriffe nachvollziehen zu
          können. Freitexte werden dabei geschwärzt, Personen erscheinen nur als Hashwert.
          Nach 90 Tagen wird gelöscht.
        </li>
      </ul>
      <p>
        Rechtsgrundlage für beides ist unser berechtigtes Interesse an einem sicheren,
        funktionierenden Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
      </p>

      <h3>h) Reichweitenmessung (cookielos)</h3>
      {/* Muss beschreiben, was der Code WIRKLICH tut (Art. 13 DSGVO). Hier standen bis
          07/2026 vier Zeilen, die WENIGER sagten, als passiert: Sie nannten kein einziges
          erhobenes Merkmal, keine Speicherdauer der Ereignisse und behaupteten „ohne dich
          wiederzuerkennen" — obwohl der Tages-Hash genau dazu da ist, Aufrufe EINES Tages
          zusammenzuführen (sonst gäbe es weder Besucher- noch Sitzungszahlen). Der
          vollständige Baustein lag seit der Umsetzung in docs/34 §H unter „bitte übernehmen".

          Die Liste unten ist abschliessend und entspricht Zeile für Zeile den Spalten von
          `analytics_events` (Migrationen 0019-0021) samt den Aufrufstellen von trackEvent().
          Wer ein Feld ergänzt, ergänzt diese Liste. */}
      <p>
        Wir messen selbst und mit eigenen Mitteln, wie unsere Seiten genutzt werden. Kein
        Google Analytics, keine Werbenetzwerke, keine Weitergabe an Dritte. Auf deinem Gerät
        wird dafür <strong>nichts gespeichert und nichts ausgelesen</strong>; ein
        Cookie-Hinweis ist dafür nicht erforderlich (§ 165 Abs. 3 TKG).
      </p>
      <p>Zu einem Aufruf halten wir fest:</p>
      <ul>
        <li>
          welche Seite aufgerufen wurde (bei einem Spot oder einer Tour deren Kürzel, sonst
          nur die Art der Seite),
        </li>
        <li>
          woher du gekommen bist: die Art der Quelle (direkt, Suchmaschine, soziales Netzwerk)
          oder die Domain der verweisenden Seite, und die Kampagne aus dem angeklickten Link,
        </li>
        <li>
          das Land als Länderkürzel (z. B. „AT“, nie ein genauerer Ort), die Geräteart (Handy,
          Tablet, Computer) und die eingestellte Sprache,
        </li>
        <li>
          welche Spots und Events gemerkt, welche Event-Links angeklickt, wie viele Fragen an
          den KI-Assistenten gestellt und wie viele Käufe abgeschlossen wurden, jeweils nur
          als Anzahl.
        </li>
      </ul>
      <p>
        Um abschätzen zu können, wie viele verschiedene Menschen an einem Tag da waren, bilden
        wir aus deiner IP-Adresse, deiner Browserkennung und einem Zufallswert, der jede Nacht
        wechselt, einen Hashwert. <strong>Die IP-Adresse selbst speichern wir nicht.</strong>{" "}
        Innerhalb eines Tages erkennen wir daran, dass mehrere Aufrufe zusammengehören &ndash;
        nur so entstehen überhaupt Besuchs- und Besucherzahlen. Über den Tag hinaus, auf ein
        anderes Gerät oder auf andere Websites ist keine Wiedererkennung möglich und auch nicht
        gewollt. Den Zufallswert löschen wir nach spätestens zwei Tagen; danach lässt sich der
        Hashwert niemandem mehr zuordnen. Die anonymen Ereignisse selbst bewahren wir rund
        14 Monate auf, damit ein Vergleich mit dem Vorjahr möglich bleibt.
      </p>
      <p>
        Nicht mitgezählt werden Aufrufe aus unserem eigenen Betrieb und die von Suchmaschinen-
        und Vorschau-Robotern. Rechtsgrundlage ist unser berechtigtes Interesse an einer
        datensparsamen Reichweitenmessung (Art. 6 Abs. 1 lit. f DSGVO). Du kannst dieser
        Verarbeitung jederzeit widersprechen (Art. 21 DSGVO), formlos an{" "}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>. Wir werten ausschließlich
        zusammengefasste Zahlen aus; eine Ansicht einzelner Personen gibt es nicht und ist mit
        diesen Daten auch nicht herstellbar.
      </p>
      <h3>i) Cookies und ähnliche Technologien</h3>
      {/* Hieß bis 07/2026 nur „Cookies" und nannte nur Cookies. § 165 Abs. 3 TKG (und die
          EDPB-Leitlinien 2/2023 zu Art. 5 Abs. 3 ePrivacy) erfassen JEDE Speicherung im
          Endgerät und jeden Zugriff darauf, also auch localStorage und sessionStorage. Die
          Aufzählung unten ist die vollständige Liste dessen, was der Code wirklich ablegt:
          supabase/server.ts (Session), api/ai/chat/route.ts (sg_aid), stripe-actions.ts
          (sg_buy), Explore.tsx (sg-season), toni-chat-store.ts, ToniLauncher.tsx, plus
          mapbox-gl selbst.
          Wer hier etwas hinzufügt, das nicht für eine aufgerufene Funktion nötig ist,
          braucht eine Einwilligung und damit einen Banner. Genau deshalb steht die Liste
          hier vollständig und nicht als „insbesondere". */}
      <p>
        Wir setzen ausschließlich <strong>technisch notwendige</strong> Cookies und
        vergleichbare Speicher ein. Es gibt bei uns keine Marketing-, Werbe- oder
        Tracking-Cookies und keine Dienste, die dich über Websites hinweg wiedererkennen.
        Deshalb musst du bei uns auch keinen Cookie-Hinweis wegklicken. Im Einzelnen:
      </p>
      <ul>
        <li>
          <strong>Anmeldung (Cookie):</strong> Das Session-Cookie von Supabase hält dich
          angemeldet. Ohne es müsstest du auf jeder Seite neu einsteigen.
        </li>
        <li>
          <strong>Gast-Kennung „sg_aid“ (Cookie):</strong> Eine Zufallszahl, damit das
          Gratis-Limit des KI-Assistenten (drei Fragen ohne Konto) überhaupt zählbar ist. Sie
          enthält keine Angaben über dich, ist für Skripte nicht auslesbar (httpOnly) und
          läuft nach 90 Tagen ab.
        </li>
        <li>
          <strong>Kauf-Nachweis „sg_buy“ (Cookie):</strong> Eine Zufallszahl, die beim Start
          des Bezahlvorgangs gesetzt wird. Sie belegt bei der Rückkehr von Stripe, dass es
          derselbe Browser ist, der bezahlt hat &ndash; nur deshalb können wir dir den Zugang
          sofort geben, ohne dass du erst eine E-Mail suchen musst. Sie enthält keine Angaben
          über dich, ist für Skripte nicht auslesbar (httpOnly) und läuft nach zwei Stunden ab.
        </li>
        <li>
          <strong>Deine Einstellungen (lokaler Speicher):</strong> deine Wahl zwischen Sommer
          und Winter, dein laufender Chat mit Toni (damit er da ist, wenn du zurückkommst)
          und ein Merker, dass der Hinweis auf Toni in dieser Sitzung schon erschienen ist.
          Das bleibt auf deinem Gerät und wird nicht an uns übertragen.
        </li>
        <li>
          <strong>Karte (lokaler Speicher):</strong> siehe Punkt l).
        </li>
      </ul>
      <p>
        All das ist für die Funktionen erforderlich, die du aufrufst; eine Einwilligung ist
        dafür nicht nötig (§ 165 Abs. 3 TKG). Löschen kannst du es jederzeit über die
        Einstellungen deines Browsers.
      </p>
      <h3>j) Support- und Kontaktanfragen</h3>
      {/* Fehlte bis 07/2026 ganz, obwohl das Formular Daten speichert UND eine Mail auslöst
          (lib/support-actions.ts schreibt in support_requests). Eine Verarbeitung, die in der
          Erklärung nicht vorkommt, ist ein Verstoß gegen Art. 13 DSGVO, auch wenn sie noch so
          harmlos ist. */}
      <p>
        Schreibst du uns über das Hilfe-Formular, verarbeiten wir deine E-Mail-Adresse, deinen
        Namen (falls angegeben), deine Nachricht und die gewählte Sprache, um zu antworten. Bist
        du angemeldet, ordnen wir die Anfrage deinem Konto zu, damit wir den Zusammenhang sehen.
        Die Anfrage wird bei uns gespeichert und zusätzlich per E-Mail an uns zugestellt.
        Rechtsgrundlage ist unser berechtigtes Interesse an der Beantwortung deiner Anfrage
        (Art. 6 Abs. 1 lit. f DSGVO), bei Anfragen zu einem Kauf die Vertragserfüllung
        (Art. 6 Abs. 1 lit. b DSGVO). Wir bewahren Anfragen so lange auf, wie es für die
        Bearbeitung und für Rückfragen nötig ist.
      </p>

      <h3>k) Online-Widerruf</h3>
      <p>
        Nutzt du das Online-Widerrufsformular, verarbeiten wir die angegebenen Daten (Name,
        E-Mail-Adresse, Vertrags-/Bestellkennung, ggf. Anschrift) zur Bearbeitung deines Widerrufs
        und für die gesetzlich vorgeschriebene Eingangsbestätigung. Rechtsgrundlage ist die Erfüllung
        einer rechtlichen Verpflichtung sowie die Vertragsabwicklung.
      </p>

      <h3>l) Karte</h3>
      {/* Der einzige Grenzfall der ganzen Liste, deshalb steht er offen da: mapbox-gl (3.25)
          legt „mapbox.eventData" im localStorage ab und meldet Kartenaufrufe an
          events.mapbox.com. Das ist Mapbox' eigene Sitzungszählung, über die unser Vertrag
          abgerechnet wird. Abschalten wäre technisch möglich, würde aber genau diese
          Abrechnung umgehen. Einordnung: erforderlich für den Kartendienst, den der Nutzer
          mit dem Öffnen der Karte ausdrücklich aufruft. Wer das anders sieht, braucht eine
          Einwilligung VOR dem ersten Kartenaufruf – bei einer Karten-App also einen Banner
          vor der Hauptfunktion. */}
      <p>
        Die Karten kommen von Mapbox (auf Basis von OpenStreetMap). Beim Laden einer Karte
        legt Mapbox eine anonyme Kennung im lokalen Speicher deines Browsers ab und meldet den
        Kartenaufruf an Mapbox. Das dient der Nutzungsmessung, über die unser Kartenvertrag
        abgerechnet wird, nicht der Werbung und nicht der Wiedererkennung über andere
        Websites. Dabei wird auch deine IP-Adresse an Mapbox übermittelt (Sitz in den USA,
        siehe Punkt 6). Nutzt du die Standortanzeige, wertet dein Gerät den Standort aus; wir
        speichern ihn nicht.
      </p>
      {/* Ergänzt am 24.08.2026 mit der Rad-Navigation: Bis dahin deckte der Absatz oben nur
          die Standortanzeige ab, bei der die Position das Gerät nie verlässt. Die Navigation
          schickt sie sehr wohl weg (bike-directions.ts ruft api.mapbox.com direkt aus dem
          Browser auf, beim Start und bei jeder Neuberechnung), und das ist eine Übermittlung
          an einen Dritten in die USA. Sie gehört benannt, auch wenn wir selbst nichts davon
          speichern. Wer die Navigation umbaut und dabei den Anbieter wechselt, ändert diesen
          Absatz mit und zieht LEGAL.updated in lib/legal.ts nach. */}
      <p>
        Startest du eine Rad-Navigation, kommt zur Kartendarstellung die Routenberechnung
        hinzu: Deine Position wird dabei aus deinem Browser an Mapbox übermittelt, beim Start
        und noch einmal bei jeder Neuberechnung, etwa wenn du von der Route abkommst. Anders
        als bei der reinen Standortanzeige verlässt der Standort dein Gerät hier also. Wir
        selbst speichern ihn weiterhin nicht: Es entsteht bei uns keine Fahrtaufzeichnung und
        kein Bewegungsprofil, weder während der Fahrt noch danach. Die Navigation startet nie
        von allein, sondern erst, wenn du sie ausdrücklich beginnst und deinem Browser den
        Standortzugriff erlaubst. Die Erlaubnis kannst du jederzeit in den
        Browser-Einstellungen wieder entziehen.
      </p>

      <h3>m) Unsere Profile auf Instagram und TikTok</h3>
      <p>
        Wir betreiben Profile auf Instagram (Meta) und TikTok. Rufst du eines auf, verarbeiten
        diese Plattformen deine Daten nach ihren eigenen Bestimmungen, auf die wir keinen
        Einfluss haben. Für die Nutzungsstatistiken, die uns die Plattformen zu unseren
        Profilen bereitstellen, sind wir gemeinsam mit ihnen verantwortlich (Art. 26 DSGVO);
        wir sehen daraus nur zusammengefasste Zahlen, keine einzelnen Personen. Bestimmungen
        der Plattformen:{" "}
        <a href="https://privacycenter.instagram.com/policy" target="_blank" rel="noopener noreferrer">
          Meta
        </a>{" "}
        und{" "}
        <a href="https://www.tiktok.com/legal/privacy-policy-eea" target="_blank" rel="noopener noreferrer">
          TikTok
        </a>
        . Rechtsgrundlage für unsere Präsenz ist unser berechtigtes Interesse an
        Öffentlichkeitsarbeit (Art. 6 Abs. 1 lit. f DSGVO).
      </p>

      <h3>n) Instagram-Beiträge auf unserer Seite</h3>
      {/* Das ist der Grund, warum diese Seite keinen Cookie-Banner braucht, obwohl
          Instagram-Beiträge darauf zu sehen sind: Es sind unsere eigenen Bilder aus unserem
          eigenen Speicher (Supabase, EU), im Admin hochgeladen. Es gibt weder im Browser noch
          auf unserem Server einen Kontakt zu Meta. Wer diesen Abschnitt ändert, weil er auf
          ein Embed, ein Widget oder einen automatischen Abruf umbaut, macht aus der Aussage
          unten eine Falschangabe UND braucht dann eine Einwilligung samt Banner. */}
      <p>
        Auf der Startseite und unter „Über uns“ zeigen wir eine Auswahl unserer
        Instagram-Beiträge. Die Bilder dafür laden wir selbst in unseren Speicher in der EU
        und liefern sie von dort aus.{" "}
        <strong>Dein Browser nimmt dabei keine Verbindung zu Instagram oder Meta auf</strong>
        , es werden keine Cookies gesetzt und keine Daten über dich an Meta übertragen. Es gibt
        auch keinen automatischen Abruf bei Meta. Erst wenn du einen Beitrag antippst,
        wechselst du zu Instagram; wir geben dabei nicht mit, von welcher unserer Seiten du
        kommst.
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
          Reichweitenmessung, unsere Profile auf Instagram und TikTok samt Anzeige unserer
          eigenen Beiträge.
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
          <strong>Supabase</strong> – Datenbank, Authentifizierung, Speicher (Hosting in der EU;
          Unternehmenssitz USA).
        </li>
        <li>
          <strong>Vercel</strong> – Hosting/Auslieferung der Anwendung (CDN), USA.
        </li>
        <li>
          <strong>Stripe</strong> – Zahlungsabwicklung, Irland/USA.
        </li>
        <li>
          <strong>Anthropic</strong> – KI-Assistent und KI-gestützte Inhalte, USA.
        </li>
        <li>
          <strong>Google</strong> – „Anmelden mit Google“ sowie Öffnungszeiten (Google Places), Irland/USA.
        </li>
        <li>
          <strong>Mapbox</strong> (mit OpenStreetMap) – Kartendarstellung und, bei der
          Rad-Navigation, Routenberechnung aus deiner Position (siehe Punkt 3l), USA.
        </li>
        <li>
          <strong>Cloudflare</strong> – Bot-Schutz (Turnstile), USA.
        </li>
        <li>
          <strong>ElevenLabs</strong> – Sprachausgabe der Audio-Touren (unsere Texte, keine Nutzerdaten), USA.
        </li>
        <li>
          <strong>Open-Meteo</strong> – Wetterdaten, Deutschland (es werden nur gerundete Koordinaten des
          jeweiligen Ortes übermittelt, keine personenbezogenen Daten).
        </li>
        <li>
          <strong>Resend</strong> bzw. Supabase-Mailversand – Versand von System-, Login-,
          Kauf- und Widerruf-Bestätigungs-E-Mails, USA.
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
      {/* DIESE LISTE IST EIN VERSPRECHEN, KEINE ABSICHT. Jede Zahl hier steht als Konstante in
          lib/data-retention.ts und wird nachts um 03:30 vom Cron durchgesetzt; wer eine ändert,
          ändert beide. Eine Frist, die in der Erklärung steht und im Betrieb nicht eingehalten
          wird, ist eine falsche Angabe nach Art. 13 DSGVO.

          Bis 07/2026 fehlten hier drei Zeilen, obwohl der Code sie schon löschte (Reichweiten-
          Ereignisse, Betriebs-Logbuch) bzw. NICHT löschte (Missbrauchs-Zähler, die deshalb
          unbefristet lagen). */}
      <ul>
        <li>Kontodaten: bis zur Löschung deines Kontos durch dich oder auf deine Anfrage.</li>
        <li>
          Anonyme KI-Auswertungen: ohne Personenbezug; Nutzungszähler der KI max. 90 Tage;
          gespeicherte Chat-Verläufe: bis du sie löschst, spätestens 24 Monate nach der
          letzten Aktivität.
        </li>
        <li>
          Reichweitenmessung: der Zufallswert nach spätestens 2 Tagen gelöscht, die Ereignisse
          danach ohne Personenbezug und nach rund 14 Monaten gelöscht.
        </li>
        <li>Zähler gegen Missbrauch: 1 Tag.</li>
        <li>Betriebs-Logbuch (Fehler, abgewiesene Zugriffe, Verwaltungsspur): 90 Tage.</li>
        <li>Support-Anfragen: solange die Bearbeitung und mögliche Rückfragen es erfordern.</li>
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
