"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  saveTour,
  deleteTour,
  translateTourText,
  type TourInput,
} from "@/lib/tour-actions";
import { listAreaPoints, type PickerPoint } from "@/lib/tour-pool-actions";
import type { TourEditData } from "@/lib/tours";
import AiButton from "./AiButton";
import { compressImage, uploadImage } from "@/lib/image-upload";

const inputCls =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";
const sectionCls = "space-y-3 rounded-[16px] bg-white p-5 shadow-sm";
const h2Cls = "text-[15px] font-semibold text-ink";

type FormStop ={ pointId: string; title: string; hasAudio: boolean };

type FormState = {
  areaId: string;
  emoji: string;
  coverUrl: string | null;
  isPro: boolean;
  freeStops: number;
  status: "draft" | "published";
  durationMin: string;
  distanceKm: string;
  de: { title: string; subtitle: string; description: string };
  en: { title: string; subtitle: string; description: string };
  stops: FormStop[];
};

function initialState(initial: TourEditData | undefined, points: PickerPoint[]): FormState {
  const audioById = new Map(points.map((p) => [p.id, p.hasAudio]));
  if (!initial)
    return {
      areaId: "",
      emoji: "",
      coverUrl: null,
      isPro: true,
      freeStops: 1,
      status: "draft",
      durationMin: "",
      distanceKm: "",
      de: { title: "", subtitle: "", description: "" },
      en: { title: "", subtitle: "", description: "" },
      stops: [],
    };
  return {
    areaId: initial.areaId ?? "",
    emoji: initial.emoji,
    coverUrl: initial.coverUrl,
    isPro: initial.isPro,
    freeStops: initial.freeStops,
    status: initial.status,
    durationMin: initial.durationMin != null ? String(initial.durationMin) : "",
    distanceKm: initial.distanceKm != null ? String(initial.distanceKm) : "",
    de: initial.de,
    en: initial.en,
    stops: initial.stops.map((s) => ({
      pointId: s.pointId,
      title: s.title,
      hasAudio: audioById.get(s.pointId) ?? false,
    })),
  };
}

