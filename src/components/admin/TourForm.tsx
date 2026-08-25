"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  saveTour,
  deleteTour,
  translateTourTextsAll,
  snapTourRoute,
  type TourInput,
  type TourTexts,
} from "@/lib/tour-actions";
import { listAreaPoints, type PickerPoint } from "@/lib/tour-pool-actions";
import type { TourEditData } from "@/lib/tours";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashTourTexts } from "@/lib/spot-hash";
import { tourRouteHash, type RoutePoint } from "@/lib/tour-route";
import { TOUR_MODE_EMOJI, type TourMode } from "@/lib/tour-mode";
import LocationPicker from "./LocationPicker";
import AiButton from "./AiButton";
import { blockEnterSubmit } from "./form-utils";
import { adminErrorText } from "@/lib/admin-errors";
import { compressImage, uploadImage } from "@/lib/image-upload";
import Busy from "@/components/Busy";

// Zielsprachen wie überall aus der zentralen Sprach-Config.
const TOUR_TARGETS = routing.locales.filter((l) => l !== "de");
const emptyTexts = (): TourTexts => ({ title: "", subtitle: "", description: "" });

const inputCls =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";
const sectionCls = "space-y-3 rounded-[16px] bg-white p-5 shadow-sm";
const h2Cls = "text-[15px] font-semibold text-ink";
const chipCls = "cursor-pointer rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink transition active:scale-95";

type FormStop = {
  pointId: string;
  title: string;
  hasAudio: boolean;
  lat: number | null;
  lng: number | null;
};

type FormState = {
  areaId: string;
  emoji: string;
  coverUrl: string | null;
  isPro: boolean;
  freeStops: number;
  status: "draft" | "published";
  mode: TourMode;
  durationMin: string;
  distanceKm: string;
  de: TourTexts;
  translations: Record<string, TourTexts>;
  translationsSourceHash?: string;
  start: RoutePoint | null;
  end: RoutePoint | null;
  routeGeo: [number, number][] | null;
  routeHash: string | null;
  stops: FormStop[];
};

function initialState(initial: TourEditData | undefined, points: PickerPoint[]): FormState {
  const byId = new Map(points.map((p) => [p.id, p]));
  if (!initial)
    return {
      areaId: "",
      emoji: "",
      coverUrl: null,
      isPro: true,
      freeStops: 1,
      status: "draft",
      mode: "walk",
      durationMin: "",
      distanceKm: "",
      de: emptyTexts(),
      translations: {},
      start: null,
      end: null,
      routeGeo: null,
      routeHash: null,
      stops: [],
    };
  return {
    areaId: initial.areaId ?? "",
    emoji: initial.emoji,
    coverUrl: initial.coverUrl,
    isPro: initial.isPro,
    freeStops: initial.freeStops,
    status: initial.status,
    mode: initial.mode,
    durationMin: initial.durationMin != null ? String(initial.durationMin) : "",
    distanceKm: initial.distanceKm != null ? String(initial.distanceKm) : "",
    de: initial.de,
    translations: initial.translations ?? {},
    translationsSourceHash: initial.translationsSourceHash,
    start:
      initial.startLat != null && initial.startLng != null
        ? { lat: initial.startLat, lng: initial.startLng }
        : null,
    end:
      initial.endLat != null && initial.endLng != null
        ? { lat: initial.endLat, lng: initial.endLng }
        : null,
    routeGeo: initial.routeGeo,
    routeHash: initial.routeHash,
    stops: initial.stops.map((s) => ({
      pointId: s.pointId,
      title: s.title,
      hasAudio: byId.get(s.pointId)?.hasAudio ?? false,
      lat: byId.get(s.pointId)?.lat ?? null,
      lng: byId.get(s.pointId)?.lng ?? null,
    })),
  };
}

