import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSavedSpots } from "@/lib/saved";
import { getSavedEvents } from "@/lib/events";
import { viennaDayKey } from "@/lib/events-format";
import LoginForm from "@/components/LoginForm";
import SavedSpots from "@/components/SavedSpots";
import SavedEventsList from "@/components/SavedEventsList";

const PAD = "pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6";

export default async function GespeichertPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Saved");
  const [spots, events] = await Promise.all([
    getSavedSpots(locale),
    getSavedEvents(locale),
  ]);

  // Nicht eingeloggt (beide liefern null)
  if (spots === null) {
    return (
      <div className={`mx-auto w-full max-w-[440px] px-4 ${PAD}`}>
        <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>
        <p className="mt-1.5 mb-5 text-[15px] leading-relaxed text-muted">
          {t("loginNeeded")}
        </p>
        <LoginForm />
      </div>
    );
  }

  const savedEvents = events ?? [];
  const hasEvents = savedEvents.length > 0;
  const hasSpots = spots.length > 0;

  // Nichts gespeichert
  if (!hasEvents && !hasSpots) {
    return (
      <div className={`mx-auto w-full max-w-[640px] px-4 ${PAD}`}>
        <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>
        <div className="mt-8 rounded-[18px] bg-white p-8 text-center shadow-sm">
          <p className="text-4xl" aria-hidden>
            🔖
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">{t("empty")}</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white active:scale-[0.98]"
          >
            {t("discover")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`mx-auto w-full max-w-[640px] ${PAD}`}>
      <h1 className="px-4 text-2xl font-bold text-ink">{t("title")}</h1>

      {/* Spots – Hauptfeature, zuerst, mit Karte (Entmerken zieht in Liste + Karte mit) */}
      {hasSpots && (
        <SavedSpots spots={spots} title={t("spotsTitle")} className="mt-5" />
      )}

      {/* Events – sekundär, darunter, NICHT auf der Karte */}
      {hasEvents && (
        <SavedEventsList
          events={savedEvents}
          title={t("eventsTitle")}
          todayKey={viennaDayKey(new Date().toISOString())}
          className={hasSpots ? "mt-8" : "mt-5"}
        />
      )}
    </div>
  );
}
