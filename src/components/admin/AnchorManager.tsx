"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import type { AdminAnchorRow } from "@/lib/anchors";
import type { AnchorInput } from "@/lib/anchor-actions";
import {
  saveAnchor,
  deleteAnchor,
  toggleAnchorActive,
  seedDefaultAnchors,
  generateAnchorDraft,
} from "@/lib/anchor-actions";
import type { EventCategory } from "@/lib/events-format";
import AiButton from "./AiButton";

const MONTHS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const REGIONS = [
  "Stadt Salzburg",
  "Flachgau",
  "Tennengau",
  "Pongau",
  "Pinzgau",
  "Lungau",
  "ganzes Land",
];
const CATS: { key: EventCategory; label: string }[] = [
  { key: "party", label: "Party" },
  { key: "tradition", label: "Tradition" },
  { key: "kultur", label: "Kultur" },
  { key: "sport", label: "Sport" },
  { key: "kids", label: "Kids" },
];
const FREE: { key: "ja" | "teils" | "nein"; label: string }[] = [
  { key: "ja", label: "Gratis" },
  { key: "teils", label: "Teils" },
  { key: "nein", label: "Kostenpflichtig" },
];

const input =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent";
const label = "text-xs font-semibold text-muted";

function emptyDraft(): AnchorInput {
  return {
    key: "",
    name: "",
    category: "kultur",
    region: "Stadt Salzburg",
    months: [],
    timing: "",
    url: "",
    free: "nein",
    why: "",
    note: "",
    active: true,
  };
}
function rowToDraft(r: AdminAnchorRow): AnchorInput {
  return { ...r, note: r.note ?? "" };
}
function monthsLabel(ms: number[]): string {
  return ms.length
    ? [...ms].sort((a, b) => a - b).map((m) => MONTHS[m - 1]).join(", ")
    : "—";
}