// Start und Ziel auf 1 m genau gleich = Rundweg (dann zeigt die Karte EINEN Marker).
const sameSpot = (a: RoutePoint | null, b: RoutePoint | null): boolean =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

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
  const [snapping, setSnapping] = useState(false);
  const [reviewLang, setReviewLang] = useState<string>(TOUR_TARGETS[0] ?? "en");
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [pointsErr, setPointsErr] = useState(false);
  // Request-Token gegen die Gebiet-Wechsel-Race: Wechselt der Admin schnell A -> B und
  // As Antwort kommt SPÄTER an, zeigte der Picker sonst die Punkte von A, während
  // form.areaId B ist – und eine Tour bekäme Punkte aus dem falschen Gebiet.
  const pointsReq = useRef(0);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // ── Sprachen ───────────────────────────────────────────────────────────────
  const getTexts = (lang: string): TourTexts =>
    lang === "de" ? form.de : (form.translations[lang] ?? emptyTexts());
  const setTexts = (lang: string, patch: Partial<TourTexts>) =>
    setForm((f) =>
      lang === "de"
        ? { ...f, de: { ...f.de, ...patch } }
        : {
            ...f,
            translations: {
              ...f.translations,
              [lang]: { ...(f.translations[lang] ?? emptyTexts()), ...patch },
            },
          },
    );

  const langHasTitle = (lang: string) => getTexts(lang).title.trim() !== "";
  const translatedCount = TOUR_TARGETS.filter(langHasTitle).length;
  const liveDeHash = hashTourTexts(form.de);
  const trStale =
    TOUR_TARGETS.some((l) => form.translations[l]?.title?.trim()) &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash !== liveDeHash;
  const allTranslated = translatedCount === TOUR_TARGETS.length;
  // Dieselbe Grenze wie der Server (translationsPublishable): alle Sprachen da UND
  // aus dem aktuellen deutschen Stand übersetzt.
  const canPublish =
    allTranslated && !!form.translationsSourceHash && form.translationsSourceHash === liveDeHash;

  function onTranslateAll() {
    if (translating) return;
    if (!form.de.title.trim()) return setErr("Bitte zuerst den deutschen Titel eingeben.");
    if (
      TOUR_TARGETS.some((l) => form.translations[l]?.title?.trim()) &&
      !confirm("Vorhandene Übersetzungen mit den neuen überschreiben?")
    )
      return;
    setTranslating(true);
    setErr("");
    setMsg("");
    void (async () => {
      try {
        const r = await translateTourTextsAll(form.de);
        if (r.ok && r.translations) {
          setForm((f) => ({
            ...f,
            translations: { ...f.translations, ...r.translations },
            // Bei Teilausfall die Marke NICHT vorrücken (fehlgeschlagene Sprachen behalten alten Text).
            translationsSourceHash: r.failed?.length ? f.translationsSourceHash : r.sourceHash,
          }));
          const failed = r.failed?.length ? ` (fehlgeschlagen: ${r.failed.join(", ")})` : "";
          setMsg(`✓ In alle Sprachen übersetzt – bitte kurz prüfen${failed}.`);
        } else setErr(adminErrorText(r.error));
      } catch {
        setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      } finally {
        setTranslating(false);
      }
    })();
  }

  // ── Start, Ziel, Route ─────────────────────────────────────────────────────
  const isLoop = sameSpot(form.start, form.end);
  const pointIds = form.stops.map((s) => s.pointId);
  const liveRouteHash = tourRouteHash({ start: form.start, end: form.end, pointIds });
  const routeStale = !!form.routeGeo && !!form.routeHash && form.routeHash !== liveRouteHash;

  // Kontrollpunkte der Karte: bei einem Rundweg nur EINER (sonst lägen zwei Marker
  // übereinander und ein Zug am oberen risse die Runde auseinander).
  const routeMarkers: [number, number][] = isLoop
    ? [[form.start!.lng, form.start!.lat]]
    : [
        ...(form.start ? ([[form.start.lng, form.start.lat]] as [number, number][]) : []),
        ...(form.end ? ([[form.end.lng, form.end.lat]] as [number, number][]) : []),
      ];

  // Linie auf der Karte: die gesnappte Route, sonst die direkte Verbindung über die
  // Stationen (damit man den Verlauf auch vor dem Anpassen sieht).
  const stopLine: [number, number][] = [
    ...(form.start ? ([[form.start.lng, form.start.lat]] as [number, number][]) : []),
    ...form.stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => [s.lng as number, s.lat as number] as [number, number]),
    ...(form.end ? ([[form.end.lng, form.end.lat]] as [number, number][]) : []),
  ];
  const mapLine: [number, number][] = form.routeGeo ?? (stopLine.length > 1 ? stopLine : []);

  // Nummerierte Anzeige-Pins der Stationen. useMemo, weil die Karte bei jedem neuen
  // Array ihre Marker neu aufbaut (sichtbares Flackern bei jedem Tastendruck).
  const stopPins = useMemo(
    () =>
      form.stops
        // Nummer VOR dem Filtern vergeben, sonst trägt die Karte andere Zahlen als
        // die Liste, sobald eine Station noch keinen Punkt auf der Karte hat.
        .map((s, i) => ({ ...s, order: i + 1 }))
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          lat: s.lat as number,
          lng: s.lng as number,
          label: String(s.order),
          title: s.title,
        })),
    [form.stops],
  );

  // Klick/Zug auf der Karte: erster Punkt ist der Start, der letzte das Ziel.
  function onRouteMarkersChange(coords: [number, number][]) {
    if (coords.length === 0) return set({ start: null, end: null });
    const first = { lat: coords[0][1], lng: coords[0][0] };
    if (coords.length === 1) {
      // War es ein Rundweg, bleibt es einer (der eine Marker trägt beide Rollen).
      return set({ start: first, end: isLoop ? first : form.end });
    }
    const last = coords[coords.length - 1];
    set({ start: first, end: { lat: last[1], lng: last[0] } });
  }

  function onSnapRoute() {
    if (snapping) return;
    if (!form.stops.length) return setErr("Bitte zuerst Stationen zur Runde hinzufügen.");
    setSnapping(true);
    setErr("");
    setMsg("");
    void (async () => {
      try {
        const r = await snapTourRoute({
          start: form.start,
          end: form.end,
          pointIds,
          mode: form.mode,
        });
        if (r.ok && r.routeGeo) {
          setForm((f) => ({
            ...f,
            routeGeo: r.routeGeo!,
            routeHash: r.routeHash ?? null,
            // Gehzeit und Länge kommen aus derselben Antwort -> Felder gleich mitfüllen.
            distanceKm: r.distanceKm != null ? String(r.distanceKm) : f.distanceKm,
            durationMin: r.durationMin != null ? String(r.durationMin) : f.durationMin,
          }));
          setMsg(
            `✓ Route an die Wege angepasst${
              r.distanceKm != null ? `: ${r.distanceKm} km, ca. ${r.durationMin} Min` : ""
            }.`,
          );
        } else setErr(adminErrorText(r.error));
      } catch {
        setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      } finally {
        setSnapping(false);
      }
    })();
  }

  // ── Stationen ──────────────────────────────────────────────────────────────
  const usedIds = new Set(pointIds);
  const available = areaPoints.filter((p) => !usedIds.has(p.id));

  function onAreaChange(newAreaId: string) {
    // Ein Fehlgriff ins Dropdown darf keine kuratierte 12-Stopp-Reihenfolge kosten.
    if (
      form.stops.length > 0 &&
      !confirm("Beim Gebiet-Wechsel werden alle Stationen dieser Runde entfernt. Fortfahren?")
    )
      return;
    // Punkte gehören zum Gebiet -> bei Wechsel die Stops leeren und neu laden. Die
    // Route gehört zu genau diesen Stops und wird mit ihnen ungültig.
    setForm((f) => ({ ...f, areaId: newAreaId, stops: [], routeGeo: null, routeHash: null }));
    setAreaPoints([]);
    setPointsErr(false);
    const req = ++pointsReq.current;
    if (!newAreaId) return;
    setLoadingPoints(true);
    void (async () => {
      try {
        const r = await listAreaPoints(newAreaId);
        if (req !== pointsReq.current) return; // veraltete Antwort verwerfen
        if (r.ok && r.points) setAreaPoints(r.points);
        else setPointsErr(true);
      } catch {
        if (req === pointsReq.current) setPointsErr(true);
      } finally {
        if (req === pointsReq.current) setLoadingPoints(false);
      }
    })();
  }

  function addStop(pointId: string) {
    const p = areaPoints.find((x) => x.id === pointId);
    if (!p) return;
    setForm((f) =>
      f.stops.some((s) => s.pointId === pointId)
        ? f
        : {
            ...f,
            stops: [
              ...f.stops,
              { pointId, title: p.title, hasAudio: p.hasAudio, lat: p.lat, lng: p.lng },
            ],
          },
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
    } catch (e) {
      // Wie im AreaForm: den echten Grund zeigen, nicht nur, dass es schiefging.
      setErr(e instanceof Error ? e.message : "Cover-Upload hat nicht geklappt.");
    } finally {
      setUploadingCover(false);
    }
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr("");
    setMsg("");
    if (!form.de.title.trim()) return setErr("Bitte einen deutschen Titel eingeben.");
    if (!form.areaId) return setErr("Bitte ein Gebiet wählen.");
    if (form.status === "published" && !canPublish)
      return setErr(
        trStale
          ? "Deutsch wurde nach dem Übersetzen geändert. Bitte „In alle Sprachen übersetzen“ erneut ausführen."
          : "Zum Veröffentlichen müssen alle Sprachen übersetzt sein („In alle Sprachen übersetzen“).",
      );
    if (
      routeStale &&
      !confirm("Die Route passt nicht mehr zu Start, Ziel und Stationen. Trotzdem speichern?")
    )
      return;
    const payload: TourInput = {
      id: initial?.id,
      areaId: form.areaId,
      emoji: form.emoji,
      coverUrl: form.coverUrl,
      isPro: form.isPro,
      freeStops: form.freeStops,
      status: form.status,
      mode: form.mode,
      durationMin: form.durationMin.trim() ? Number(form.durationMin) : null,
      distanceKm: form.distanceKm.trim() ? Number(form.distanceKm) : null,
      de: form.de,
      translations: form.translations,
      translationsSourceHash: form.translationsSourceHash,
      start: form.start,
      end: form.end,
      routeGeo: form.routeGeo,
      routeHash: form.routeHash,
      stops: form.stops.map((s) => ({ pointId: s.pointId })),
    };
    start(async () => {
      try {
        const r = await saveTour(payload);
        if (r.ok) router.push("/admin/tours");
        else setErr(adminErrorText(r.error));
      } catch {
        setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      }
    });
  }

  function onDelete() {
    if (!initial?.id) return;
    if (!confirm("Diese Tour wirklich löschen? Die Punkte im Gebiets-Pool bleiben erhalten."))
      return;
    start(async () => {
      try {
        const r = await deleteTour(initial.id);
        if (r.ok) router.push("/admin/tours");
        else setErr(adminErrorText(r.error));
      } catch {
        setErr("Gerade nicht erreichbar. Bitte nochmal versuchen.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} onKeyDown={blockEnterSubmit} className="space-y-4 pb-16">
      {/* Texte: Deutsch ist die Quelle, ein Knopf macht daraus alle Sprachen. */}
      <section className={sectionCls}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={h2Cls}>Texte</h2>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              allTranslated && !trStale
                ? "bg-emerald-600/10 text-emerald-700"
                : trStale
                  ? "bg-accent/10 text-accent"
                  : "bg-amber-500/10 text-amber-700"
            }`}
            title={`${translatedCount}/${TOUR_TARGETS.length} Sprachen übersetzt`}
          >
            {allTranslated && !trStale
              ? "🌍 ✓ alle Sprachen"
              : trStale
                ? "🌍 ⚠ veraltet"
                : `🌍 ${translatedCount}/${TOUR_TARGETS.length}`}
          </span>
        </div>

        <div>
          <label className={labelCls}>
            Titel <span className="text-accent">*</span>
          </label>
          <input
            className={inputCls}
            value={form.de.title}
            onChange={(e) => set({ de: { ...form.de, title: e.target.value } })}
            placeholder="🇩🇪 z.B. Antons Hausrunde"
          />
        </div>
        <div>
          <label className={labelCls}>Untertitel</label>
          <input
            className={inputCls}
            value={form.de.subtitle}
            onChange={(e) => set({ de: { ...form.de, subtitle: e.target.value } })}
            placeholder="🇩🇪 Ein Satz, worum es geht"
          />
        </div>
        <div>
          <label className={labelCls}>Beschreibung</label>
          <textarea
            rows={3}
            className={inputCls}
            value={form.de.description}
            onChange={(e) => set({ de: { ...form.de, description: e.target.value } })}
            placeholder="🇩🇪 Zwei, drei Sätze"
          />
        </div>

        <AiButton
          loading={translating}
          loadingLabel="Übersetzt"
          onClick={onTranslateAll}
          disabled={!form.de.title.trim()}
          className="rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
        >
          In alle Sprachen übersetzen
        </AiButton>

        {trStale && (
          <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-[12px] text-accent">
            ⚠ Deutsch wurde nach dem Übersetzen geändert – bitte „In alle Sprachen übersetzen“
            erneut ausführen.
          </p>
        )}

        {/* Übersetzungen prüfen */}
        <div className="rounded-[14px] border border-black/10 p-3">
          <p className="mb-2 text-[12px] font-semibold text-ink">Übersetzungen prüfen</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TOUR_TARGETS.map((l) => {
              const m = localeMeta(l);
              const done = langHasTitle(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setReviewLang(l)}
                  className={`cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
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
              <label className={labelCls}>Titel ({localeMeta(reviewLang).english})</label>
              <input
                className={inputCls}
                value={getTexts(reviewLang).title}
                onChange={(e) => setTexts(reviewLang, { title: e.target.value })}
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
            <div>
              <label className={labelCls}>Beschreibung ({localeMeta(reviewLang).english})</label>
              <textarea
                rows={3}
                className={inputCls}
                value={getTexts(reviewLang).description}
                onChange={(e) => setTexts(reviewLang, { description: e.target.value })}
              />
            </div>
          </div>
        </div>
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
            <option value="">Gebiet wählen …</option>
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
            <label className={labelCls}>Fortbewegung</label>
            <select
              className={inputCls}
              value={form.mode}
              onChange={(e) => set({ mode: e.target.value as TourMode })}
            >
              <option value="walk">{TOUR_MODE_EMOJI.walk} Zu Fuß</option>
              <option value="bike">{TOUR_MODE_EMOJI.bike} Mit dem Rad</option>
            </select>
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
            {form.status === "published" && !canPublish && (
              <p className="mt-1 text-[12px] font-medium text-accent">
                Live gehen kann die Runde erst, wenn alle Sprachen übersetzt und aktuell sind.
              </p>
            )}
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
                  {s.lat == null && (
                    <span className="ml-2 text-[11px] text-accent">⚠︎ kein Punkt auf der Karte</span>
                  )}
                </span>
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => moveStop(i, "up")}
                    disabled={i === 0}
                    aria-label="Nach oben"
                    className="cursor-pointer flex h-4 w-6 items-center justify-center text-muted disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStop(i, "down")}
                    disabled={i === form.stops.length - 1}
                    aria-label="Nach unten"
                    className="cursor-pointer flex h-4 w-6 items-center justify-center text-muted disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  aria-label="Entfernen"
                  className="cursor-pointer flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/5 text-muted transition active:scale-90"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            ))}
          </ol>
        )}

        {!form.areaId ? (
          <p className="text-[13px] text-muted">Zuerst oben ein Gebiet wählen.</p>
        ) : loadingPoints ? (
          <p className="text-[13px] text-muted">Lade Punkte des Gebiets …</p>
        ) : pointsErr ? (
          <p className="text-[13px] font-medium text-accent">
            Punkte konnten nicht geladen werden. Gebiet erneut wählen oder Seite neu laden.
          </p>
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

      {/* Start, Ziel & Geh-Route */}
      <section className={sectionCls}>
        <h2 className={h2Cls}>Start, Ziel & Route</h2>
        <p className="text-[12px] text-muted">
          Erster Tipp auf die Karte setzt den Start 🥾, der nächste das Ziel 🏁. Marker ziehen
          verschiebt sie. Danach die Route an die Fusswege anpassen lassen.
        </p>

        <LocationPicker
          mode="route"
          spot={null}
          parking={null}
          route={routeMarkers}
          line={mapLine}
          placing={null}
          waterStops={[]}
          huts={[]}
          pins={stopPins}
          onSet={() => {}}
          onRouteChange={onRouteMarkersChange}
          onPoiChange={() => {}}
          onExitPlacing={() => {}}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => set({ end: form.start })}
            disabled={!form.start || isLoop}
            className={`${chipCls} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Rundweg (Ziel = Start)
          </button>
          <button
            type="button"
            onClick={() => set({ start: null, end: null })}
            disabled={!form.start && !form.end}
            className={`${chipCls} text-muted disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Start & Ziel entfernen
          </button>
          {form.routeGeo && (
            <button
              type="button"
              onClick={() => set({ routeGeo: null, routeHash: null })}
              className={`${chipCls} text-muted`}
            >
              Route verwerfen
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSnapRoute}
            disabled={snapping || form.stops.length === 0}
            className="cursor-pointer rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {snapping ? <Busy>Route wird angepasst</Busy> : "Route an die Wege anpassen"}
          </button>
          <p className="text-[12px] text-muted">
            {form.start
              ? `Start: ${form.start.lat.toFixed(5)}, ${form.start.lng.toFixed(5)}`
              : "Ohne Start beginnt die Runde an der ersten Station."}
            {isLoop
              ? " · Rundweg"
              : form.end
                ? ` · Ziel: ${form.end.lat.toFixed(5)}, ${form.end.lng.toFixed(5)}`
                : " · Ohne Ziel endet sie an der letzten Station."}
          </p>
        </div>

        {routeStale && (
          <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-[12px] text-accent">
            ⚠ Start, Ziel oder die Reihenfolge der Stationen haben sich geändert – bitte die Route
            neu anpassen lassen.
          </p>
        )}
        {!form.routeGeo && form.stops.length > 0 && (
          <p className="text-[12px] text-muted">
            Noch keine angepasste Route: Die Karte zeigt die direkte Verbindung über die Stationen.
          </p>
        )}
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
            {uploadingCover ? <Busy>Lädt</Busy> : form.coverUrl ? "Ersetzen" : "Bild wählen"}
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
              className="cursor-pointer rounded-full bg-black/5 px-4 py-2 text-[13px] font-semibold text-muted transition active:scale-[0.98]"
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
          disabled={pending || uploadingCover || translating || snapping || loadingPoints}
          className="cursor-pointer rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending
            ? <Busy>Speichern</Busy>
            : uploadingCover
              ? <Busy>Cover lädt</Busy>
              : translating
                ? <Busy>Übersetzt</Busy>
                : snapping
                  ? <Busy>Route</Busy>
                  : "Speichern"}
        </button>
        {initial?.id && (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="cursor-pointer rounded-full bg-black/5 px-5 py-2.5 text-sm font-semibold text-accent disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Löschen
          </button>
        )}
      </div>
    </form>
  );
}
