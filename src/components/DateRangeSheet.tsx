"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { bcp47 } from "@/i18n/locales";
import { isoWeekdayIndex, monthGrid, monthsBetween } from "@/lib/calendar";
import {
  eventDayCounts,
  eventsInRange,
  type DayRange,
  type EventItem,
} from "@/lib/events-format";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/lib/ui";
import { shiftDay } from "@/lib/vienna-day";
import BottomSheet from "./BottomSheet";
import ScrollStrip from "./ScrollStrip";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Datumsauswahl über der Event-Liste. Ein Tag oder eine ganze Urlaubswoche.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WOFÜR: Die Liste zeigt rund drei Wochen. Wer wissen will, ob am Donnerstag etwas los ist
// — oder was in seiner Urlaubswoche läuft —, musste bisher alles durchscrollen. Genau das
// erledigt ein Kalender in zwei Fingertipps.
//
// WIE AUSGEWÄHLT WIRD (die Regel von Airbnb, weil sie jeder schon kennt):
//   1. Tipp  -> ein einzelner Tag.
//   2. Tipp auf einen späteren Tag -> daraus wird die Spanne.
//   2. Tipp auf einen früheren Tag -> der wird der neue Anfang (statt einer leeren Spanne).
//   Ist die Spanne komplett, fängt der nächste Tipp wieder von vorn an.
// Ein einzelner Tag ist damit kein eigener Modus, den man erst suchen müsste: Er ist der
// halbe Weg zur Spanne. Deshalb gibt es auch keinen Umschalter „Tag / Zeitraum".
//
// DER KALENDER ZEIGT NUR, WORÜBER WIR ETWAS WISSEN: von heute bis zum letzten recherchierten
// Tag. Alles davor und danach ist ausgegraut. Ein auswählbarer 15. September, der garantiert
// leer zurückkommt, würde die App wie eine Fehlanzeige aussehen lassen, obwohl dort nur
// noch niemand recherchiert hat.
//
// Der Punkt unter der Zahl heisst „da ist was los" — und er richtet sich nach dem aktiven
// Kategorie-Filter. Wer auf „Party" gestellt hat, sieht die Party-Tage. Deshalb kommen die
// Events hier schon gefiltert an; dieselbe Menge steht auch im Knopf unten.

/** Auswahl im Aufbau: `to === null` heisst „bisher nur ein Tag". */
type Draft = { from: string; to: string | null } | null;

