import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LegalShell from "@/components/LegalShell";
import WithdrawalForm from "@/components/WithdrawalForm";
import { LEGAL, legalAddress, legalMetadata } from "@/lib/legal";

export const metadata: Metadata = legalMetadata("widerruf", "Widerrufsbelehrung");

export default async function WiderrufPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LegalShell locale={locale} title="Widerrufsbelehrung" updated={LEGAL.updated}>
      <p>
        Diese Belehrung gilt für Verbraucher:innen im Sinne des Fern- und Auswärtsgeschäfte-Gesetzes
        (FAGG) beim kostenpflichtigen Kauf von „SalzGuide Pro“. Das FAGG nennt dieses Recht
        <strong> Rücktrittsrecht</strong>, die europäische Richtlinie und der Widerrufsbutton nennen
        es <strong>Widerrufsrecht</strong>. Gemeint ist dasselbe Recht; wir verwenden beide Wörter
        gleichbedeutend.
      </p>

      <h2>Online widerrufen</h2>
      <p>
        Du kannst deinen Widerruf direkt hier erklären. Wir bestätigen den Eingang unverzüglich per
        E-Mail (mit Datum und Uhrzeit).
      </p>
      <WithdrawalForm />

      <h2>Widerrufsrecht</h2>
      <p>
        Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu
        widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.
      </p>
      <p>
        Um dein Widerrufsrecht auszuüben, musst du uns
      </p>
      <p>
        <strong>{LEGAL.company}</strong>
        <br />
        {legalAddress()}
        <br />
        E-Mail: <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </p>
      <p>
        mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine
        E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du kannst dafür
        das untenstehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.
        Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des
        Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.
      </p>

      <h2>Folgen des Widerrufs</h2>
      <p>
        Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten
        haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem
        die Mitteilung über deinen Widerruf bei uns eingegangen ist. Für die Rückzahlung verwenden
        wir dasselbe Zahlungsmittel, das du beim ursprünglichen Vorgang eingesetzt hast; in keinem
        Fall werden dir wegen der Rückzahlung Entgelte berechnet.
      </p>
      <p>
        Hast du verlangt, dass wir mit der Leistung schon während der Frist beginnen, so hast du uns
        für die bis zum Widerruf erbrachten Leistungen einen Betrag zu zahlen, der im Vergleich zum
        Gesamtpreis verhältnismäßig ist (Wertersatz, § 16 FAGG). Für digitale Inhalte, die nicht auf
        einem körperlichen Datenträger geliefert werden, ist kein Wertersatz zu leisten.
      </p>

      <h2>Vorzeitiges Erlöschen des Rücktritts- bzw. Widerrufsrechts</h2>
      {/* Die dritte Bedingung stand hier bis 07/2026 nicht, weil es sie in der Praxis nicht
          gab: § 18 Abs. 1 Z 11 lit. c verlangt zusätzlich die Vertragsbestätigung nach
          § 7 Abs. 3 auf einem dauerhaften Datenträger. Seit dem Umbau des Kaufs geht sie als
          E-Mail raus (lib/pro-purchase-mail.ts), bevor freigeschaltet wird. Eine Belehrung,
          die eine Bedingung verschweigt, die wir selbst erfüllen müssen, wäre unvollständig
          und im Streitfall wertlos. */}
      <p>
        Bei digitalen Inhalten, die nicht auf einem körperlichen Datenträger geliefert werden
        (Freischaltung der Pro-Inhalte), <strong>erlischt dein Recht</strong>, wenn wir mit der
        Ausführung des Vertrags begonnen haben, nachdem
      </p>
      <ol>
        <li>
          du ausdrücklich verlangt hast, dass wir mit der Ausführung vor Ablauf der Frist beginnen,
        </li>
        <li>
          du deine Kenntnis davon bestätigt hast, dass du dadurch dein Rücktritts- bzw.
          Widerrufsrecht verlierst, und
        </li>
        <li>
          wir dir eine Bestätigung des Vertrags auf einem dauerhaften Datenträger zur Verfügung
          gestellt haben (§ 18 Abs. 1 Z 11 FAGG in Verbindung mit § 7 Abs. 3 FAGG).
        </li>
      </ol>
      <p>
        Die ersten beiden Punkte holen wir im Bestellvorgang gesondert ein: mit einem Häkchen, das
        du selbst setzen musst und das nicht vorausgewählt ist. Den dritten erfüllen wir mit der
        Kaufbestätigung, die unmittelbar nach der Zahlung an die von dir angegebene E-Mail-Adresse
        geht, bevor wir freischalten. Deine Zustimmung ist darin im Wortlaut und mit Zeitpunkt
        festgehalten.
      </p>
      <p>
        Der KI-Assistent ohne Begrenzung ist eine unentgeltliche Zugabe und nicht Teil der
        bezahlten Leistung; auf ihn entfällt kein Preisanteil (Punkt 2 und 5 der{" "}
        <Link href="/rechtliches/agb">AGB</Link>). Für ihn gibt es daher nichts zurückzuzahlen.
        Würde ein laufend erbrachter Teil dennoch als entgeltlich angesehen, bliebe dein Recht
        insoweit bis zur vollständigen Erbringung bestehen (§ 18 Abs. 1 Z 1 FAGG) und ein
        Wertersatz bemäße sich nach § 16 FAGG (siehe „Folgen des Widerrufs“).
      </p>

      <h2>Muster-Widerrufsformular</h2>
      <p>
        (Wenn du den Vertrag widerrufen willst, fülle dieses Formular aus und sende es an uns
        zurück.)
      </p>
      <p>
        An {LEGAL.company}, {legalAddress()}, E-Mail: {LEGAL.email}:
        <br />
        <br />
        — Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf
        der folgenden Waren (*) / die Erbringung der folgenden Dienstleistung (*): Freischaltung von
        SalzGuide Pro
        <br />
        — Bestellt am (*) / erhalten am (*): ____________
        <br />
        — Name des/der Verbraucher(s): ____________
        <br />
        — Anschrift des/der Verbraucher(s): ____________
        <br />
        — Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): ____________
        <br />
        — Datum: ____________
        <br />
        <br />
        (*) Unzutreffendes streichen.
      </p>
    </LegalShell>
  );
}
