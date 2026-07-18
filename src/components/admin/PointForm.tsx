"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  savePoint,
  deletePoint,
  translatePointTextsAll,
  synthesizePointVoice,
  generatePointAll,
  type PointInput,
  type PointTexts,
} from "@/lib/tour-pool-actions";
import type { PointEditData } from "@/lib/tour-pool";
import { TAG_KEYS, TAG_LABELS_DE, TAG_EMOJI } from "@/lib/tour-tags";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashTexts } from "@/lib/spot-hash";

const POINT_TARGETS = routing.locales.filter((l) => l !== "de");
const emptyPointTexts = (): PointTexts => ({ title: "", audioText: "", audioUrl: null });
import LocationPicker from "./LocationPicker";
import AiButton from "./AiButton";
import { IMMUTABLE_CACHE_SECONDS } from "@/lib/storage";
import { compressImage, uploadImage } from "@/lib/image-upload";

// ~140 Wörter/Minute gesprochen -> grobe Sekunden-Schätzung fürs Feedback.
const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const secEstimate = (s: string) => Math.round((wordCount(s) / 140) * 60);
const KNOWN_TAGS = new Set<string>(TAG_KEYS);

const inputCls =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";
const sectionCls = "space-y-3 rounded-[16px] bg-white p-5 shadow-sm";
const h2Cls = "text-[15px] font-semibold text-ink";


type FormState = {
  lat: number | null;
  lng: number | null;
  kind: string;
  tags: string[];
  weight: number;
  emoji: string;
  imageUrl: string | null;
  status: "draft" | "published";
  de: PointTexts;
  translations: Record<string, PointTexts>;
  translationsSourceHash?: string;
};

function initialState(initial?: PointEditData): FormState {
  const base = {
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
    kind: initial?.kind ?? "",
    tags: (initial?.tags ?? []).filter((t) => KNOWN_TAGS.has(t)),
    weight: initial?.weight ?? 0,
    emoji: initial?.emoji ?? "",
    imageUrl: initial?.imageUrl ?? null,
    status: initial?.status ?? ("draft" as const),
  };
  return {
    ...base,
    de: initial?.de ?? emptyPointTexts(),
    translations: initial?.translations ?? {},
    translationsSourceHash: initial?.translationsSourceHash,
  };
}