export default function AnchorManager({
  initial,
  defaultCount,
}: {
  initial: AdminAnchorRow[];
  defaultCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Prop-Sync (nach router.refresh) ohne useEffect.
  const [prevInitial, setPrevInitial] = useState(initial);
  const [list, setList] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setList(initial);
  }

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<AnchorInput | null>(null);
  const [msg, setMsg] = useState("");
  const [aiPending, startAi] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) =>
      [a.name, a.region, a.timing, a.why, a.category].join(" ").toLowerCase().includes(q),
    );
  }, [list, query]);

  const set = (patch: Partial<AnchorInput>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleMonth = (m: number) =>
    setDraft((d) =>
      d
        ? { ...d, months: d.months.includes(m) ? d.months.filter((x) => x !== m) : [...d.months, m] }
        : d,
    );

  function onSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMsg("Bitte einen Namen eingeben.");
      return;
    }
    setMsg("");
    start(async () => {
      const r = await saveAnchor(draft);
      if (r.ok) {
        setDraft(null);
        router.refresh();
      } else {
        setMsg(r.error ?? "Speichern fehlgeschlagen");
      }
    });
  }
  function onAiFill() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMsg("Bitte zuerst einen Namen eingeben.");
      return;
    }
    setMsg("");
    startAi(async () => {
      const r = await generateAnchorDraft(draft.name.trim());
      if (r.ok && r.draft) {
        // Name + aktiv-Status behalten, den Rest von der KI übernehmen.
        setDraft((d) => (d ? { ...d, ...r.draft } : d));
        setMsg("✓ Von KI ausgefüllt – bitte prüfen und ggf. anpassen.");
      } else {
        setMsg(r.error ?? "KI-Recherche fehlgeschlagen");
      }
    });
  }
  function onDelete(a: AdminAnchorRow) {
    if (!confirm(`„${a.name}" wirklich löschen?`)) return;
    setList((l) => l.filter((x) => x.id !== a.id)); // optimistisch
    start(async () => {
      const r = await deleteAnchor(a.id);
      if (r.ok) router.refresh();
      else {
        setMsg(r.error ?? "Löschen fehlgeschlagen");
        router.refresh();
      }
    });
  }
  function onToggle(a: AdminAnchorRow) {
    const next = !a.active;
    setList((l) => l.map((x) => (x.id === a.id ? { ...x, active: next } : x))); // optimistisch
    start(async () => {
      const r = await toggleAnchorActive(a.id, next);
      if (!r.ok) {
        setMsg(r.error ?? "Umschalten fehlgeschlagen");
        router.refresh();
      }
    });
  }
  function onSeed() {
    setMsg("");
    start(async () => {
      const r = await seedDefaultAnchors();
      if (r.ok) {
        setMsg(`✓ ${r.inserted ?? 0} Standard-Anker geladen.`);
        router.refresh();
      } else {
        setMsg(r.error ?? "Laden fehlgeschlagen");
      }
    });
  }

  const activeCount = list.filter((a) => a.active).length;

  return (
    <div className="space-y-4">
      {/* Kopfzeile: Zähler + Suche + Neu */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          {list.length} Anker · {activeCount} aktiv
        </span>
        <input
          className={`${input} ml-auto max-w-[220px]`}
          placeholder="Suchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setMsg("");
            setDraft(emptyDraft());
          }}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
        >
          + Neuer Anker
        </button>
      </div>

      {msg && <p className="text-sm text-muted">{msg}</p>}

      {/* Editor */}
      {draft && (
        <div className="space-y-3 rounded-[16px] border border-accent/20 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">
              {draft.id ? "Anker bearbeiten" : "Neuer Anker"}
            </h2>
            <label className="flex items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#cc2924]"
                checked={draft.active}
                onChange={(e) => set({ active: e.target.checked })}
              />
              aktiv
            </label>
          </div>

          <div>
            <label className={label}>Name *</label>
            <div className="flex gap-2">
              <input
                className={input}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAiFill();
                  }
                }}
                placeholder="z. B. Rupertikirtag"
              />
              <AiButton
                loading={aiPending}
                loadingLabel="Recherchiere"
                onClick={onAiFill}
                className="shrink-0 rounded-[12px] bg-accent px-3.5 text-sm font-semibold text-white"
              >
                ✨ Mit KI ausfüllen
              </AiButton>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Nur den Namen eintippen – die KI recherchiert Kategorie, Region, Monate,
              Zeitfenster, offizielle Quelle usw. Danach kurz prüfen und speichern.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Kategorie</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {CATS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => set({ category: c.key })}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      draft.category === c.key ? "bg-ink text-white" : "bg-black/5 text-ink"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>Region</label>
              <select
                className={input}
                value={draft.region}
                onChange={(e) => set({ region: e.target.value })}
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label}>Monate (in denen es typischerweise stattfindet)</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {MONTHS.map((m, i) => {
                const n = i + 1;
                const on = draft.months.includes(n);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMonth(n)}
                    className={`w-11 rounded-full px-0 py-1.5 text-xs font-semibold transition ${
                      on ? "bg-accent text-white" : "bg-black/5 text-ink"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={label}>Zeitfenster (in Worten, KEIN festes Datum)</label>
            <input
              className={input}
              value={draft.timing}
              onChange={(e) => set({ timing: e.target.value })}
              placeholder="z. B. Ende September rund um den Rupertitag"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className={label}>Offizielle Quelle (URL)</label>
              <input
                className={input}
                value={draft.url}
                onChange={(e) => set({ url: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className={label}>Eintritt</label>
              <div className="mt-1 flex gap-1.5">
                {FREE.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => set({ free: f.key })}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      draft.free === f.key ? "bg-ink text-white" : "bg-black/5 text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className={label}>Warum wichtig (1 Satz, optional)</label>
            <textarea
              className={input}
              rows={2}
              value={draft.why}
              onChange={(e) => set({ why: e.target.value })}
              placeholder="Warum will die junge Zielgruppe das nicht verpassen?"
            />
          </div>

          <div>
            <label className={label}>Hinweis / Vorbehalt (optional)</label>
            <input
              className={input}
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="z. B. nur alle 2 Jahre · Ort rotiert · Dauer-Markt nicht pro Tag listen"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onSave}
              disabled={pending}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 active:scale-[0.98]"
            >
              {pending ? "Speichere …" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setMsg("");
              }}
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-ink"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {list.length === 0 ? (
        <div className="rounded-[16px] border border-black/10 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-muted">
            Noch keine Anker in der Datenbank.
          </p>
          <button
            type="button"
            onClick={onSeed}
            disabled={pending}
            className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Lade …" : `Standard-Anker laden (${defaultCount})`}
          </button>
          <p className="mt-2 text-[11px] text-muted">
            Lädt die eingebaute, verifizierte Liste. Danach frei editierbar.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li
              key={a.id}
              className={`flex items-center gap-3 rounded-[12px] border border-black/[0.06] bg-white px-3 py-2.5 shadow-sm ${
                a.active ? "" : "opacity-55"
              }`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[#cc2924]"
                checked={a.active}
                onChange={() => onToggle(a)}
                title={a.active ? "aktiv (klicken zum Deaktivieren)" : "inaktiv"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">
                  {a.name}
                  {a.free === "ja" && (
                    <span className="ml-2 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      gratis
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {CATS.find((c) => c.key === a.category)?.label} · {a.region} · {monthsLabel(a.months)}
                  {a.note ? ` · ⚠ ${a.note}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMsg("");
                  setDraft(rowToDraft(a));
                }}
                className="shrink-0 rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-ink"
              >
                Bearbeiten
              </button>
              <button
                type="button"
                onClick={() => onDelete(a)}
                className="shrink-0 rounded-full px-2 py-1.5 text-xs font-semibold text-accent"
                title="Löschen"
              >
                ✕
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-1 py-4 text-center text-sm text-muted">
              Keine Treffer für „{query}“.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
