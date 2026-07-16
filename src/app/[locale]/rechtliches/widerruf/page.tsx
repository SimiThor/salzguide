import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
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
        (FAGG) beim kostenpflichtigen Kauf von „SalzGuide Pro“.
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

      <h2>Vorzeitiges Erlöschen des Widerrufsrechts</h2>
      <p>
        Bei digitalen Inhalten, die nicht auf einem körperlichen Datenträger geliefert werden
        (Freischaltung von SalzGuide Pro), <strong>erlischt dein Widerrufsrecht</strong>, wenn wir
        mit der Ausführung des Vertrags begonnen haben, nachdem du
      </p>
      <ol>
        <li>
          ausdrücklich zugestimmt hast, dass wir mit der Ausführung vor Ablauf der Widerrufsfrist
          beginnen, und
        </li>
        <li>
          deine Kenntnis davon bestätigt hast, dass du durch diese Zustimmung mit Beginn der
          Ausführung dein Widerrufsrecht verlierst (§ 18 Abs. 1 Z 11 FAGG).
        </li>
      </ol>
      <p>Diese Zustimmung und Bestätigung holen wir im Bestellvorgang gesondert ein.</p>

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
