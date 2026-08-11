"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  dayLabel,
  eventsInRange,
  EVENT_CATEGORIES,
  groupByDay,
  rangeLabel,
  type DayRange,
  type EventCategory,
  type EventItem,
} from "@/lib/events-format";
import DateRangeSheet from "./DateRangeSheet";
import EventCard from "./EventCard";
import ScrollStrip from "./ScrollStrip";
import { Calendar, ChevronDown } from "./icons";
import { BTN_SECONDARY_SM, STATUS_ACCENT } from "@/lib/ui";

type Filter = "all" | "highlights" | "free" | EventCategory;

export default function EventsWeek({
  events,
  todayKey,
  maxDay,
  spanLabel,
  savedIds,
  loggedIn,
}: {
  events: EventItem[];
  todayKey: string; // Wiener Kalendertag von "heute" (server-seitig -> mismatch-frei)
  maxDay: string; // letzter Tag mit Inhalt = Ende der Datumsauswahl
  spanLabel: string; // „11.–30. August", server-seitig formatiert (siehe events/page.tsx)
  savedIds: string[];
  loggedIn: boolean;
}) {
  const t = useTranslations("Events");
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  // Gewählter Zeitraum; null = alles, was wir haben (der Normalfall beim Ankommen).
  const [range, setRange] = useState<DayRange | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  // Erst die Kategorie, dann der Zeitraum — in dieser Reihenfolge, weil die Datumsauswahl
  // die kategoriegefilterte Menge braucht: Ihre Punkte und ihr Zähler sollen zeigen, was
  // der Nutzer nach dem Anwenden wirklich sieht.
  const byCategory = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "highlights") return events.filter((e) => e.isHighlight);
    if (filter === "free") return events.filter((e) => e.isFree);
    return events.filter((e) => e.category === filter);
  }, [events, filter]);

  const filtered = useMemo(
    () => eventsInRange(byCategory, range),
    [byCategory, range],
  );

  // Mehrtägige Events hängen sich an den ersten gezeigten Tag: ohne Zeitraum an heute, mit
  // Zeitraum an dessen Anfang. Sonst stünde über der Auswahl eine Überschrift, die gar
  // nicht darin liegt.
  const days = useMemo(() => {
    const clamp = range && range.from > todayKey ? range.from : todayKey;
    return groupByDay(filtered, clamp);
  }, [filtered, todayKey, range]);

  // Beschriftung der Datums-Pille. Ohne Auswahl steht dort die volle Spanne, und die kommt
  // fertig vom Server (siehe events/page.tsx) — sie ist der einzige Stand, der vorgerendert
  // wird. Sobald jemand gewählt hat, ist es reine Client-Sache und darf hier entstehen.
  const chipLabel = range ? rangeLabel(range, locale) : spanLabel;

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: t("all") },
    ...(hasHighlights
      ? [{ key: "highlights" as Filter, label: t("highlights") }]
      : []),
    ...(hasFree ? [{ key: "free" as Filter, label: t("free") }] : []),
    ...presentCats.map((c) => ({ key: c as Filter, label: t(`cat.${c}`) })),
  ];

  const PAD = "pt-[var(--sg-page-top)] md:pt-6";

  return (
    <div className={`mx-auto w-full max-w-[640px] px-4 ${PAD}`}>
      {/* Kopf: Titel + Datumsauswahl. Die Spanne stand hier früher als reine Angabe —
          jetzt ist sie der Knopf, der den Kalender aufmacht. Deshalb trägt sie das
          Knopf-Aussehen aus lib/ui.ts (flach gefüllt, ohne Rand, mit Press-Feedback) und
          nicht mehr das einer Status-Kennzeichnung: „Rand heisst Zustand." Ist ein
          Zeitraum gewählt, wird sie dunkel — dieselbe Sprache wie die Filter-Pillen. */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t("title")}
        </h1>
        {events.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            // ml-auto: Reicht die Zeile in einer langen Sprache nicht, rutscht die Pille
            // unter die Überschrift — und soll dort trotzdem rechts stehen bleiben.
            className={`cursor-pointer ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.98] ${
              range ? "bg-ink text-white" : "bg-black/5 text-ink"
            }`}
          >
            <Calendar className="h-[15px] w-[15px]" />
            {chipLabel}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
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
          {/* Kategorie-Filter-Pills im gemeinsamen Scroll-Streifen (siehe ScrollStrip.tsx):
              fängt die Überbreite ab, lässt sich am Desktop mit der Maus ziehen und läuft am
              Rand aus statt eine Pille mittendurch zu schneiden. */}
          <ScrollStrip className="mt-4">
            <div className="flex w-max gap-2">
              {pills.map((p) => {
                const active = filter === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setFilter(p.key)}
                    aria-pressed={active}
                    className={`cursor-pointer shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
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
          </ScrollStrip>

          {/* Tage */}
          {days.length === 0 ? (
            range ? (
              // Sackgasse mit Ausgang: Wer einen leeren Zeitraum erwischt, kommt mit einem
              // Tipp zurück zu allem — ohne den Kalender noch einmal aufzumachen.
              <div className="mt-8 rounded-[18px] bg-white p-8 text-center shadow-sm">
                <p className="text-4xl" aria-hidden>
                  📅
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">
                  {t("dateFilter.empty")}
                </p>
                <button
                  type="button"
                  onClick={() => setRange(null)}
                  className={`${BTN_SECONDARY_SM} mt-4`}
                >
                  {t("dateFilter.allDates")}
                </button>
              </div>
            ) : (
              <p className="mt-8 text-center text-[15px] text-muted">
                {t("noneFiltered")}
              </p>
            )
          ) : (
            <div className="mt-5 space-y-10 md:space-y-12">
              {days.map((d) => {
                const { weekday, date } = dayLabel(d.key, locale);
                const today = d.key === todayKey;
                return (
                  <section key={d.key}>
                    <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                      <span className="text-ink">{weekday}</span>
                      <span>{date}</span>
                      {today && (
                        <span className={`normal-case ${STATUS_ACCENT}`}>
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

      {events.length > 0 && (
        <DateRangeSheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          events={byCategory}
          todayKey={todayKey}
          maxDay={maxDay}
          value={range}
          onApply={setRange}
        />
      )}
    </div>
  );
}
