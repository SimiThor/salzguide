"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  saveArea,
  deleteArea,
  translateAreaTextAll,
  type AreaInput,
  type AreaTexts,
} from "@/lib/tour-pool-actions";
import type { AreaEditData } from "@/lib/tour-pool";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashTexts } from "@/lib/spot-hash";
import LocationPicker from "./LocationPicker";
import AiButton from "./AiButton";

const AREA_TARGETS = routing.locales.filter((l) => l !== "de");
const emptyAreaTexts = (): AreaTexts => ({ name: "", subtitle: "" });

const inputCls =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";
const sectionCls = "space-y-3 rounded-[16px] bg-white p-5 shadow-sm";
const h2Cls = "text-[15px] font-semibold text-ink";

async function fileToWebp(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/webp", quality),
  );
  if (!blob) throw new Error("webp");
  return blob;
}

type FormState = {
  emoji: string;
  coverUrl: string | null;
  startLat: number | null;
  startLng: number | null;
  status: "draft" | "published";
  de: AreaTexts;
  translations: Record<string, AreaTexts>;
  translationsSourceHash?: string;
};

function initialState(initial?: AreaEditData): FormState {
  if (!initial)
    return {
      emoji: "",
      coverUrl: null,
      startLat: null,
      startLng: null,
      status: "draft",
      de: emptyAreaTexts(),
      translations: {},
    };
  return {
    emoji: initial.emoji,
    coverUrl: initial.coverUrl,
    startLat: initial.startLat,
    startLng: initial.startLng,
    status: initial.status,
    de: initial.de,
    translations: initial.translations ?? {},
    translationsSourceHash: initial.translationsSourceHash,
  };
}