export default function PointForm({
  areaId,
  areaName = "",
  initial,
}: {
  areaId: string;
  areaName?: string;
  initial?: PointEditData;
}) {
  const router = useRouter();
  const backHref = `/admin/tours/gebiete/${areaId}`;
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [notes, setNotes] = useState("");
  const [filling, setFilling] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [ttsBusy, setTtsBusy] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string | undefined>>({});
  const [reviewLang, setReviewLang] = useState<string>(POINT_TARGETS[0] ?? "en");
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const isUploading = (k: string) => uploading.includes(k);

  // Texte einer Sprache lesen/schreiben (DE = form.de, sonst form.translations[lang]).
  const getTexts = (lang: string): PointTexts =>
    lang === "de" ? form.de : (form.translations[lang] ?? emptyPointTexts());
  const setTexts = (lang: string, patch: Partial<PointTexts>) => {
    setForm((f) =>
      lang === "de"
        ? { ...f, de: { ...f.de, ...patch } }
        : {
            ...f,
            translations: {
              ...f.translations,
              [lang]: { ...(f.translations[lang] ?? emptyPointTexts()), ...patch },
            },
          },
    );
  };

  // Status: eine Sprache ist „fertig" mit Titel + Sprechtext + Audiodatei.
  const langComplete = (lang: string) => {
    const t = getTexts(lang);
    return Boolean(t.title.trim() && t.audioText.trim() && t.audioUrl);
  };
  const completeCount = POINT_TARGETS.filter(langComplete).length;
  const allComplete = langComplete("de") && POINT_TARGETS.every(langComplete);
  const liveDeHash = hashTexts([form.de.title, form.de.audioText]);
  const trStale =
    POINT_TARGETS.some((l) => form.translations[l]?.title?.trim()) &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash !== liveDeHash;

  function toggleTag(k: string) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(k) ? f.tags.filter((x) => x !== k) : [...f.tags, k],
    }));
  }

  // EIN Klick: Tags, Emoji, Typ + deutscher Sprechtext (danach „In alle Sprachen übersetzen").
  function onFillAll() {
    if (filling) return;
    if (!form.de.title.trim()) return setErr("Bitte zuerst einen deutschen Titel eingeben.");
    setFilling(true);
    setErr("");
    setMsg("");
    void (async () => {
      const r = await generatePointAll({ title: form.de.title, notes, areaName });
      setFilling(false);
      if (r.ok && r.data) {
        const d = r.data;
        setForm((f) => ({
          ...f,
          emoji: d.emoji || f.emoji,
          kind: d.kind || f.kind,
          tags: d.tags,
          de: { ...f.de, audioText: d.audioTextDe },
          translations: {
            ...f.translations,
            en: { ...(f.translations.en ?? emptyPointTexts()), title: d.titleEn },
          },
        }));
        setMsg("✓ Ausgefüllt: Tags, Emoji, Typ & deutscher Sprechtext. Jetzt „🌍 In alle Sprachen übersetzen“ + „🔊 Alle vertonen“.");
      } else setErr(r.error ?? "KI-Ausfüllen fehlgeschlagen.");
    })();
  }

  // Titel + Sprechtext aus dem Deutschen in ALLE Sprachen übersetzen (Audio danach vertonen).
  function onTranslateAll() {
    if (translating) return;
    if (!form.de.title.trim() || !form.de.audioText.trim())
      return setErr("Bitte zuerst deutschen Titel + Sprechtext erstellen.");
    if (
      POINT_TARGETS.some((l) => form.translations[l]?.title?.trim()) &&
      !confirm("Vorhandene Übersetzungen mit den neuen überschreiben?")
    )
      return;
    setTranslating(true);
    setErr("");
    setMsg("");
    void (async () => {
      const r = await translatePointTextsAll({
        title: form.de.title,
        audioText: form.de.audioText,
      });
      setTranslating(false);
      if (r.ok && r.translations) {
        setForm((f) => {
          const next = { ...f.translations };
          for (const [l, tx] of Object.entries(r.translations!)) {
            // Audio-URL erhalten (Text geändert -> Vertonung ggf. neu nötig).
            next[l] = { ...(f.translations[l] ?? emptyPointTexts()), title: tx.title, audioText: tx.audioText };
          }
          return { ...f, translations: next, translationsSourceHash: r.sourceHash };
        });
        const failed = r.failed?.length ? ` (fehlgeschlagen: ${r.failed.join(", ")})` : "";
        setMsg(`✓ In alle Sprachen übersetzt – jetzt „🔊 Alle vertonen“${failed}.`);
      } else setErr(r.error ?? "Übersetzung fehlgeschlagen.");
    })();
  }

  function onSynthesize(lang: string) {
    if (ttsBusy.includes(lang)) return;
    const text = getTexts(lang).audioText;
    if (!text.trim()) return setErr(`Bitte zuerst den Sprechtext (${lang.toUpperCase()}).`);
    setTtsBusy((b) => [...b, lang]);
    setErr("");
    setMsg("");
    void (async () => {
      const r = await synthesizePointVoice({ text, lang });
      setTtsBusy((b) => b.filter((x) => x !== lang));
      if (r.ok && r.path) {
        setTexts(lang, { audioUrl: r.path });
        setPreview((p) => ({ ...p, [lang]: r.previewUrl ?? undefined }));
        setMsg(`✓ Stimme (${lang.toUpperCase()}) erzeugt. Nicht vergessen zu speichern.`);
      } else setErr(r.error ?? "Stimme erzeugen fehlgeschlagen.");
    })();
  }

  // ALLE Sprachen (mit Sprechtext) nacheinander vertonen – ein Klick.
  function onSynthesizeAll() {
    if (ttsBusy.length) return;
    const langs = ["de", ...POINT_TARGETS].filter((l) => getTexts(l).audioText.trim());
    if (!langs.length) return setErr("Kein Sprechtext zum Vertonen – zuerst übersetzen.");
    setErr("");
    setMsg("");
    void (async () => {
      let ok = 0;
      for (const lang of langs) {
        setTtsBusy((b) => [...b, lang]);
        const r = await synthesizePointVoice({ text: getTexts(lang).audioText, lang });
        setTtsBusy((b) => b.filter((x) => x !== lang));
        if (r.ok && r.path) {
          setTexts(lang, { audioUrl: r.path });
          setPreview((p) => ({ ...p, [lang]: r.previewUrl ?? undefined }));
          ok++;
        }
      }
      setMsg(`✓ ${ok}/${langs.length} Sprachen vertont. Nicht vergessen zu speichern.`);
    })();
  }

  async function uploadAudio(lang: string, file: File) {
    setUploading((u) => [...u, lang]);
    setErr("");
    try {
      const supabase = createClient();
      const path = `point-${lang}-${crypto.randomUUID()}.mp3`;
      const { error } = await supabase.storage
        .from("tour-audio")
        .upload(path, file, {
          contentType: file.type || "audio/mpeg",
          upsert: false,
          cacheControl: IMMUTABLE_CACHE_SECONDS,
        });
      if (error) throw new Error(error.message);
      setTexts(lang, { audioUrl: path });
    } catch {
      setErr("Audio-Upload hat nicht geklappt.");
    } finally {
      setUploading((u) => u.filter((x) => x !== lang));
    }
  }

  async function uploadPointImage(file: File) {
    setUploadingImage(true);
    setErr("");
    try {
      const { blob } = await compressImage(file);
      set({ imageUrl: await uploadImage(blob, "tours") });
    } catch {
      setErr("Bild-Upload hat nicht geklappt.");
    } finally {
      setUploadingImage(false);
    }
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr("");
    if (!form.de.title.trim()) return setErr("Bitte einen deutschen Titel eingeben.");
    // Veröffentlichen nur, wenn ALLE Sprachen fertig (Titel + Sprechtext + Audio).
    if (form.status === "published" && !allComplete)
      return setErr(
        "Zum Veröffentlichen müssen ALLE Sprachen Titel + Sprechtext + Audio haben. Erst „🌍 übersetzen“ + „🔊 alle vertonen“ – oder als Entwurf speichern.",
      );
    if (
      trStale &&
      !confirm("Deutsch wurde geändert – Übersetzungen sind veraltet. Trotzdem speichern?")
    )
      return;
    const payload: PointInput = {
      id: initial?.id,
      areaId,
      lat: form.lat,
      lng: form.lng,
      kind: form.kind,
      tags: form.tags,
      weight: Number(form.weight) || 0,
      emoji: form.emoji,
      imageUrl: form.imageUrl,
      status: form.status,
      de: form.de,
      translations: form.translations,
      translationsSourceHash: form.translationsSourceHash,
    };
    start(async () => {
      const r = await savePoint(payload);
      if (r.ok) router.push(backHref);
      else
        setErr(
          r.error?.startsWith("langs_incomplete")
            ? "Noch nicht alle Sprachen vollständig – erst übersetzen + vertonen (oder Entwurf)."
            : (r.error ?? "Speichern fehlgeschlagen."),
        );
    });
  }

  function onDelete() {
    if (!initial?.id) return;
    if (!confirm("Diesen Punkt wirklich löschen?")) return;
    start(async () => {
      const r = await deletePoint(initial.id);
      if (r.ok) router.push(backHref);
      else setErr(r.error ?? "Löschen fehlgeschlagen.");
    });
  }

  // Ein Sprech-/Audio-Block je Sprache (DE = Quelle ohne Titel; Übersetzung mit Titel).
  function audioLangBlock(lang: string) {
    const data = getTexts(lang);
    const secs = secEstimate(data.audioText);
    const m = localeMeta(lang);
    return (
      <div className="space-y-2">
        {lang !== "de" && (
          <div>
            <label className={labelCls}>Titel ({m.english})</label>
            <input
              className={inputCls}
              value={data.title}
              onChange={(e) => setTexts(lang, { title: e.target.value })}
            />
          </div>
        )}
        <label className={labelCls}>
          {m.flag} Sprechtext ({m.english})
        </label>
        <textarea
          rows={7}
          className={inputCls}
          value={data.audioText}
          onChange={(e) => setTexts(lang, { audioText: e.target.value })}
          placeholder="Gesprochener Text …"
        />
        <p className="text-[11px] text-muted">
          {wordCount(data.audioText)} Wörter · ~{secs} Sek.
          {secs > 130 ? " · ⚠︎ evtl. zu lang" : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AiButton
            loading={ttsBusy.includes(lang)}
            loadingLabel="Stimme"
            onClick={() => onSynthesize(lang)}
            disabled={!data.audioText.trim()}
            className="rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            🔊 Vertonen
          </AiButton>
          <label className="cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink">
            {isUploading(lang) ? "Lädt …" : data.audioUrl ? "MP3 ersetzen" : "MP3 wählen"}
            <input
              type="file"
              accept="audio/mpeg,audio/mp3,audio/*"
              className="hidden"
              disabled={isUploading(lang)}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAudio(lang, f);
                e.target.value = "";
              }}
            />
          </label>
          {data.audioUrl && (
            <>
              <span className="text-[12px] text-emerald-700">✓ MP3</span>
              <button
                type="button"
                onClick={() => {
                  setTexts(lang, { audioUrl: null });
                  setPreview((p) => ({ ...p, [lang]: undefined }));
                }}
                className="text-[12px] text-muted underline"
              >
                entfernen
              </button>
            </>
          )}
        </div>
        {preview[lang] && <audio controls src={preview[lang]} className="mt-1 h-8 w-full" />}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-16">
      {/* Punkt + Ein-Klick-KI */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Punkt</h2>
        <div>
          <label className={labelCls}>
            Titel <span className="text-accent">*</span>
          </label>
          <input
            className={inputCls}
            value={form.de.title}
            onChange={(e) => set({ de: { ...form.de, title: e.target.value } })}
            placeholder="🇩🇪 Titel"
          />
        </div>

        {/* KI-Notizen + Ein-Klick-Ausfüllen */}
        <div className="rounded-[12px] bg-black/[0.03] p-3">
          <label className={labelCls}>KI-Notizen &amp; Fakten (optional, Grundlage)</label>
          <textarea
            rows={2}
            className={inputCls}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ein paar echte Stichwörter/Fakten – oder leer lassen. Die KI erfindet nichts."
          />
          <AiButton
            loading={filling}
            loadingLabel="KI füllt aus"
            onClick={onFillAll}
            disabled={!form.de.title.trim()}
            className="mt-2 w-full rounded-full bg-ink px-4 py-2.5 text-[14px] font-semibold text-white sm:w-auto"
          >
            ✨ Mit KI ausfüllen
          </AiButton>
          <p className="mt-1.5 text-[12px] text-muted">
            Füllt EN-Titel, Tags, Emoji, Typ &amp; den deutschen Sprechtext. Den EN-Text übersetzt du danach mit einem Klick.
          </p>
        </div>

        {/* Tags als Chips */}
        <div>
          <label className={labelCls}>Themen-Tags (antippen – fürs KI-Matching)</label>
          <div className="flex flex-wrap gap-2">
            {TAG_KEYS.map((k) => {
              const on = form.tags.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleTag(k)}
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1 text-[13px] font-medium transition active:scale-95 ${
                    on ? "bg-ink text-white" : "bg-black/[0.06] text-ink/80 hover:bg-black/[0.1]"
                  }`}
                >
                  <span aria-hidden>{TAG_EMOJI[k]}</span> {TAG_LABELS_DE[k]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Emoji</label>
            <input
              className={inputCls}
              value={form.emoji}
              onChange={(e) => set({ emoji: e.target.value })}
              placeholder="📍"
            />
          </div>
          <div>
            <label className={labelCls}>Typ (optional)</label>
            <input
              className={inputCls}
              value={form.kind}
              onChange={(e) => set({ kind: e.target.value })}
              placeholder="z.B. Aussicht, Sage"
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

      {/* Bild */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Bild (optional)</h2>
        <p className="text-[12px] text-muted">
          Erscheint in der Audio-Tour beim Stopp (öffentlich, keine Pro-Sperre).
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-20 w-32 shrink-0 overflow-hidden rounded-[12px] bg-black/5">
            {form.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Storage-Bild
              <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <label className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink">
            {uploadingImage ? "Lädt …" : form.imageUrl ? "Ersetzen" : "Bild wählen"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingImage}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadPointImage(f);
                e.target.value = "";
              }}
            />
          </label>
          {form.imageUrl && (
            <button
              type="button"
              onClick={() => set({ imageUrl: null })}
              className="rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-muted transition active:scale-[0.98]"
            >
              Entfernen
            </button>
          )}
        </div>
      </section>

      {/* Position */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Position</h2>
        <LocationPicker
          mode="point"
          spot={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
          parking={null}
          route={[]}
          line={[]}
          placing={null}
          waterStops={[]}
          huts={[]}
          onSet={(which, la, ln) => {
            if (which === "spot") set({ lat: la, lng: ln });
          }}
          onRouteChange={() => {}}
          onPoiChange={() => {}}
          onExitPlacing={() => {}}
        />
        <p className="text-[12px] text-muted">
          {form.lat != null && form.lng != null
            ? `Gesetzt: ${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}`
            : "Auf die Karte tippen, um die Position zu setzen."}
        </p>
      </section>

      {/* Audio – alle Sprachen (Veröffentlichen nur wenn ALLE fertig) */}
      <section className={sectionCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={h2Cls}>Sprechtext & Stimme · alle Sprachen (Pro-Inhalt)</h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              allComplete
                ? "bg-emerald-600/10 text-emerald-700"
                : trStale
                  ? "bg-accent/10 text-accent"
                  : "bg-amber-500/10 text-amber-700"
            }`}
            title={`${completeCount}/${POINT_TARGETS.length} Übersetzungen fertig (Titel + Sprechtext + Audio)`}
          >
            {allComplete
              ? "✓ Alle Sprachen fertig"
              : trStale
                ? "⚠ veraltet – neu übersetzen"
                : `${completeCount}/${POINT_TARGETS.length} Sprachen fertig`}
          </span>
        </div>
        <p className="text-[12px] text-muted">
          Deutsch = Quelle. Ein Klick übersetzt Titel + Sprechtext in alle Sprachen, ein Klick
          vertont sie. Veröffentlichen geht erst, wenn jede Sprache Titel + Sprechtext + Audio hat.
        </p>

        <div className="flex flex-wrap gap-2">
          <AiButton
            loading={translating}
            loadingLabel="Übersetzt"
            onClick={onTranslateAll}
            disabled={!form.de.title.trim() || !form.de.audioText.trim()}
            className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            🌍 In alle Sprachen übersetzen
          </AiButton>
          <AiButton
            loading={ttsBusy.length > 0}
            loadingLabel="Vertont"
            onClick={onSynthesizeAll}
            className="rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-ink"
          >
            🔊 Alle Sprachen vertonen
          </AiButton>
        </div>

        {trStale && (
          <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-[12px] text-accent">
            ⚠ Der deutsche Text wurde nach dem Übersetzen geändert – bitte „🌍 In alle Sprachen
            übersetzen“ + „🔊 Alle Sprachen vertonen“ erneut ausführen, damit alles gleich ist.
          </p>
        )}

        {/* Deutsch (Quelle) */}
        <div className="rounded-[14px] border border-black/10 p-3">
          <p className="mb-2 text-[12px] font-semibold text-ink">🇩🇪 Deutsch (Quelle)</p>
          {audioLangBlock("de")}
        </div>

        {/* Übersetzungen prüfen: Sprache wählen */}
        <div className="rounded-[14px] border border-black/10 p-3">
          <p className="mb-2 text-[12px] font-semibold text-ink">Übersetzungen prüfen</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {POINT_TARGETS.map((l) => {
              const m = localeMeta(l);
              const done = langComplete(l);
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
          {audioLangBlock(reviewLang)}
        </div>
      </section>

      {err && <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-sm text-accent">{err}</p>}
      {msg && <p className="text-sm font-medium text-emerald-700">{msg}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || uploading.length > 0 || uploadingImage}
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
