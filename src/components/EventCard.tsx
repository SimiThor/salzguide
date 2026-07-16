"use client";

import { useState, useTransition } from "react";
import { bcp47 } from "@/i18n/locales";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { eventTimeLabel, type EventItem } from "@/lib/events-format";
import { toggleSavedEvent } from "@/lib/saved-event-actions";
import { isOperatorClient } from "@/lib/analytics-operator";
import { safeHttpUrl } from "@/lib/url";
import { Bookmark, BookmarkFilled } from "./icons";

function StarBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 7.1-1.01L12 2z" />
      </svg>
      {label}
    </span>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 17L17 7M17 7H8M17 7v9" />
    </svg>
  );
}

// Event-Karte (iOS-Look) mit Merken-Bookmark. Wird in der Wochenansicht UND auf
// der Gespeichert-Seite genutzt. onSavedChange -> Aufrufer kann reagieren
// (z.B. abgespeichertes Event aus der Merkliste entfernen).
export default function EventCard({
  event: e,
  saved: initialSaved,
  loggedIn,
  onSavedChange,
  onOpen,
  showDate = false,
}: {
  event: EventItem;
  saved: boolean;
  loggedIn: boolean;
  onSavedChange?: (saved: boolean) => void;
  // Optional (KI-Chat): ganze Karte klickbar -> z.B. zur Events-Übersicht. Der
  // Speichern-Button und der Quelllink fangen den Klick ab (stopPropagation).
  onOpen?: () => void;
  // Optional (KI-Chat): Datum in der Meta-Zeile zeigen. Auf /events & /gespeichert
  // sind die Events nach Tag gruppiert (Datum steht im Abschnitts-Header) -> dort aus.
  showDate?: boolean;
}) {
  const t = useTranslations("Events");
  const locale = useLocale();
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [prevInitial, setPrevInitial] = useState(initialSaved);
  const [, start] = useTransition();

  // Merk-Status übernehmen, wenn sich der Prop ändert (z.B. wenn der echte Zustand
  // im KI-Chat nachgeladen wird). React-Muster „State beim Rendern anpassen" (statt
  // Effekt) -> greift nur bei echter Wertänderung, überschreibt die optimistische
  // Anzeige auf /events also nicht.
  if (initialSaved !== prevInitial) {
    setPrevInitial(initialSaved);
    setSaved(initialSaved);
  }

  const time = eventTimeLabel(e, locale) ?? t("allDay");

  // Datums-Label (nur im Chat): Wochentag + Datum, bei mehrtägigen Events als Spanne.
  let dateLabel: string | null = null;
  if (showDate) {
    const dl = bcp47(locale);
    const vd = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Vienna",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));
    const wd = (iso: string) =>
      new Intl.DateTimeFormat(dl, { timeZone: "Europe/Vienna", weekday: "short" }).format(
        new Date(iso),
      );
    const dm = (iso: string) =>
      new Intl.DateTimeFormat(dl, {
        timeZone: "Europe/Vienna",
        day: "numeric",
        month: "numeric",
      }).format(new Date(iso));
    const multiDay = e.endsAt && vd(e.endsAt) !== vd(e.startsAt);
    dateLabel = multiDay
      ? `${wd(e.startsAt)} ${dm(e.startsAt)}–${dm(e.endsAt as string)}`
      : `${wd(e.startsAt)} ${dm(e.startsAt)}`;
  }

  // Event-Link-Klick cookieless tracken (nur Produktion, NICHT der Betreiber) ->
  // welche Events wirklich interessieren (Klicks auf die offizielle Seite).
  // Best effort, blockiert nie.
  function trackLinkClick() {
    if (process.env.NODE_ENV !== "production") return;
    void isOperatorClient().then((operator) => {
      if (operator) return; // Betreiber (Admin) nicht mitzählen
      void fetch("/api/track", {
        method: "POST",
        credentials: "omit",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "event_link",
          target: e.id,
          category: e.category,
          locale,
        }),
      }).catch(() => {});
    });
  }

  function onSave() {
    if (!loggedIn) {
      router.push("/profil");
      return;
    }
    const next = !saved;
    setSaved(next); // optimistisch
    onSavedChange?.(next);
    start(async () => {
      const r = await toggleSavedEvent(e.id);
      if (r.needLogin) {
        router.push("/profil");
        return;
      }
      if (typeof r.saved === "boolean" && r.saved !== next) {
        setSaved(r.saved);
        onSavedChange?.(r.saved);
      }
    });
  }

  return (
    <article
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={
        onOpen
          ? (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className={`flex gap-3 rounded-[16px] bg-white p-3.5 shadow-sm ring-1 ring-black/[0.04]${
        onOpen ? " cursor-pointer transition active:scale-[0.99]" : ""
      }`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-accent/10 to-muted/10 text-[22px] ring-1 ring-inset ring-black/[0.03]">
        <span aria-hidden>{e.emoji ?? "📅"}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ink">
            {e.title}
          </h3>
          {e.isHighlight && <StarBadge label={t("highlight")} />}
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onSave();
            }}
            aria-label={saved ? t("saved") : t("save")}
            aria-pressed={saved}
            className="-mr-1 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/50 transition active:scale-90 active:bg-black/5"
          >
            {saved ? (
              <BookmarkFilled className="h-[18px] w-[18px] text-accent" />
            ) : (
              <Bookmark className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          {dateLabel && <span className="font-medium text-ink/80">{dateLabel}</span>}
          <span className="font-medium text-ink/80">{time}</span>
          {e.locationName && (
            <span className="text-muted">· {e.locationName}</span>
          )}
          <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-muted">
            {t(`cat.${e.category}`)}
          </span>
          {e.isFree && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              {t("free")}
            </span>
          )}
        </div>

        {e.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
            {e.description}
          </p>
        )}

        {safeHttpUrl(e.sourceUrl) && (
          <a
            href={safeHttpUrl(e.sourceUrl)!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(ev) => {
              ev.stopPropagation();
              trackLinkClick();
            }}
            className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-accent transition active:opacity-70"
          >
            {t("website")}
            <ExternalIcon />
          </a>
        )}
      </div>
    </article>
  );
}
