import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSavedEventIds, getUpcomingEvents } from "@/lib/events";
import { lastEventDay, rangeLabel, viennaDayKey } from "@/lib/events-format";
import { alternatesFor, ogFor } from "@/lib/metadata";
import { eventsLd } from "@/lib/jsonld";
import JsonLd from "@/components/JsonLd";
import EventsWeek from "@/components/EventsWeek";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // SEO-Titel/-Beschreibung leben im Meta-Namensraum, entkoppelt von der sichtbaren
  // Überschrift (Events.title bleibt die h1): Suchbegriff und Seitentitel dürfen sich
  // unterscheiden, ohne dass die Seite ihre Sprache ändert.
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("eventsTitle"),
    description: t("eventsDescription"),
    alternates: alternatesFor(locale, "/events"),
    ...ogFor({
      locale,
      path: "/events",
      title: t("eventsTitle"),
      description: t("eventsDescription"),
    }),
  };
}

export default async function EventsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [events, saved] = await Promise.all([
    getUpcomingEvents(locale),
    getSavedEventIds(),
  ]);
  const todayKey = viennaDayKey(new Date().toISOString());
  // Bis wohin die Datumsauswahl reicht — und ihre Ausgangs-Beschriftung.
  //
  // Die Beschriftung entsteht bewusst HIER und nicht in der Client-Komponente: Sie kommt aus
  // Intl.formatRange(), und dessen Spannen-Muster unterscheiden sich zwischen dem ICU von
  // Node und dem des Browsers (siehe rangeLabel in lib/events-format.ts). Im Client
  // gerechnet stünde beim Hydrieren ein anderer Text da als im vorgerenderten HTML, und
  // React verwirft dann den ganzen Teilbaum. Serverseitig formatiert ist es EIN String,
  // über den es nichts zu streiten gibt.
  const maxDay = lastEventDay(events, todayKey);
  return (
    <>
      {/* Strukturierte Daten: die Event-Liste als schema.org-ItemList (lib/jsonld.ts). */}
      <JsonLd data={eventsLd(events)} />
      <EventsWeek
        events={events}
        todayKey={todayKey}
        maxDay={maxDay}
        spanLabel={rangeLabel({ from: todayKey, to: maxDay }, locale)}
        savedIds={saved.ids}
        loggedIn={saved.loggedIn}
      />
    </>
  );
}
