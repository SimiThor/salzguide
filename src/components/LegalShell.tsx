import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Einheitlicher Rahmen für alle Rechtstexte: iOS-2026-Typografie, „Zurück zur App",
// Stand-Datum, dezenter Deutsch-Hinweis auf /en und der Footer mit den Rechts-Links.
export default async function LegalShell({
  locale,
  title,
  updated,
  children,
}: {
  locale: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("Legal");

  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <span aria-hidden>‹</span> {t("backToApp")}
      </Link>

      <h1 className="mt-4 text-[26px] font-bold leading-tight tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-1.5 text-[13px] text-muted">
        {t("updated")}: {updated}
      </p>

      {locale !== "de" && (
        <p className="mt-4 rounded-[14px] bg-black/[0.04] px-4 py-3 text-[13px] leading-snug text-muted">
          {t("deOnly")}
        </p>
      )}

      {/* Prose: einheitliche Abstände/Farben für Überschriften, Absätze, Listen, Links. */}
      <div className="mt-6 text-[15px] leading-relaxed text-muted [&_a]:text-accent [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-9 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mb-1 [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-1 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-3 [&_strong]:text-ink [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </div>
  );
}