export default function AreaForm({ initial }: { initial?: AreaEditData }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [reviewLang, setReviewLang] = useState<string>(AREA_TARGETS[0] ?? "en");
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const getTexts = (lang: string): AreaTexts =>
    lang === "de" ? form.de : (form.translations[lang] ?? emptyAreaTexts());
  const setTexts = (lang: string, patch: Partial<AreaTexts>) =>
    setForm((f) =>
      lang === "de"
        ? { ...f, de: { ...f.de, ...patch } }
        : {
            ...f,
            translations: {
              ...f.translations,
              [lang]: { ...(f.translations[lang] ?? emptyAreaTexts()), ...patch },
            },
          },
    );

  const langHasName = (lang: string) => getTexts(lang).name.trim() !== "";
  const translatedCount = AREA_TARGETS.filter(langHasName).length;
  const liveDeHash = hashTexts([form.de.name, form.de.subtitle]);
  const trStale =
    AREA_TARGETS.some((l) => form.translations[l]?.name?.trim()) &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash !== liveDeHash;
  const allTranslated = translatedCount === AREA_TARGETS.length;

  function onTranslateAll() {
    if (translating) return;
    if (!form.de.name.trim()) return setErr("Bitte zuerst den deutschen Namen eingeben.");
    if (
      AREA_TARGETS.some((l) => form.translations[l]?.name?.trim()) &&
      !confirm("Vorhandene Übersetzungen mit den neuen überschreiben?")
    )
      return;
    setTranslating(true);
    setErr("");
    setMsg("");
    void (async () => {
      const r = await translateAreaTextAll({ name: form.de.name, subtitle: form.de.subtitle });
      setTranslating(false);
      if (r.ok && r.translations) {
        setForm((f) => ({
          ...f,
          translations: { ...f.translations, ...r.translations },
          translationsSourceHash: r.sourceHash,
        }));
        const failed = r.failed?.length ? ` (fehlgeschlagen: ${r.failed.join(", ")})` : "";
        setMsg(`✓ In alle Sprachen übersetzt – bitte kurz prüfen${failed}.`);
      } else setErr(r.error ?? "Übersetzung fehlgeschlagen.");
    })();
  }

  async function uploadCover(file: File) {
    setUploadingCover(true);
    setErr("");
    try {
      const supabase = createClient();
      const blob = await fileToWebp(file);
      const path = `tours/area-${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage
        .from("spot-media")
        .upload(path, blob, { contentType: "image/webp", upsert: false });
      if (error) throw new Error(error.message);
      set({ coverUrl: supabase.storage.from("spot-media").getPublicUrl(path).data.publicUrl });
    } catch {
      setErr("Cover-Upload hat nicht geklappt.");
    } finally {
      setUploadingCover(false);
    }
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr("");
    if (!form.de.name.trim()) return setErr("Bitte einen deutschen Namen eingeben.");
    if (
      trStale &&
      !confirm("Deutsch wurde geändert – Übersetzungen sind veraltet. Trotzdem speichern?")
    )
      return;
    const payload: AreaInput = {
      id: initial?.id,
      emoji: form.emoji,
      coverUrl: form.coverUrl,
      startLat: form.startLat,
      startLng: form.startLng,
      status: form.status,
      de: form.de,
      translations: form.translations,
      translationsSourceHash: form.translationsSourceHash,
    };
    start(async () => {
      const r = await saveArea(payload);
      if (r.ok) router.push("/admin/tours/gebiete");
      else setErr(r.error ?? "Speichern fehlgeschlagen.");
    });
  }

  function onDelete() {
    if (!initial?.id) return;
    if (!confirm("Gebiet inkl. aller Punkte wirklich löschen?")) return;
    start(async () => {
      const r = await deleteArea(initial.id);
      if (r.ok) router.push("/admin/tours/gebiete");
      else setErr(r.error ?? "Löschen fehlgeschlagen.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-16">
      <section className={sectionCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={h2Cls}>Gebiet</h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              allTranslated
                ? "bg-emerald-600/10 text-emerald-700"
                : trStale
                  ? "bg-accent/10 text-accent"
                  : "bg-amber-500/10 text-amber-700"
            }`}
            title={`${translatedCount}/${AREA_TARGETS.length} Sprachen übersetzt`}
          >
            {allTranslated
              ? "🌍 ✓ alle Sprachen"
              : trStale
                ? "🌍 ⚠ veraltet"
                : `🌍 ${translatedCount}/${AREA_TARGETS.length}`}
          </span>
        </div>

        {/* Deutsch = Quelle */}
        <div>
          <label className={labelCls}>
            Name <span className="text-accent">*</span>
          </label>
          <input
            className={inputCls}
            value={form.de.name}
            onChange={(e) => set({ de: { ...form.de, name: e.target.value } })}
            placeholder="🇩🇪 z.B. Salzburger Altstadt"
          />
        </div>
        <div>
          <label className={labelCls}>Untertitel</label>
          <input
            className={inputCls}
            value={form.de.subtitle}
            onChange={(e) => set({ de: { ...form.de, subtitle: e.target.value } })}
            placeholder="🇩🇪 Untertitel"
          />
        </div>

        <AiButton
          loading={translating}
          loadingLabel="Übersetzt"
          onClick={onTranslateAll}
          disabled={!form.de.name.trim()}
          className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
        >
          🌍 In alle Sprachen übersetzen
        </AiButton>

        {trStale && (
          <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-[12px] text-accent">
            ⚠ Deutsch wurde nach dem Übersetzen geändert – bitte „🌍 In alle Sprachen übersetzen“
            erneut ausführen.
          </p>
        )}

        {/* Übersetzungen prüfen */}
        <div className="rounded-[14px] border border-black/10 p-3">
          <p className="mb-2 text-[12px] font-semibold text-ink">Übersetzungen prüfen</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {AREA_TARGETS.map((l) => {
              const m = localeMeta(l);
              const done = langHasName(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setReviewLang(l)}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                    reviewLang === l
                      ? "bg-ink text-white"
                      : done
                        ? "bg-emerald-600/10 text-emerald-700"
                        : "bg-black/5 text-muted"
                  }`}
                  title={m.english}
                >
                  {m.flag} {m.code.toUpperCase()} {done ? "✓" : ""}
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            <div>
              <label className={labelCls}>Name ({localeMeta(reviewLang).english})</label>
              <input
                className={inputCls}
                value={getTexts(reviewLang).name}
                onChange={(e) => setTexts(reviewLang, { name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Untertitel ({localeMeta(reviewLang).english})</label>
              <input
                className={inputCls}
                value={getTexts(reviewLang).subtitle}
                onChange={(e) => setTexts(reviewLang, { subtitle: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Emoji</label>
            <input
              className={inputCls}
              value={form.emoji}
              onChange={(e) => set({ emoji: e.target.value })}
              placeholder="🎧"
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
        </div>
      </section>

      <section className={sectionCls}>
        <h2 className={h2Cls}>Startpunkt der Runde</h2>
        <p className="text-[12px] text-muted">
          Fix & gut mit Bus/Auto erreichbar (z.B. Mirabellplatz). Auf die Karte tippen oder suchen.
        </p>
        <LocationPicker
          mode="point"
          spot={form.startLat != null && form.startLng != null ? { lat: form.startLat, lng: form.startLng } : null}
          parking={null}
          route={[]}
          line={[]}
          placingParking={false}
          onSet={(which, la, ln) => {
            if (which === "spot") set({ startLat: la, startLng: ln });
          }}
          onRouteChange={() => {}}
          onParkingPlaced={() => {}}
        />
        <p className="text-[12px] text-muted">
          {form.startLat != null && form.startLng != null
            ? `Gesetzt: ${form.startLat.toFixed(5)}, ${form.startLng.toFixed(5)}`
            : "Noch kein Startpunkt gesetzt."}
        </p>
      </section>

      <section className={sectionCls}>
        <h2 className={h2Cls}>Cover-Bild (optional)</h2>
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
