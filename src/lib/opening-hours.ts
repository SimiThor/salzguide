// Öffnungszeiten – reine Typen & Logik (client- & serverseitig nutzbar).
// Der gecachte Google-Abruf liegt in opening-hours-server.ts (server-only).
// Normalisierte Woche: 7 Tage, Index 0 = Montag … 6 = Sonntag.

export type OpenRange = { open: string; close: string }; // "HH:MM", close darf "24:00" sein
export type DayHours = { closed: boolean; ranges: OpenRange[] };
export type OpeningWeek = DayHours[]; // Länge 7 (Mo..So)

const WEEK = 7 * 1440; // Minuten pro Woche
const HHMM = /^([01]?\d|2[0-4]):([0-5]\d)$/;

function toMin(t: string): number | null {
  const m = HHMM.exec(t.trim());
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h === 24 && mi !== 0) return null; // nur "24:00" erlaubt
  return h * 60 + mi;
}

export function fmtMin(min: number): string {
  const m = ((min % WEEK) + WEEK) % WEEK;
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function emptyWeek(): OpeningWeek {
  return Array.from({ length: 7 }, () => ({ closed: false, ranges: [] }));
}

// Leere, editierbare Woche (7 Tage) – für das Admin-Formular.
export function emptyManualWeek(): OpeningWeek {
  return emptyWeek();
}

// --- Manuell (jsonb) -> OpeningWeek ---
export function normalizeManual(raw: unknown): OpeningWeek | null {
  if (!raw || typeof raw !== "object") return null;
  const days = (raw as { days?: unknown }).days;
  if (!Array.isArray(days)) return null;
  const week = emptyWeek();
  for (let i = 0; i < 7; i++) {
    const d = days[i] as { closed?: boolean; ranges?: unknown } | undefined;
    if (!d || typeof d !== "object") continue;
    if (d.closed) {
      week[i] = { closed: true, ranges: [] };
      continue;
    }
    const ranges: OpenRange[] = [];
    for (const r of Array.isArray(d.ranges) ? d.ranges : []) {
      if (
        r &&
        typeof r.open === "string" &&
        typeof r.close === "string" &&
        toMin(r.open) != null &&
        toMin(r.close) != null
      ) {
        ranges.push({ open: r.open, close: r.close });
      }
    }
    week[i] = { closed: false, ranges };
  }
  return week.some((d) => d.closed || d.ranges.length) ? week : null;
}

const g2mon = (d: number) => (d + 6) % 7; // Google 0=So..6=Sa -> Mo=0

// --- Places API (New): regularOpeningHours.periods -> OpeningWeek ---
type GNewTime = { day: number; hour: number; minute?: number };
type GNewPeriod = { open?: GNewTime; close?: GNewTime };

function hm(h: unknown, m: unknown): string | null {
  if (typeof h !== "number" || h < 0 || h > 24) return null;
  const mm = typeof m === "number" ? m : 0;
  if (mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function normalizeGoogleNew(periods: unknown): OpeningWeek | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const first = periods[0] as GNewPeriod;
  // 24/7: eine Periode mit open (Tag 0, 0 Uhr), ohne close
  if (periods.length === 1 && first.open && !first.close) {
    return Array.from({ length: 7 }, () => ({
      closed: false,
      ranges: [{ open: "00:00", close: "24:00" }],
    }));
  }
  const week = emptyWeek();
  for (const p of periods as GNewPeriod[]) {
    if (!p.open || !p.close || typeof p.open.day !== "number") continue;
    const day = g2mon(p.open.day);
    if (day < 0 || day > 6) continue;
    const open = hm(p.open.hour, p.open.minute);
    const close = hm(p.close.hour, p.close.minute);
    if (open == null || close == null) continue;
    week[day].ranges.push({ open, close });
  }
  return week.some((d) => d.ranges.length) ? week : null;
}

// --- Status "jetzt geöffnet" (rein, testbar) ---
export type OpenStatus = {
  open: boolean;
  changeAt: number | null; // Minute-in-Woche des nächsten Wechsels (Schließen/Öffnen)
};

function toIntervals(week: OpeningWeek): [number, number][] {
  const res: [number, number][] = [];
  week.forEach((day, i) => {
    if (day.closed) return;
    for (const r of day.ranges) {
      const o = toMin(r.open);
      const c = toMin(r.close);
      if (o == null || c == null) continue;
      const start = i * 1440 + o;
      let end = i * 1440 + c;
      if (end <= start) end += 1440; // über Mitternacht
      res.push([start, end]);
    }
  });
  return res;
}

export function computeStatus(week: OpeningWeek, nowWM: number): OpenStatus {
  const iv = toIntervals(week);
  if (!iv.length) return { open: false, changeAt: null };
  for (const [s, e] of iv) {
    if ((nowWM >= s && nowWM < e) || (nowWM + WEEK >= s && nowWM + WEEK < e)) {
      return { open: true, changeAt: e % WEEK };
    }
  }
  let best = Infinity;
  for (const [s] of iv) {
    let d = s - nowWM;
    if (d < 0) d += WEEK;
    if (d < best) best = d;
  }
  return { open: false, changeAt: best === Infinity ? null : (nowWM + best) % WEEK };
}

// Heutiges Kalenderdatum + Wochentag (0 = Mo) in Europe/Vienna.
export function viennaToday(now: Date): {
  y: number;
  m: number;
  d: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dayMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    weekday: dayMap[get("weekday")] ?? 0,
  };
}

// Aktuelle Wochen-Minute in Europe/Vienna (0 = Mo 00:00).
export function viennaNowWM(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dayMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const day = dayMap[get("weekday")] ?? 0;
  const hh = (Number(get("hour")) || 0) % 24;
  const mm = Number(get("minute")) || 0;
  return day * 1440 + hh * 60 + mm;
}
