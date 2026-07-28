import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

// Lokalisierte 404 statt der nackten Next-Standardseite. Wird über den Catch-all
// ([...rest]/page.tsx) für jede unbekannte Adresse unter einer gültigen Sprache
// erreicht und rendert im normalen App-Rahmen (Header/Nav aus dem Locale-Layout).
// Bewusst ohne Cookie-Zugriffe: Die Seite braucht nichts vom Betrachter.
export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <div className="text-5xl" aria-hidden>
        🗺️
      </div>
      <h1 className="mt-4 text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
        {t("body")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/explore"
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          {t("exploreCta")}
        </Link>
        <Link
          href="/"
          className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink shadow-sm transition active:scale-[0.98]"
        >
          {t("homeCta")}
        </Link>
      </div>
    </div>
  );
}
