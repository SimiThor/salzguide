import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import BackButton from "@/components/BackButton";
import { LOCALES, safeLocale } from "@/i18n/locales";
import ScrollStrip from "@/components/ScrollStrip";
import { renderProGift } from "@/lib/pro-gift-mail";
import { renderProPurchase } from "@/lib/pro-purchase-mail";
import { renderWithdrawal } from "@/lib/withdrawal-mail";
import { previewLoginMail } from "@/lib/login-link";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Alle Mails ansehen, in jeder Sprache, ohne eine einzige zu verschicken.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM ES DIESE SEITE GIBT: Eine Mail kann man nicht zurückholen. Bis hierher gab es genau
// eine Vorschau, die der Umzugs-Mail, und die auch nur, weil ihre Texte im Admin stehen. Die
// anderen sah man erst im eigenen Postfach — also erst, nachdem man selbst etwas gekauft,
// widerrufen oder sich Pro geschenkt hatte. Für acht Fremdsprachen ging das gar nicht.
//
// Sie rendert GENAU DAS, was rausgeht: dieselben Funktionen, derselbe Rahmen, dieselben
// Sprachdateien. Es ist keine Nachbildung, sondern der Ernstfall ohne Empfänger.
//
// Die Umzugs-Mail fehlt hier mit Absicht: Ihre Texte kommen aus dem Admin, deshalb liegt
// ihre Vorschau dort, wo man sie schreibt (/admin/users/migration).
export const dynamic = "force-dynamic";

/** Beispielwerte. Erfunden, aber in der Form, in der echte Werte ankommen. */
const SAMPLE_EMAIL = "du@example.at";

export default async function AdminMailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Welche Sprache angeschaut wird, steht in der Adresse: So ist eine bestimmte Vorschau
  // verlinkbar („schau dir mal die koreanische Kaufbestätigung an") und ein Neuladen zeigt
  // wieder dasselbe.
  const lang = safeLocale((await searchParams).lang);

  // Fester Zeitpunkt statt `new Date()`: Sonst wechselt bei jedem Neuladen die Uhrzeit in
  // der Vorschau, und man sucht den Unterschied bei sich statt bei der Uhr.
  const sampleDate = "2026-07-27T10:30:00.000Z";

  const [login, gift, purchase, withdrawal] = await Promise.all([
    previewLoginMail(lang, SAMPLE_EMAIL),
    renderProGift(lang),
    renderProPurchase({
      email: SAMPLE_EMAIL,
      price: "19,90 €",
      paidAt: sampleDate,
      consentAt: sampleDate,
      reference: "pi_3RexampleReference",
      guest: true,
      locale: lang,
    }),
    renderWithdrawal({
      name: "Anna Beispiel",
      email: SAMPLE_EMAIL,
      address: "Beispielweg 1, 5020 Salzburg",
      contract: "SalzGuide Pro, pi_3RexampleReference",
      orderDate: "20.07.2026",
      note: "Ich möchte den Vertrag widerrufen.",
      receivedAt: sampleDate,
      locale: lang,
    }),
  ]);

  const mails = [
    {
      title: "Anmeldelink",
      when: "Bei jeder Anmeldung, und nach einem Gast-Kauf. Sprache: aus dem Formular.",
      mail: login,
    },
    {
      title: "Pro geschenkt",
      when: "Wenn du im Admin jemandem Pro gibst. Sprache: aus dem Profil.",
      mail: gift,
    },
    {
      title: "Kaufbestätigung",
      when: "Sofort nach einer Zahlung, hier als Gast-Kauf. Sprache: aus der Stripe-Session.",
      mail: purchase,
    },
    {
      title: "Widerruf eingegangen",
      when: "Wenn jemand das Widerrufsformular abschickt. Sprache: aus der Seite.",
      mail: withdrawal,
    },
  ];

  return (
    <div className="space-y-4 pb-12">
      <BackButton fallbackHref="/admin/settings" label="Einstellungen" />
      <div>
        <h1 className="text-2xl font-bold text-ink">Mails</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Genau das, was bei den Leuten ankommt. Hier wird nichts verschickt.
        </p>
      </div>

      {/* Die Sprachleiste. Neun Pillen sind auf jedem Handy und auch im 820px-Admin-Rahmen
          breiter als der Platz, deshalb der gemeinsame Scroll-Streifen: Er fängt die
          Überbreite ab, lässt sich mit der Maus ziehen und schneidet die letzte Pille nicht
          hart ab (siehe ScrollStrip.tsx). */}
      <ScrollStrip>
        <div className="flex w-max gap-2">
          {LOCALES.map((l) => (
            <Link
              key={l.code}
              href={`/admin/settings/mails?lang=${l.code}`}
              scroll={false}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition ${
                l.code === lang
                  ? "bg-accent text-white"
                  : "bg-white text-ink shadow-sm ring-1 ring-black/5 hover:ring-black/15"
              }`}
            >
              <span aria-hidden>{l.flag}</span>
              {l.name}
            </Link>
          ))}
        </div>
      </ScrollStrip>

      {mails.map((m) => (
        <section key={m.title} className="rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="text-[17px] font-bold text-ink">{m.title}</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{m.when}</p>
          <p className="mt-3 text-[12px] text-muted">
            Betreff: <span className="font-semibold text-ink">{m.mail.subject}</span>
          </p>
          {/* iframe mit srcDoc: Die Mail bringt ein ganzes HTML-Dokument mit eigenem Body
              und eigenen Farben mit. Direkt in die Seite gehängt, würden sich ihre Stile und
              die des Admins gegenseitig anfassen, und die Vorschau zeigte etwas, das so nie
              ankommt. Im iframe steht sie für sich, wie in einem Mail-Programm.
              sandbox ohne allow-scripts: In einer Mail läuft ohnehin kein JavaScript. */}
          <iframe
            title={`${m.title} (${lang})`}
            srcDoc={m.mail.html}
            sandbox=""
            className="mt-3 h-[640px] w-full rounded-[14px] border border-black/10 bg-cream"
          />
          {/* Die Reintext-Fassung geht bei JEDER Mail mit raus (siehe lib/email.ts) und ist
              das, was Vorschau-Zeilen und Spamfilter lesen. Sie muss also auch stimmen, und
              genau deshalb steht sie hier und nicht nur die schöne Fassung. */}
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-muted">
              Reintext-Fassung
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[12px] bg-black/[0.03] p-3 text-[12px] leading-relaxed text-ink">
              {m.mail.text}
            </pre>
          </details>
        </section>
      ))}
    </div>
  );
}