export default function TourForm({
  initial,
  areas,
  initialAreaPoints = [],
}: {
  initial?: TourEditData;
  areas: { id: string; name: string }[];
  initialAreaPoints?: PickerPoint[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(initial, initialAreaPoints));
  const [areaPoints, setAreaPoints] = useState<PickerPoint[]>(initialAreaPoints);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [translating, setTranslating] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const enRing = (de: string, en: string) =>
    de.trim() !== "" && en.trim() === "" ? "border-accent ring-1 ring-accent/40" : "border-black/10";
  const enPairs: [string, string][] = [
    [form.de.title, form.en.title],
    [form.de.subtitle, form.en.subtitle],
    [form.de.description, form.en.description],
  ];
  const enIncomplete = enPairs.some(([de, en]) => de.trim() !== "" && en.trim() === "");

  const usedIds = new Set(form.stops.map((s) => s.pointId));
  const available = areaPoints.filter((p) => !usedIds.has(p.id));

  function onAreaChange(newAreaId: string) {
    // Punkte gehören zum Gebiet -> bei Wechsel die Stops leeren und neu laden.
    setForm((f) => ({ ...f, areaId: newAreaId, stops: [] }));
    setAreaPoints([]);
    if (!newAreaId) return;
    void (async () => {
      const r = await listAreaPoints(newAreaId);
      setAreaPoints(r.ok && r.points ? r.points : []);
    })();
  }

  function addStop(pointId: string) {
    const p = areaPoints.find((x) => x.id === pointId);
    if (!p) return;
    setForm((f) =>
      f.stops.some((s) => s.pointId === pointId)
        ? f
        : { ...f, stops: [...f.stops, { pointId, title: p.title, hasAudio: p.hasAudio }] },
    );
  }
  function removeStop(i: number) {
    setForm((f) => ({ ...f, stops: f.stops.filter((_, idx) => idx !== i) }));
  }
  function moveStop(i: number, dir: "up" | "down") {
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= form.stops.length) return;
    setForm((f) => {
      const next = [...f.stops];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, stops: next };
    });
  }

  async function uploadCover(file: File) {
    setUploadingCover(true);
    setErr("");
    try {
      const { blob } = await compressImage(file);
      set({ coverUrl: await uploadImage(blob, "tours") });
    } catch {
      setErr("Cover-Upload hat nicht geklappt.");
    } finally {
      setUploadingCover(false);
    }
  }

  function onTranslate() {
    if (translating) return;
    setTranslating(true);
    setErr("");
    setMsg("");
    void (async () => {
      const r = await translateTourText({
        title: form.de.title,
        subtitle: form.de.subtitle,
        description: form.de.description,
      });
      setTranslating(false);
      if (r.ok && r.texts) {
        set({ en: r.texts });
        setMsg("✓ Ins Englische übersetzt – bitte kurz prüfen.");
      } else setErr(r.error ?? "Übersetzung fehlgeschlagen.");
    })();
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr("");
    setMsg("");
    if (!form.de.title.trim()) return setErr("Bitte einen deutschen Titel eingeben.");
    if (enIncomplete) return setErr("Bitte die englischen Texte vervollständigen (Pflicht).");
    if (!form.areaId) return setErr("Bitte ein Gebiet wählen.");
    const payload: TourInput = {
      id: initial?.id,
      areaId: form.areaId,
      emoji: form.emoji,
      coverUrl: form.coverUrl,
      isPro: form.isPro,
      freeStops: form.freeStops,
      status: form.status,
      durationMin: form.durationMin.trim() ? Number(form.durationMin) : null,
      distanceKm: form.distanceKm.trim() ? Number(form.distanceKm) : null,
      de: form.de,
      en: form.en,
      stops: form.stops.map((s) => ({ pointId: s.pointId })),
    };
    start(async () => {
      const r = await saveTour(payload);
      if (r.ok) router.push("/admin/tours");
      else setErr(r.error ?? "Speichern fehlgeschlagen.");
    });
  }

  function onDelete() {
    if (!initial?.id) return;
    if (!confirm("Diese Tour wirklich löschen?")) return;
    start(async () => {
      const r = await deleteTour(initial.id);
      if (r.ok) router.push("/admin/tours");
      else setErr(r.error ?? "Löschen fehlgeschlagen.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-16">
      {/* Texte */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Texte</h2>
        {(
          [
            ["title", "Titel", false],
            ["subtitle", "Untertitel", false],
            ["description", "Beschreibung", true],
          ] as const
        ).map(([key, label, multi]) => {
          const deVal = form.de[key];
          const enVal = form.en[key];
          return (
            <div key={key}>
              <label className={labelCls}>
                {label}
                {key === "title" && <span className="text-accent"> *</span>}
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {multi ? (
                  <textarea
                    rows={3}
                    className={inputCls}
                    value={deVal}
                    onChange={(e) => set({ de: { ...form.de, [key]: e.target.value } })}
                    placeholder="🇩🇪 Deutsch"
                  />
                ) : (
                  <input
                    className={inputCls}
                    value={deVal}
                    onChange={(e) => set({ de: { ...form.de, [key]: e.target.value } })}
                    placeholder="🇩🇪 Deutsch"
                  />
                )}
                {multi ? (
                  <textarea
                    rows={3}
                    className={`${inputCls} ${enRing(deVal, enVal)}`}
                    value={enVal}
                    onChange={(e) => set({ en: { ...form.en, [key]: e.target.value } })}
                    placeholder="🇬🇧 English"
                  />
                ) : (
                  <input
                    className={`${inputCls} ${enRing(deVal, enVal)}`}
                    value={enVal}
                    onChange={(e) => set({ en: { ...form.en, [key]: e.target.value } })}
                    placeholder="🇬🇧 English"
                  />
                )}
              </div>
            </div>
          );
        })}
        <AiButton
          loading={translating}
          loadingLabel="Übersetzt"
          onClick={onTranslate}
          disabled={!form.de.title.trim()}
          className="rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink"
        >
          🇬🇧 Aus dem Deutschen übersetzen
        </AiButton>
      </section>

      {/* Gebiet + Zugang */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Gebiet & Zugang</h2>
        <div>
          <label className={labelCls}>
            Gebiet <span className="text-accent">*</span>
          </label>
          <select
            className={inputCls}
            value={form.areaId}
            onChange={(e) => onAreaChange(e.target.value)}
          >
            <option value="">— Gebiet wählen —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-[15px] text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#cc2924]"
            checked={form.isPro}
            onChange={(e) => set({ isPro: e.target.checked })}
          />
          Pro-Tour (Teaser gratis, Rest nur mit SalzGuide Pro)
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Gratis-Stopps (Teaser)</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.freeStops}
              disabled={!form.isPro}
              onChange={(e) => set({ freeStops: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={inputCls}
              value={form.status}
              onChange={(e) => set({ status: e.target.value as "draft" | "published" })}
            >
              <option value="draft">Entwurf</option>
              <option value="published">Veröffentlicht</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Dauer (Minuten)</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={form.durationMin}
              onChange={(e) => set({ durationMin: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Distanz (km)</label>
            <input
              type="number"
              min={0}
              step="0.1"
              className={inputCls}
              value={form.distanceKm}
              onChange={(e) => set({ distanceKm: e.target.value })}
            />
          </div>
          <div>
            <label className={labelCls}>Emoji</label>
            <input
              className={inputCls}
              value={form.emoji}
              onChange={(e) => set({ emoji: e.target.value })}
              placeholder="🎧"
            />
          </div>
        </div>
      </section>

      {/* Cover */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Cover-Bild</h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-20 w-32 shrink-0 overflow-hidden rounded-[12px] bg-black/5">
            {form.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <label className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink">
            {uploadingCover ? "Lädt …" : form.coverUrl ? "Ersetzen" : "Bild wählen"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingCover}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadCover(f);
                e.target.value = "";
              }}
            />
          </label>
          {form.coverUrl && (
            <button
              type="button"
              onClick={() => set({ coverUrl: null })}
              className="rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-muted"
            >
              Entfernen
            </button>
          )}
        </div>
      </section>

      {/* Stationen (Pool-Punkte) */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Stationen der Runde ({form.stops.length})</h2>
        <p className="text-[12px] text-muted">
          Punkte aus dem Pool des Gebiets, in Reihenfolge. Audio/Text pflegst du beim jeweiligen Punkt.
        </p>

        {form.stops.length > 0 && (
          <ol className="space-y-2">
            {form.stops.map((s, i) => (
              <li
                key={s.pointId}
                className="flex items-center gap-2 rounded-[12px] border border-black/10 px-3 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[12px] font-bold text-accent">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                  {s.title}
                  {!s.hasAudio && (
                    <span className="ml-2 text-[11px] text-muted">⚠︎ noch kein Audio</span>
                  )}
                </span>
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => moveStop(i, "up")}
                    disabled={i === 0}
                    aria-label="Nach oben"
                    className="flex h-4 w-6 items-center justify-center text-muted disabled:opacity-25"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStop(i, "down")}
                    disabled={i === form.stops.length - 1}
                    aria-label="Nach unten"
                    className="flex h-4 w-6 items-center justify-center text-muted disabled:opacity-25"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  aria-label="Entfernen"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/5 text-muted"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            ))}
          </ol>
        )}

        {!form.areaId ? (
          <p className="text-[13px] text-muted">Zuerst oben ein Gebiet wählen.</p>
        ) : available.length > 0 ? (
          <select
            className={inputCls}
            value=""
            onChange={(e) => {
              if (e.target.value) addStop(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">+ Punkt als Station hinzufügen …</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.status !== "published" ? " (Entwurf)" : ""}
                {!p.hasAudio ? " · kein Audio" : ""}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[13px] text-muted">
            Keine weiteren Punkte im Pool. Lege im Gebiet mehr Punkte an.
          </p>
        )}
      </section>

      {err && <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-sm text-accent">{err}</p>}
      {msg && <p className="text-sm font-medium text-emerald-700">{msg}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Speichern …" : "Speichern"}
        </button>
        {initial?.id && (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="rounded-full bg-black/5 px-5 py-2.5 text-sm font-semibold text-accent disabled:opacity-60"
          >
            Löschen
          </button>
        )}
      </div>
    </form>
  );
}
