"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  deleteEvent,
  generateEventDraft,
  saveEvent,
  translateEventTextsAll,
  type EventInput,
  type EventTexts,
} from "@/lib/event-actions";
import {
  CATEGORY_LABEL,
  EVENT_CATEGORIES,
  viennaWallToUtcIso,
  type EventCategory,
} from "@/lib/events-format";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashTexts } from "@/lib/spot-hash";
import PhotoUploader from "./PhotoUploader";
import AiButton from "./AiButton";

const TARGET_LOCALES = routing.locales.filter((l) => l !== "de");

const input =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";

const EMOJIS = [
  "🎉", "🎶", "🎭", "🎪", "🎨", "🍺", "🥨", "🎄",
  "🎆", "🏰", "⛪", "🎡", "🎬", "🎤", "🏃", "👨‍👩‍👧",
];

// form hält startsAt/endsAt als datetime-local-Strings (Wiener Wandzeit);
// erst beim Speichern -> UTC-ISO. Alle anderen Felder = EventInput.
type FormState = Omit<EventInput, "startsAt" | "endsAt"> & {
  startsAt: string;
  endsAt: string;
};

const EMPTY: FormState = {
  title: "",
  description: "",
  translations: {},
  emoji: "",
  startsAt: "",
  endsAt: "",
  allDay: false,
  locationName: "",
  category: "kultur",
  isHighlight: false,
  isFree: false,
  sourceUrl: "",
  imageUrl: "",
  status: "draft",
};

