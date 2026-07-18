"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { dayLabel, groupByDay, type EventItem } from "@/lib/events-format";
import EventCard from "./EventCard";
import { STATUS_ACCENT } from "@/lib/ui";

// iOS-artige Entfern-Animation (fade + leicht schrumpfen, Lücke federt zu).
const EXIT = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, transition: { duration: 0.18 } },
  transition: { type: "spring" as const, stiffness: 420, damping: 32 },
};

// Gespeicherte Events, nach Tag gruppiert, mit eigener Überschrift. Beim
// Ent-Merken gleitet das Event animiert raus; wird ein Tag leer, verschwindet die
// Tages-Sektion; ist alles weg, blendet sich die ganze Sektion aus. Keine Karte.
export default function SavedEventsList({
  events,
  title,
  todayKey,
  className = "",
}: {
  events: EventItem[];
  title: string;
  todayKey: string; // Wiener Kalendertag „heute" (server-seitig -> mismatch-frei)
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("Events");
  const [items, setItems] = useState(events);
  const days = useMemo(() => groupByDay(items, todayKey), [items, todayKey]);

  function handleSavedChange(id: string, saved: boolean) {
    if (!saved) setItems((cur) => cur.filter((e) => e.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <section className={className}>
      <h2 className="mb-3 px-4 text-xl font-bold text-ink">{title}</h2>
      <div className="space-y-6 px-4">
        <AnimatePresence initial={false}>
          {days.map((d) => {
            const { weekday, date } = dayLabel(d.key, locale);
            return (
              <motion.div key={d.key} layout {...EXIT}>
                <h3 className="mb-2.5 flex items-baseline gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                  <span className="text-ink">{weekday}</span>
                  <span>{date}</span>
                  {d.key === todayKey && (
                    <span className={`normal-case ${STATUS_ACCENT}`}>
                      {t("today")}
                    </span>
                  )}
                </h3>
                <div className="space-y-2.5">
                  <AnimatePresence initial={false}>
                    {d.events.map((e) => (
                      <motion.div key={e.id} layout {...EXIT}>
                        <EventCard
                          event={e}
                          saved
                          loggedIn
                          onSavedChange={(s) => handleSavedChange(e.id, s)}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
