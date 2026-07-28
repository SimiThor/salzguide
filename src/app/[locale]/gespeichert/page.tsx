import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSavedSpots } from "@/lib/saved";
import { getSavedEvents } from "@/lib/events";
import { viennaDayKey } from "@/lib/events-format";
import { googleLoginEnabled } from "@/lib/auth-providers";
import { getRelaunchNotice } from "@/lib/settings";
import LoginPanel from "@/components/auth/LoginPanel";
import { BookmarkFilled } from "@/components/icons";
import SavedSpots from "@/components/SavedSpots";
import SavedEventsList from "@/components/SavedEventsList";

const PAD = "pt-[var(--sg-page-top)] md:pt-6";

// Die Merkliste ist eine private Seite: Google soll sie nicht als Suchtreffer führen
// (noindex), darf ihren Links aber folgen (follow). Gleiches Muster wie /rechtliches.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Saved" });
  return { title: t("title"), robots: { index: false, follow: true } };
}

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

  // Nicht eingeloggt: derselbe Login-Screen wie überall, nur mit dem Anlass "saved"
  // (Lesezeichen + "Deine Merkliste"). Die eigene Überschrift und der eigene Erklärsatz
  // sind weg: Sie sagten dasselbe wie der Login-Kopf, nur anders formuliert.
  if (spots === null) {
    return (
      <div className="mx-auto w-full max-w-[380px] px-5 pt-[calc(var(--sg-page-top)+8px)] pb-10 md:pt-10">
        <LoginPanel
          reason="saved"
          titleAs="h1"
          googleEnabled={await googleLoginEnabled()}
          relaunchNotice={await getRelaunchNotice()}
        />
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
          {/* Dasselbe Lesezeichen wie auf dem Login-Screen, auf jedem Merken-Knopf und in
              der unteren Leiste. Hier stand vorher das Emoji dazu: dieselbe Sache in einer
              zweiten Form, und die passte weder zur Strichstärke noch zur Farbe daneben. */}
          <span
            className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent/10"
            aria-hidden
          >
            <BookmarkFilled className="h-6 w-6 text-accent" />
          </span>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{t("empty")}</p>
          <Link
            href="/explore"
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