export default function EventForm({
  initial,
  isNew,
}: {
  initial?: Partial<FormState>;
  isNew: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ ...EMPTY, ...initial });
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [aiMsg, setAiMsg] = useState("");
  const [enMsg, setEnMsg] = useState("");
  const [reviewLang, setReviewLang] = useState<string>(TARGET_LOCALES[0] ?? "en");
  const [aiAction, setAiAction] = useState<"research" | "translate" | null>(null);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Übersetzungs-Status (Anti-Chaos): aktueller DE-Hash vs. Hash, aus dem übersetzt wurde.
  const liveDeHash = hashTexts([form.title, form.description]);
  const translatedLangs = TARGET_LOCALES.filter((l) => form.translations[l]?.title?.trim());
  const trStale =
    translatedLangs.length > 0 &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash !== liveDeHash;
  // Veröffentlichbar = ALLE Sprachen da UND per „In alle Sprachen übersetzen" erzeugt & aktuell
  // (source_hash-Marke passt) – deckt sich 1:1 mit dem Server.
  const trComplete =
    translatedLangs.length === TARGET_LOCALES.length &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash === liveDeHash;
  // Nur der Übergang Entwurf->Veröffentlicht wird geblockt; ein bereits live Event bleibt editierbar.
  const wasPublished = initial?.status === "published";

  function onResearch() {
    if (!aiQuery.trim()) {
      setAiMsg("Bitte einen Link oder ein Stichwort eingeben.");
      return;
    }
    if (
      (form.title.trim() || form.description.trim()) &&
      !confirm("Das Formular mit dem KI-Vorschlag überschreiben?")
    )
      return;
    setAiMsg("");
    setAiAction("research");
    start(async () => {
      const r = await generateEventDraft(aiQuery);
      setAiAction(null);
      if (r.ok && r.draft) {
        const d = r.draft;
        set({
          title: d.title,
          description: d.description,
          translations: { en: { title: d.titleEn, description: d.descriptionEn } },
          category: d.category,
          emoji: d.emoji,
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          allDay: d.allDay,
          isFree: d.isFree,
          locationName: d.locationName,
          sourceUrl: d.sourceUrl,
        });
        setAiMsg(
          `✓ Vorschlag übernommen${
            r.sources?.length ? ` · ${r.sources.length} Quellen` : ""
          } – bitte prüfen (v. a. Datum & Uhrzeit).`,
        );
      } else {
        setAiMsg(r.error ?? "Fehler bei der KI-Recherche");
      }
    });
  }

  function onTranslateAll() {
    if (!form.title.trim()) {
      setEnMsg("Bitte zuerst deutschen Titel/Beschreibung erstellen.");
      return;
    }
    if (
      Object.keys(form.translations).length &&
      !confirm("Vorhandene Übersetzungen mit den neuen überschreiben?")
    )
      return;
    setEnMsg("");
    setAiAction("translate");
    start(async () => {
      const r = await translateEventTextsAll({
        title: form.title,
        description: form.description,
      });
      setAiAction(null);
      if (r.ok && r.translations) {
        set({ translations: r.translations, translationsSourceHash: r.sourceHash });
        const failed = r.failed?.length ? ` (fehlgeschlagen: ${r.failed.join(", ")})` : "";
        setEnMsg(`✓ In alle Sprachen übersetzt – bitte prüfen${failed}.`);
      } else {
        setEnMsg(r.error ?? "Fehler bei der Übersetzung");
      }
    });
  }

  // Übersetzungs-Feld (Titel/Beschreibung) für die aktuell geprüfte Sprache.
  function trField(key: keyof EventTexts, label: string, rows?: number) {
    const tx = form.translations[reviewLang] ?? { title: "", description: "" };
    const on = (v: string) =>
      set({ translations: { ...form.translations, [reviewLang]: { ...tx, [key]: v } } });
    return (
      <div>
        <label className={labelCls}>{label}</label>
        {rows ? (
          <textarea className={input} rows={rows} value={tx[key]} onChange={(e) => on(e.target.value)} />
        ) : (
          <input className={input} value={tx[key]} onChange={(e) => on(e.target.value)} />
        )}
      </div>
    );
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr("");
    if (!form.title.trim()) {
      setErr("Bitte einen Titel eingeben.");
      return;
    }
    const startsAt = viennaWallToUtcIso(form.startsAt);
    if (!startsAt) {
      setErr("Bitte Datum & Startzeit angeben.");
      return;
    }
    // Veröffentlichen-Gate: NUR beim Übergang Entwurf->Veröffentlicht (ein bereits live Event
    // bleibt editierbar). Live NUR mit vollständigen & aktuellen Übersetzungen. Entwurf geht immer.
    if (form.status === "published" && !wasPublished && !trComplete) {
      setErr(
        `Zum Veröffentlichen müssen alle Sprachen übersetzt & aktuell sein (${translatedLangs.length}/${TARGET_LOCALES.length}). ` +
          "Bitte „🌍 In alle Sprachen übersetzen“ – oder Status auf „Entwurf“ stellen.",
      );
      return;
    }
    // Deutsch geändert, Übersetzungen veraltet -> auffordern (nur bei veröffentlichten Events;
    // Entwurf-Speichern bleibt immer ohne Rückfrage).
    if (
      form.status === "published" &&
      trStale &&
      !confirm(
        "Der deutsche Text wurde geändert – die Übersetzungen sind VERALTET.\n\nBesser zuerst „🌍 In alle Sprachen übersetzen“.\n\nTrotzdem speichern?",
      )
    )
      return;
    const endsAt = form.endsAt ? viennaWallToUtcIso(form.endsAt) : null;
    start(async () => {
      const r = await saveEvent({ ...form, startsAt, endsAt });
      if (r.ok) router.push("/admin/events");
      else
        setErr(
          r.error === "required"
            ? "Bitte einen Titel eingeben."
            : r.error === "start_required"
              ? "Bitte Datum & Startzeit angeben."
              : r.error === "translations_incomplete"
                ? "Zum Veröffentlichen erst „🌍 In alle Sprachen übersetzen“ – oder als Entwurf speichern."
                : r.error === "translations_persist_failed"
                  ? "Übersetzungen konnten nicht gespeichert werden – das Event bleibt als Entwurf. Bitte erneut versuchen."
                  : r.error === "check_failed"
                    ? "Konnte den Übersetzungs-Status nicht prüfen – bitte erneut versuchen."
                    : (r.error ?? "Fehler"),
        );
    });
  }

  function onDelete() {
    if (!form.id || !confirm("Dieses Event wirklich löschen?")) return;
    start(async () => {
      const r = await deleteEvent(form.id!);
      if (r.ok) router.push("/admin/events");
      else setErr(r.error ?? "Fehler");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">
          {isNew ? "Neues Event" : "Event bearbeiten"}
        </h1>
        <div className="flex gap-2">
          {!isNew && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold text-accent"
            >
              Löschen
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Speichern …" : "Speichern"}
          </button>
        </div>
      </div>
      {err && (
        <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-sm text-accent">
          {err}
        </p>
      )}

      {/* KI-Recherche: Link/Stichwort -> Felder füllen (Grounding, docs/29 §4) */}
      <section className="space-y-2 rounded-[16px] bg-accent/[0.06] p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">
          ✨ Event per KI recherchieren
        </h2>
        <p className="text-xs text-muted">
          Link (z. B. Veranstalter-Seite) oder Stichwort eingeben – die KI sucht
          im Web und füllt die Felder. Danach bitte prüfen (v. a. Datum & Uhrzeit).
        </p>
        <div className="flex gap-2">
          <input
            className={input}
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onResearch();
              }
            }}
            placeholder="https://… oder z. B. „Jazzfestival Saalfelden 2026“"
          />
          <AiButton
            loading={aiAction === "research"}
            loadingLabel="Recherchiere"
            onClick={onResearch}
            disabled={pending}
            className="shrink-0 rounded-[12px] bg-accent px-4 text-sm font-semibold text-white"
          >
            Recherchieren
          </AiButton>
        </div>
        {aiMsg && <p className="text-xs text-muted">{aiMsg}</p>}
      </section>

      {/* Basis */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Basis</h2>
        <div>
          <label className={labelCls}>
            Titel (DE) <span className="text-accent">*</span>
          </label>
          <input
            className={input}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            required
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Kategorie</label>
            <select
              className={input}
              value={form.category}
              onChange={(e) =>
                set({ category: e.target.value as EventCategory })
              }
            >
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              className={input}
              value={form.status}
              onChange={(e) =>
                set({ status: e.target.value as "draft" | "published" })
              }
            >
              <option value="draft">Entwurf</option>
              <option value="published">Veröffentlicht</option>
            </select>
            {!wasPublished && !trComplete && (
              <p className="mt-1 text-[12px] text-amber-700">
                🌍 Veröffentlichen erst mit allen Sprachen ({translatedLangs.length}/
                {TARGET_LOCALES.length}). Sonst nur als Entwurf.
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Emoji</label>
            <input
              className={input}
              value={form.emoji}
              onChange={(e) => set({ emoji: e.target.value })}
              placeholder="🎉"
            />
          </div>
          <div>
            <label className={labelCls}>Emoji schnell wählen</label>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => set({ emoji: em })}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg ${
                    form.emoji === em
                      ? "bg-accent/15 ring-1 ring-accent"
                      : "bg-black/5"
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#cc2924]"
              checked={form.isHighlight}
              onChange={(e) => set({ isHighlight: e.target.checked })}
            />
            ⭐ Highlight
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#cc2924]"
              checked={form.isFree}
              onChange={(e) => set({ isFree: e.target.checked })}
            />
            🆓 Gratis
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#cc2924]"
              checked={form.allDay}
              onChange={(e) => set({ allDay: e.target.checked })}
            />
            🕒 Ganztägig (keine Uhrzeit)
          </label>
        </div>
      </section>

      {/* Zeit */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Zeit</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              Start <span className="text-accent">*</span>
            </label>
            <input
              type="datetime-local"
              className={input}
              value={form.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Ende (optional)</label>
            <input
              type="datetime-local"
              className={input}
              value={form.endsAt}
              onChange={(e) => set({ endsAt: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Zeiten in Wiener Zeit (Europe/Vienna).
          {form.allDay && " Bei „Ganztägig“ wird keine Uhrzeit angezeigt."}
        </p>
      </section>

      {/* Ort */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Ort</h2>
        <div>
          <label className={labelCls}>Location-Name</label>
          <input
            className={input}
            value={form.locationName}
            onChange={(e) => set({ locationName: e.target.value })}
            placeholder="z. B. Residenzplatz, Salzburg"
          />
        </div>
      </section>

      {/* Bild */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Bild (optional)</h2>
        <PhotoUploader
          images={form.imageUrl ? [form.imageUrl] : []}
          onChange={(urls) => set({ imageUrl: urls[0] ?? "" })}
        />
      </section>

      {/* Beschreibung (Deutsch) + Übersetzungen in alle Sprachen */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Beschreibung · Deutsch + Übersetzungen</h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              trComplete
                ? "bg-green-600/10 text-green-700"
                : trStale
                  ? "bg-accent/10 text-accent"
                  : "bg-black/5 text-muted"
            }`}
          >
            {trComplete
              ? "✓ Alle Sprachen aktuell"
              : trStale
                ? "⚠ Übersetzungen veraltet"
                : `${translatedLangs.length}/${TARGET_LOCALES.length} Sprachen`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <AiButton
            loading={aiAction === "translate"}
            loadingLabel="🌍 Übersetze alle"
            onClick={onTranslateAll}
            disabled={pending}
            className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white"
          >
            🌍 In alle Sprachen übersetzen
          </AiButton>
          {enMsg && <span className="text-xs text-muted">{enMsg}</span>}
        </div>
        {trStale && (
          <p className="rounded-[10px] bg-accent/10 px-3 py-2 text-xs font-medium text-accent">
            ⚠ Deutsch wurde geändert – Übersetzungen veraltet. Bitte „🌍 In alle Sprachen übersetzen“.
          </p>
        )}

        <div>
          <label className={labelCls}>Kurzbeschreibung (DE)</label>
          <textarea
            className={input}
            rows={3}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="🇩🇪 Deutsch – kurz & im SalzGuide-Ton"
          />
        </div>

        {/* Übersetzungen: Sprache wählen -> prüfen/anpassen */}
        <div className="space-y-3 rounded-[12px] border border-black/10 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-ink">Übersetzungen:</span>
            {TARGET_LOCALES.map((code) => {
              const m = localeMeta(code);
              const filled = Boolean(form.translations[code]?.title?.trim());
              const active = code === reviewLang;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setReviewLang(code)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    active ? "bg-accent text-white" : "bg-black/5 text-ink hover:bg-black/10"
                  }`}
                >
                  <span aria-hidden>{m.flag}</span>
                  <span className="uppercase">{code}</span>
                  {filled && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            {localeMeta(reviewLang).english} ({reviewLang.toUpperCase()}) – prüfen/anpassen:
          </p>
          {trField("title", "Titel")}
          {trField("description", "Kurzbeschreibung", 3)}
        </div>

        <div>
          <label className={labelCls}>Quelle (URL, optional)</label>
          <input
            className={input}
            value={form.sourceUrl}
            onChange={(e) => set({ sourceUrl: e.target.value })}
            placeholder="https://…"
          />
        </div>
      </section>
    </form>
  );
}
