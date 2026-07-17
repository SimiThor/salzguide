import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSavedEventIds, getUpcomingEvents } from "@/lib/events";
import { viennaDayKey } from "@/lib/events-format";
import { alternatesFor } from "@/lib/metadata";
import EventsWeek from "@/components/EventsWeek";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Events" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: alternatesFor(locale, "/events"),
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
  return (
    <EventsWeek
      events={events}
      todayKey={todayKey}
      savedIds={saved.ids}
      loggedIn={saved.loggedIn}
    />
  );
}
