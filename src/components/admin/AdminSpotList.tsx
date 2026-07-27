"use client";

import { useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import ProBadge from "@/components/ProBadge";
import ScrollStrip from "@/components/ScrollStrip";
import { normalizeText } from "@/lib/normalize-text";
import type { AdminSpotRow } from "@/lib/admin";

// Die Spot-Liste im Admin mit Sofort-Suche.
//
// WARUM IM BROWSER GEFILTERT WIRD, NICHT ÜBER DIE DATENBANK:
// Die ganze Liste ist ohnehin schon geladen (die Seite blättert nicht). Filtern im Browser
// heisst deshalb: kein zweiter Rundweg, Treffer erscheinen beim Tippen, und es gibt keine
// gebaute Abfrage, in die man etwas hineinschmuggeln könnte. Sicherer als jede LIKE-Suche,
// weil gar nichts an die Datenbank geht. RLS hat die Zeilen schon beim Laden gefiltert.
//
// WAS DURCHSUCHT WIRD: der auf dem Server gebaute `search`-Text jeder Zeile (alle
// Titel-Sprachen + slug + Typ/Subtyp/Gebiet/See). Gefaltet wird mit derselben Funktion wie
// beim Anlegen (normalizeText): "Groedig" trifft "Grödig", "st gilgen" trifft "St. Gilgen".

type TypeFilter = "all" | "activity" | "food";
type StatusFilter = "all" | "published" | "draft";

// Ein Segment-Umschalter im Haus-Stil (wie die Admin-Navigation): getönte Kapsel, die
// aktive Wahl weiss mit Schatten. Rand hiesse Zustand, Füllung heisst anfassbar (lib/ui.ts).
function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 rounded-full bg-black/5 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`cursor-pointer shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition active:scale-[0.98] ${
              active ? "bg-white text-ink shadow-sm" : "text-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: "all", label: "Alle" },
  { value: "activity", label: "Aktivität" },
  { value: "food", label: "Essen" },
] as const;

const STATUS_OPTIONS = [
  { value: "all", label: "Alle" },
  { value: "published", label: "Live" },
  { value: "draft", label: "Entwurf" },
] as const;

function SpotRow({ s }: { s: AdminSpotRow }) {
  return (
    <Link
      href={`/admin/spots/${s.id}`}
      className="flex items-center justify-between gap-3 px-4 py-3 active:bg-black/5"
    >
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-medium text-ink">{s.title}</span>
        <span className="text-xs text-muted">
          {s.type === "food" ? "Essen" : "Aktivität"} · {s.slug}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {s.is_pro && <ProBadge />}
        {/* Übersetzungs-Status: grün=alle aktuell, rot=veraltet, gelb=teilweise/keine */}
        <span
          title={`${s.trPresent}/${s.trTotal} Sprachen übersetzt`}
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            s.trState === "complete"
              ? "bg-green-600/10 text-green-700"
              : s.trState === "stale"
                ? "bg-accent/10 text-accent"
                : "bg-amber-500/10 text-amber-700"
          }`}
        >
          {s.trState === "complete"
            ? "🌍 ✓"
            : s.trState === "stale"
              ? "🌍 ⚠ veraltet"
              : `🌍 ${s.trPresent}/${s.trTotal}`}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            s.status === "published"
              ? "bg-green-600/10 text-green-700"
              : "bg-black/5 text-muted"
          }`}
        >
          {s.status === "published" ? "Live" : "Entwurf"}
        </span>
      </span>
    </Link>
  );
}

export default function AdminSpotList({ spots }: { spots: AdminSpotRow[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  // Den Suchtext EINMAL falten, nicht bei jedem Tastendruck für jede Zeile neu. Bei ein paar
  // hundert Spots ist das ohnehin sofort, aber so bleibt es auch bei Wachstum ruhig.
  const indexed = useMemo(
    () => spots.map((s) => ({ spot: s, hay: normalizeText(s.search) })),
    [spots],
  );

  // Die Suche in Wörter zerlegen: jedes muss vorkommen (UND), Reihenfolge egal. So grenzt
  // "wolfgang see" genauso ein wie "see wolfgang", ohne dass man exakt tippen muss.
  const terms = useMemo(() => normalizeText(q).split(" ").filter(Boolean), [q]);

  const results = useMemo(
    () =>
      indexed
        .filter(({ spot }) => (type === "all" ? true : spot.type === type))
        .filter(({ spot }) => (status === "all" ? true : spot.status === status))
        .filter(({ hay }) => terms.every((t) => hay.includes(t)))
        .map(({ spot }) => spot),
    [indexed, terms, type, status],
  );

  const filtering = q.trim() !== "" || type !== "all" || status !== "all";

  return (
    <div className="space-y-3">
      {/* Suchfeld mit Löschen-Knopf. type=search + inputMode text, kein Autofokus: am Handy
          soll nicht ungefragt die Tastatur aufspringen, wenn man nur nachsehen will. */}
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted"
        >
          🔎
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // Escape leert das Feld, wie man es von einem Suchfeld erwartet.
          onKeyDown={(e) => {
            if (e.key === "Escape") setQ("");
          }}
          placeholder="Spot suchen: Name, Ort, See, slug …"
          aria-label="Spots durchsuchen"
          className="w-full rounded-[14px] border border-black/10 bg-white py-2.5 pl-10 pr-10 text-sm text-ink outline-none focus:border-accent"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Suche löschen"
            className="cursor-pointer absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted transition hover:bg-black/5 active:scale-90"
          >
            ✕
          </button>
        )}
      </div>

      {/* Schnellfilter im gemeinsamen Scroll-Streifen (siehe ScrollStrip.tsx): Auf dem Handy
          sind Typ + Status zusammen breiter als der Bildschirm, ohne Streifen schöben sie das
          ganze Dokument breiter.
          w-max ist neu und war der stille Fehler hier: Ohne das rechnete Flex die beiden
          Segment-Leisten schmal, statt den Streifen scrollen zu lassen — sie quetschten sich
          also, anstatt über den Rand zu laufen. */}
      <ScrollStrip>
        <div className="flex w-max items-center gap-2">
          <Segmented label="Nach Typ filtern" value={type} onChange={setType} options={TYPE_OPTIONS} />
          <Segmented
            label="Nach Status filtern"
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
          />
        </div>
      </ScrollStrip>

      {/* Trefferzahl nur beim Filtern: sonst ist es Rauschen, die Zahl steht schon im Reiter. */}
      {filtering && (
        <p className="px-1 text-xs text-muted">
          {results.length} von {spots.length} {spots.length === 1 ? "Spot" : "Spots"}
        </p>
      )}

      <div className="divide-y divide-black/5 overflow-hidden rounded-[16px] bg-white shadow-sm">
        {results.map((s) => (
          <SpotRow key={s.id} s={s} />
        ))}
        {results.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {spots.length === 0
              ? "Noch keine Spots. Leg den ersten an."
              : "Kein Spot passt. Andere Schreibweise probieren oder Filter zurücksetzen."}
          </p>
        )}
      </div>
    </div>
  );
}
