"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  dayLabel,
  EVENT_CATEGORIES,
  groupByDay,
  type EventCategory,
  type EventItem,
} from "@/lib/events-format";
import EventCard from "./EventCard";

type Filter = "all" | "highlights" | "free" | EventCategory;

export default function EventsWeek({
  events,
  todayKey,
  savedIds,
  loggedIn,
}: {
  events: EventItem[];
  todayKey: string; // Wiener Kalendertag von "heute" (server-seitig -> mismatch-frei)
  savedIds: string[];
  loggedIn: boolean;
}) {
  const t = useTranslations("Events");
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);

  // Nur relevante Filter-Pills anbieten (was tatsächlich vorhanden ist).
  const hasHighlights = useMemo(
    () => events.some((e) => e.isHighlight),
    [events],
  );
  const hasFree = useMemo(() => events.some((e) => e.isFree), [events]);
  const presentCats = useMemo(
    () => EVENT_CATEGORIES.filter((c) => events.some((e) => e.category === c)),
    [events],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "highlights") return events.filter((e) => e.isHighlight);
    if (filter === "free") return events.filter((e) => e.isFree);
    return events.filter((e) => e.category === filter);
  }, [events, filter]);

  const days = useMemo(() => groupByDay(filtered), [filtered]);

  // Datums-Pill: Spanne der aktuell gezeigten Tage.
  const span = useMemo(() => {
    if (days.length === 0) return null;
    const first = dayLabel(days[0].key, locale).date;
    const last = dayLabel(days[days.length - 1].key, locale).date;
    return first === last ? first : `${first} – ${last}`;
  }, [days, locale]);

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: t("all") },
    ...(hasHighlights
      ? [{ key: "highlights" as Filter, label: t("highlights") }]
      : []),
    ...(hasFree ? [{ key: "free" as Filter, label: t("free") }] : []),
    ...presentCats.map((c) => ({ key: c as Filter, label: t(`cat.${c}`) })),
  ];

  const PAD = "pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6";

  return (
    <div className={`mx-auto w-full max-w-[640px] px-4 ${PAD}`}>
      {/* Kopf: Titel + Wochenspanne */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t("title")}
        </h1>
        {span && (
          <span className="rounded-full bg-white px-3 py-1 text-[13px] font-medium text-muted shadow-sm ring-1 ring-black/[0.04]">
            {span}
          </span>
        )}
      </div>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">
        {t("subtitle")}
      </p>

      {events.length === 0 ? (
        <div className="mt-8 rounded-[18px] bg-white p-8 text-center shadow-sm">
          <p className="text-4xl" aria-hidden>
            📅
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {t("empty")}
          </p>
        </div>
      ) : (
        <>
          {/* Kategorie-Filter-Pills (horizontal scrollbar) */}
          <div className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-2">
              {pills.map((p) => {
                const active = filter === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setFilter(p.key)}
                    aria-pressed={active}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                      active
                        ? "bg-ink text-white"
                        : "bg-black/[0.06] text-ink/70 active:bg-black/[0.1]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tage */}
          {days.length === 0 ? (
            <p className="mt-8 text-center text-[15px] text-muted">
              {t("noneFiltered")}
            </p>
          ) : (
            <div className="mt-5 space-y-6">
              {days.map((d) => {
                const { weekday, date } = dayLabel(d.key, locale);
                const today = d.key === todayKey;
                return (
                  <section key={d.key}>
                    <h2 className="mb-2.5 flex items-baseline gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                      <span className="text-ink">{weekday}</span>
                      <span>{date}</span>
                      {today && (
                        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold normal-case text-accent">
                          {t("today")}
                        </span>
                      )}
                    </h2>
                    <div className="space-y-2.5">
                      {d.events.map((e) => (
                        <EventCard
                          key={e.id}
                          event={e}
                          saved={savedSet.has(e.id)}
                          loggedIn={loggedIn}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
