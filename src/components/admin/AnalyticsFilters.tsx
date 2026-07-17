"use client";

import { useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";

// Filter-/Zeitraum-Leiste fürs Analytics-Dashboard. Aktualisiert die URL-Query
// (Server-Component rendert neu). Presets ODER Custom-Datum von–bis + Segment-Filter.
type Current = {
  range: string;
  from: string | null;
  to: string | null;
  locale: string | null;
  country: string | null;
  device: string | null;
  source: string | null;
  campaign: string | null;
};

const PRESETS = [
  { key: "30d", label: "30 T" },
  { key: "3mo", label: "3 Mon" },
  { key: "6mo", label: "6 Mon" },
  { key: "12mo", label: "12 Mon" },
];

// Modulebene (nicht in der Render-Funktion) -> keine Neuerzeugung bei jedem Render.
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] font-normal text-ink outline-none focus:border-accent"
      >
        {children}
      </select>
    </label>
  );
}

export default function AnalyticsFilters({
  current,
  options,
}: {
  current: Current;
  options: { countries: string[]; campaigns: string[] };
}) {
  const router = useRouter();

  function push(next: Partial<Current>) {
    const m = { ...current, ...next };
    const p = new URLSearchParams();
    if (m.from && m.to) {
      p.set("from", m.from);
      p.set("to", m.to);
    } else if (m.range && m.range !== "30d") {
      p.set("range", m.range);
    }
    for (const k of ["locale", "country", "device", "source", "campaign"] as const) {
      if (m[k]) p.set(k, m[k] as string);
    }
    const qs = p.toString();
    router.push(qs ? `/admin/settings/analytics?${qs}` : "/admin/settings/analytics");
  }

  const usingCustom = Boolean(current.from && current.to);

  return (
    <div className="rounded-[16px] bg-white p-3 shadow-sm ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-end gap-3">
        {/* Presets */}
        <div className="inline-flex rounded-full bg-black/5 p-1">
          {PRESETS.map((r) => {
            const active = !usingCustom && (current.range || "30d") === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => push({ range: r.key, from: null, to: null })}
                className={`rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                  active ? "bg-white text-ink shadow-sm" : "text-muted"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {/* Custom von–bis */}
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
          Von
          <input
            type="date"
            value={current.from ?? ""}
            onChange={(e) => push({ from: e.target.value || null, to: current.to })}
            className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted">
          Bis
          <input
            type="date"
            value={current.to ?? ""}
            onChange={(e) => push({ from: current.from, to: e.target.value || null })}
            className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 border-t border-black/5 pt-3">
        <FilterSelect label="Sprache" value={current.locale ?? ""} onChange={(v) => push({ locale: v || null })}>
          <option value="">Alle</option>
          {routing.locales.map((l) => (
            <option key={l} value={l}>
              {localeMeta(l).name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Land" value={current.country ?? ""} onChange={(v) => push({ country: v || null })}>
          <option value="">Alle</option>
          {options.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Gerät" value={current.device ?? ""} onChange={(v) => push({ device: v || null })}>
          <option value="">Alle</option>
          <option value="mobile">Mobil</option>
          <option value="desktop">Desktop</option>
          <option value="tablet">Tablet</option>
        </FilterSelect>
        <FilterSelect label="Quelle" value={current.source ?? ""} onChange={(v) => push({ source: v || null })}>
          <option value="">Alle</option>
          <option value="direct">Direkt</option>
          <option value="search">Suche</option>
          <option value="social">Social</option>
        </FilterSelect>
        <FilterSelect label="Kampagne" value={current.campaign ?? ""} onChange={(v) => push({ campaign: v || null })}>
          <option value="">Alle</option>
          {options.campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </FilterSelect>
        <button
          type="button"
          onClick={() => router.push("/admin/settings/analytics")}
          className="self-end rounded-lg px-3 py-1.5 text-[12px] font-medium text-accent transition hover:bg-accent/10"
        >
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}