export default function DateRangeSheet({
  open,
  onClose,
  events,
  todayKey,
  maxDay,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  /** Bereits nach Kategorie gefiltert -> Punkte und Zähler zeigen, was der Nutzer sehen wird. */
  events: EventItem[];
  todayKey: string;
  /** Letzter Tag mit Inhalt; danach ist der Kalender nicht mehr auswählbar. */
  maxDay: string;
  value: DayRange | null;
  onApply: (range: DayRange | null) => void;
}) {
  const t = useTranslations("Events");
  const locale = useLocale();
  const dl = bcp47(locale);

  // Erst bauen, wenn das Sheet zum ersten Mal aufgeht, danach stehen lassen (sonst wäre der
  // Inhalt beim Zuklappen weg, bevor die Animation durch ist). Spart nicht nur DOM: Der
  // Kalender formatiert Monats- und Wochentagsnamen über Intl, und was nie vorgerendert
  // wird, kann auch nicht zwischen Server und Browser auseinanderlaufen.
  const [everOpen, setEverOpen] = useState(open);
  if (open && !everOpen) setEverOpen(true);

  // Der Entwurf gilt nur im Sheet: Die Liste dahinter ändert sich erst beim Anwenden.
  // Beim Öffnen wird der aktive Filter übernommen (React-Muster „State an geänderte Prop
  // anpassen", wie in BottomSheet.tsx) -> man sieht, was gerade gilt, statt eines leeren
  // Kalenders.
  const [draft, setDraft] = useState<Draft>(value);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(value);
  }

  const range: DayRange | null = draft
    ? { from: draft.from, to: draft.to ?? draft.from }
    : null;

  const counts = useMemo(
    () => eventDayCounts(events, todayKey),
    [events, todayKey],
  );
  const months = useMemo(
    () => monthsBetween(todayKey, maxDay),
    [todayKey, maxDay],
  );

  // Wochentagsköpfe aus einer bekannten Woche: Der 1.1.2024 war ein Montag.
  //
  // Zwei Nachbesserungen an dem, was ICU liefert. Der Punkt am Ende („pon.", „lun.") ist in
  // einer Kopfzeile nur Rauschen. Und „short" ist NICHT überall kurz: Portugiesisch gibt das
  // ganze Wort zurück („segunda", „terça"), sieben davon passen in keine sieben Spalten.
  // Was dann immer noch zu lang ist, wird auf drei Zeichen gestutzt — genau die übliche
  // portugiesische Abkürzung (seg, ter, qua …).
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(dl, { weekday: "short", timeZone: "UTC" });
    const names = Array.from({ length: 7 }, (_, i) =>
      f.format(new Date(Date.UTC(2024, 0, 1 + i))).replace(/\.$/, ""),
    );
    return names.some((n) => [...n].length > 5)
      ? names.map((n) => [...n].slice(0, 3).join(""))
      : names;
  }, [dl]);

  const monthFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(dl, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    [dl],
  );
  // Vorlesbares Datum für den Knopf („Donnerstag, 13. August 2026"). Die Zahl allein sagt
  // ohne den Monatskopf daneben nichts, und den sieht ein Screenreader hier nicht.
  const fullDateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(dl, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    [dl],
  );

  const count = eventsInRange(events, range).length;

  function pick(day: string) {
    setDraft((cur) => {
      if (!cur || cur.to != null || day <= cur.from) return { from: day, to: null };
      return { from: cur.from, to: day };
    });
  }

  // Einen Vorschlag auf das begrenzen, worüber wir etwas wissen. `null` = nicht anbieten.
  function usable(r: DayRange | null): DayRange | null {
    if (!r || r.from > maxDay) return null;
    const from = r.from < todayKey ? todayKey : r.from;
    const to = r.to > maxDay ? maxDay : r.to;
    if (from > to) return null;
    // Deckt der Vorschlag den ganzen Zeitraum ab, filtert er nichts. Ein Knopf, der nichts
    // tut, gehört nicht hin.
    if (from === todayKey && to === maxDay) return null;
    return { from, to };
  }

  // Das kommende Wochenende. Am Samstag ist es dieses (Sa+So). Am Sonntag wäre es nur noch
  // heute — dafür steht „Heute" schon daneben, und zwei Knöpfe für denselben Tag sind einer
  // zu viel.
  function weekend(): DayRange | null {
    const idx = isoWeekdayIndex(todayKey); // 0 = Montag
    if (idx === 6) return null;
    const sat = shiftDay(todayKey, 5 - idx);
    return { from: sat, to: shiftDay(sat, 1) };
  }

  const presets = [
    { key: "today", label: t("today"), range: usable({ from: todayKey, to: todayKey }) },
    { key: "weekend", label: t("dateFilter.weekend"), range: usable(weekend()) },
    {
      key: "next7",
      label: t("dateFilter.next7"),
      range: usable({ from: todayKey, to: shiftDay(todayKey, 6) }),
    },
  ].flatMap((p) =>
    p.range ? [{ ...p, range: p.range, count: eventsInRange(events, p.range).length }] : [],
  );

  // Wie hoch das Sheet aufgeht. Ein fester Wert liesse einen einzelnen Monat zur Hälfte
  // leer stehen, zwei Monate dagegen abgeschnitten. Gezählt, nicht gemessen: Die Stufe
  // steht fest, bevor das Sheet aufgeht, und kann deshalb nicht nachträglich springen
  // (siehe „Ruheposition nie aus dem Layout rechnen"). Grob ist gut genug — wird es zu
  // knapp, scrollt der Körper, und das ist bei mehreren Monaten ohnehin der Normalfall.
  const weeks = months.reduce((n, m) => n + Math.ceil(monthGrid(m).length / 7), 0);
  const detent = Math.min(0.92, 0.3 + weeks * 0.06);

  const footer = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setDraft(null)}
        disabled={!draft}
        className={BTN_SECONDARY}
      >
        {t("dateFilter.reset")}
      </button>
      <button
        type="button"
        onClick={() => {
          onApply(range);
          onClose();
        }}
        disabled={count === 0}
        className={`${BTN_PRIMARY} flex-1`}
      >
        {t("dateFilter.apply", { count })}
      </button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("dateFilter.title")}
      // Eine einzige Stufe: Ein Kalender, den man erst hochziehen muss, ist ein Kalender,
      // dessen letzte Woche man nicht sieht.
      detents={[detent]}
      footer={footer}
    >
      {everOpen && (
        <div data-sg="date-picker">
          {presets.length > 0 && (
            <ScrollStrip className="-mt-1 mb-4">
              <div className="flex w-max gap-2">
                {presets.map((p) => {
                  const active =
                    range?.from === p.range.from && range?.to === p.range.to;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setDraft(p.range)}
                      disabled={p.count === 0}
                      aria-pressed={active}
                      className={`cursor-pointer shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                        active ? "bg-ink text-white" : "bg-black/[0.06] text-ink/70"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </ScrollStrip>
          )}

          {/* Gedeckelt und zentriert: Am Handy ändert das nichts (dort ist weniger Platz),
              am Desktop zieht ein Monat sonst über die volle Modal-Breite und die Zahlen
              stehen weit auseinander wie in einer Tabelle. */}
          <div className="mx-auto max-w-[360px] space-y-6">
            {months.map((month) => (
              <section key={month}>
                <h3 className="mb-2 text-center text-[15px] font-semibold text-ink">
                  {monthFmt.format(new Date(`${month}-01T00:00:00Z`))}
                </h3>
                <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {weekdays.map((w, i) => (
                    <span key={i}>{w}</span>
                  ))}
                </div>
                {/* Kein Spaltenabstand: Der Balken der Spanne läuft von Zelle zu Zelle
                    durch, eine Lücke dazwischen sähe aus wie mehrere Zeiträume. */}
                <div className="grid grid-cols-7">
                  {monthGrid(month).map((day, i) => {
                    if (!day) return <span key={`x${i}`} />;
                    const disabled = day < todayKey || day > maxDay;
                    const isFrom = range?.from === day;
                    const isTo = range?.to === day;
                    const spans = range != null && range.from !== range.to;
                    const inside =
                      range != null && day > range.from && day < range.to;
                    // Der Balken liegt HINTER der Zahl und reicht bei den Endpunkten nur
                    // bis zur Mitte — sonst schwämme der volle Kreis auf einer Fläche, die
                    // links und rechts ins Leere läuft.
                    const band = inside
                      ? "inset-x-0"
                      : spans && isFrom
                        ? "left-1/2 right-0"
                        : spans && isTo
                          ? "left-0 right-1/2"
                          : null;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => pick(day)}
                        disabled={disabled}
                        aria-label={fullDateFmt.format(
                          new Date(`${day}T00:00:00Z`),
                        )}
                        aria-pressed={isFrom || isTo || inside}
                        aria-current={day === todayKey ? "date" : undefined}
                        className="relative flex h-12 w-full cursor-pointer flex-col items-center justify-center disabled:cursor-default"
                      >
                        {band && (
                          <span
                            className={`absolute inset-y-0.5 bg-accent/12 ${band}`}
                            aria-hidden
                          />
                        )}
                        <span
                          className={`relative flex h-9 w-9 items-center justify-center rounded-full text-[15px] transition ${
                            isFrom || isTo
                              ? "bg-accent font-semibold text-white"
                              : disabled
                                ? "text-ink/25"
                                : day === todayKey
                                  ? "font-bold text-accent"
                                  : "font-medium text-ink"
                          }`}
                        >
                          {Number(day.slice(8))}
                        </span>
                        {/* Der Punkt steht IMMER, nur unsichtbar ohne Events: So sitzen
                            alle Zahlen auf derselben Linie. */}
                        <span
                          className={`relative mt-0.5 h-1 w-1 rounded-full ${
                            counts.has(day) && !disabled ? "bg-accent" : "bg-transparent"
                          }`}
                          aria-hidden
                        />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
