"use client";

import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { deleteEvent, setEventStatus } from "@/lib/event-actions";
import type { AdminEventRow } from "@/lib/events";
import { CATEGORY_LABEL } from "@/lib/events-format";
import { BTN_PRIMARY_SM, BTN_SECONDARY_SM, STATUS_NEUTRAL } from "@/lib/ui";
const RejectIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// Admin-Events-Liste als schnelles Triage-Tool: pro Zeile freigeben (→ live) ODER
// ablehnen (✕). Optimistisch + iOS-Animation (Zeile gleitet raus); bei Serverfehler
// kommt die Zeile zurück (robust). Entwürfe werden direkt gelöscht (Zeitersparnis),
// veröffentlichte fragen kurz nach. Vergangene Events („vorbei") landen gedimmt in
// einem eingeklappten Bereich -> die Arbeitsliste oben bleibt aufgeräumt.
export default function AdminEventList({
  events: initial,
}: {
  events: AdminEventRow[];
}) {
  const [events, setEvents] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [, start] = useTransition();

  // Server-Daten übernehmen, sobald sie sich ändern (z.B. nach router.refresh()
  // durch die KI-Wochenrecherche) -> neue Events erscheinen ohne manuellen Reload.
  // React-Muster „State beim Prop-Wechsel angleichen" (kein useEffect nötig).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setEvents(initial);
  }

  const upcoming = useMemo(
    () =>
      events
        .filter((e) => !e.isPast)
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1)),
    [events],
  );
  const past = useMemo(
    () =>
      events
        .filter((e) => e.isPast)
        .sort((a, b) => (a.startsAt > b.startsAt ? -1 : 1)), // jüngst-vergangene zuerst
    [events],
  );

  function togglePublish(ev: AdminEventRow) {
    const next = ev.status === "published" ? "draft" : "published";
    // Veröffentlichen-Gate (Anti-Chaos): nicht live schalten, solange nicht alle Sprachen
    // aktuell übersetzt sind. Der Server blockt zusätzlich – das hier ist die schnelle UX.
    if (next === "published" && ev.trState !== "complete") {
      alert(
        `„${ev.title}“ ist noch nicht in alle Sprachen übersetzt (${ev.trPresent}/${ev.trTotal}). ` +
          "Bitte zuerst das Event öffnen und „🌍 In alle Sprachen übersetzen“.",
      );
      return;
    }
    setEvents((cur) =>
      cur.map((e) => (e.id === ev.id ? { ...e, status: next } : e)),
    );
    setBusy(ev.id);
    start(async () => {
      const r = await setEventStatus(ev.id, next);
      setBusy(null);
      if (!r.ok) {
        setEvents((cur) =>
          cur.map((e) => (e.id === ev.id ? { ...e, status: ev.status } : e)),
        );
        if (next === "published")
          alert(
            r.error === "translations_incomplete"
              ? "Veröffentlichen nicht möglich – erst in alle Sprachen übersetzen (Event öffnen → „🌍 In alle Sprachen übersetzen“)."
              : "Veröffentlichen gerade nicht möglich – bitte erneut versuchen.",
          );
      }
    });
  }

  function reject(ev: AdminEventRow) {
    if (ev.status === "published" && !confirm(`„${ev.title}" wirklich löschen?`))
      return;
    setEvents((cur) => cur.filter((e) => e.id !== ev.id)); // optimistisch raus
    start(async () => {
      const r = await deleteEvent(ev.id);
      if (!r.ok)
        setEvents((cur) =>
          [...cur, ev].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1)),
        ); // Fehler -> zurück
    });
  }

  function rowMain(ev: AdminEventRow) {
    return (
      <Link
        href={`/admin/events/${ev.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 active:opacity-70"
      >
        <span className="text-lg" aria-hidden>
          {ev.isHighlight ? "⭐" : "📅"}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium text-ink">
            {ev.title}
          </span>
          <span className="text-xs text-muted">
            {ev.whenLabel} · {CATEGORY_LABEL[ev.category] ?? ev.category}
            {ev.locationName ? ` · ${ev.locationName}` : ""} ·{" "}
            <span
              className={
                ev.trState === "complete"
                  ? "text-green-700"
                  : ev.trState === "stale"
                    ? "text-accent"
                    : "text-amber-700"
              }
              title={`${ev.trPresent}/${ev.trTotal} Sprachen`}
            >
              {ev.trState === "complete"
                ? "🌍 ✓"
                : ev.trState === "stale"
                  ? "🌍 ⚠"
                  : `🌍 ${ev.trPresent}/${ev.trTotal}`}
            </span>
          </span>
        </span>
      </Link>
    );
  }

  const rejectBtn = (ev: AdminEventRow) => (
    <button
      type="button"
      onClick={() => reject(ev)}
      aria-label="Ablehnen"
      title="Ablehnen (löschen)"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-accent/10 hover:text-accent active:scale-90"
    >
      <RejectIcon />
    </button>
  );

  if (events.length === 0) {
    return (
      <div className="rounded-[16px] bg-white px-4 py-6 text-center text-sm text-muted shadow-sm">
        Noch keine Events — leg das erste an oder nutze die KI-Wochenrecherche.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Kommende & aktuelle Events */}
      {upcoming.length > 0 ? (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
          <AnimatePresence initial={false}>
            {upcoming.map((ev) => {
              const published = ev.status === "published";
              return (
                <motion.li
                  key={ev.id}
                  layout
                  exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                  className="flex items-center gap-2 bg-white px-4 py-3"
                >
                  {rowMain(ev)}
                  <button
                    type="button"
                    disabled={busy === ev.id}
                    onClick={() => togglePublish(ev)}
                    title={published ? "Auf Entwurf setzen" : "Veröffentlichen"}
                    // Ein KNOPF, kein Badge: Er sah exakt aus wie die Status-Kennzeichnung
                    // zwei Zeilen darunter, unterschieden nur durch die Schriftstärke.
                    className={`shrink-0 ${
                      published
                        ? BTN_SECONDARY_SM
                        : BTN_PRIMARY_SM
                    }`}
                  >
                    {busy === ev.id ? "…" : published ? "live" : "→ live"}
                  </button>
                  {rejectBtn(ev)}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="rounded-[16px] bg-white px-4 py-5 text-center text-sm text-muted shadow-sm">
          Keine kommenden Events. Neues anlegen oder KI-Woche recherchieren.
        </p>
      )}

      {/* Vergangene Events – eingeklappt, gedimmt */}
      {past.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="flex w-full items-center gap-2 px-1 py-1 text-[13px] font-medium text-muted"
          >
            <span className={`transition-transform ${showPast ? "rotate-90" : ""}`}>
              ›
            </span>
            {past.length} vergangene {past.length === 1 ? "Event" : "Events"}
          </button>

          <AnimatePresence initial={false}>
            {showPast && (
              <motion.ul
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm"
              >
                <AnimatePresence initial={false}>
                  {past.map((ev) => (
                    <motion.li
                      key={ev.id}
                      layout
                      exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
                      className="flex items-center gap-2 bg-white px-4 py-3 opacity-60"
                    >
                      {rowMain(ev)}
                      <span className={`shrink-0 ${STATUS_NEUTRAL}`}>
                        vorbei
                      </span>
                      {rejectBtn(ev)}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
