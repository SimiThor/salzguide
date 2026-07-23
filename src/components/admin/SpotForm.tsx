"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  deleteSpot,
  generateSpotTexts,
  saveSpot,
  searchPlaces,
  snapRoute,
  translateSpotTextsAll,
  type PlaceHit,
  type SpotInput,
  type SpotTexts,
} from "@/lib/admin-actions";
import { routing } from "@/i18n/routing";
import { localeMeta } from "@/i18n/locales";
import { hashSpotTexts } from "@/lib/spot-hash";
import type { AdminCategory, AdminLocal } from "@/lib/admin";
import { emptyManualWeek, type DayHours } from "@/lib/opening-hours";
import type { MapPoi } from "@/lib/geo";
import { POI_SUBTYPES } from "@/lib/poi";
import {
  ACCESS_OPTIONS,
  AREA_GROUPS,
  BEST_SEASONS,
  DIFFICULTIES,
  DURATION_WORDS,
  FAME_LEVELS,
  PRICE_LEVELS,
  subtypeGroups,
} from "@/lib/spot-options";
import { factIsKnown, factPrice } from "@/lib/facts-i18n";
import LocationPicker, { POI_STYLE, type PlacingKind } from "./LocationPicker";
import ElevationProfile from "../ElevationProfile";
import PhotoUploader from "./PhotoUploader";
import VideoUploader from "./VideoUploader";
import AiButton from "./AiButton";
import { STATUS_NEUTRAL, STATUS_ACCENT, STATUS_GOOD } from "@/lib/ui";

const EMPTY: SpotInput = {
  slug: "",
  type: "activity",
  subtype: "",
  emoji: "",
  seasons: ["summer"],
  isPro: false,
  status: "draft",
  sortWeight: 0,
  lat: null,
  lng: null,
  parkingLat: null,
  parkingLng: null,
  waterStops: [],
  huts: [],
  routePoints: [],
  routeSnapped: [],
  elevationProfile: null,
  locationMode: "point",
  difficulty: "",
  bestSeason: "",
  access: "",
  duration: "",
  priceLevel: "",
  area: "",
  fame: "",
  hasOpeningHours: false,
  openingHoursManual: false,
  openingHours: emptyManualWeek(),
  googlePlaceId: "",
  phone: "",
  websiteUrl: "",
  lakeName: "",
  localId: "",
  categoryIds: [],
  images: [],
  videoUrl: null,
  videoPosterUrl: null,
  title: "",
  shortDesc: "",
  general: "",
  insiderTip: "",
  sectionA: "",
  sectionB: "",
  locationText: "",
  translations: {},
};

// Zielsprachen (alle außer Deutsch) für die N-Sprachen-Übersetzung.
const TARGET_LOCALES = routing.locales.filter((l) => l !== "de");
const emptyTexts = (): SpotTexts => ({
  title: "",
  shortDesc: "",
  general: "",
  insiderTip: "",
  sectionA: "",
  sectionB: "",
  locationText: "",
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const input =
  "w-full rounded-[12px] border border-black/10 bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-muted";
const DAY_NAMES = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

// Die Auswahllisten stehen NICHT mehr hier, sondern werden in spot-options.ts aus der
// Übersetzungstabelle abgeleitet. Vorher waren es zwei getrennte Listen, die auseinander
// gelaufen sind: „See" und „Cafe" waren auswählbar, hatten aber keine Übersetzung, und die
// Seite zeigte sie in jeder Sprache deutsch an.
const EMOJIS_ACTIVITY = ["🥾", "🏔️", "⛰️", "🌲", "🌊", "🏊", "💦", "🚠", "⛷️", "🛶", "🚲", "🏰", "🗻", "🌅"];
const EMOJIS_FOOD = ["🍽️", "☕", "🍺", "🥨", "🍦", "🍰", "🍕", "🥐", "🍷", "🫖", "🍔", "🧁"];

function parseDuration(s: string): { value: string; unit: "Std" | "Min" } {
  const m = s.match(/([\d.,]+)\s*(min|std|h|stunde)/i);
  if (m) return { value: m[1], unit: /min/i.test(m[2]) ? "Min" : "Std" };
  return { value: "", unit: "Std" };
}
function composeDuration(value: string, unit: "Std" | "Min"): string {
  return value.trim() === "" ? "" : `${value.trim()} ${unit}`;
}
function durationFromMin(min: number): string {
  if (min < 60) return `${Math.max(5, Math.round(min / 5) * 5)} Min`;
  const h = Math.round((min / 60) * 2) / 2; // auf 0,5 runden
  return `${String(h).replace(".", ",")} Std`;
}
function suggestDifficulty(distanceKm: number, ascent: number): string {
  if (ascent <= 350 && distanceKm <= 7) return "leicht";
  if (ascent <= 800 && distanceKm <= 14) return "mittel";
  return "schwer";
}

export default function SpotForm({
  initial,
  categories,
  locals,
  isNew,
  introStatus = "none",
  introUrl = null,
}: {
  initial?: Partial<SpotInput>;
  categories: AdminCategory[];
  locals: AdminLocal[];
  isNew: boolean;
  introStatus?: "none" | "current" | "stale";
  introUrl?: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SpotInput>({ ...EMPTY, ...initial });
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [snapMsg, setSnapMsg] = useState("");
  // Welcher Zusatzpunkt wird gerade auf der Karte gesetzt (null = normaler Modus).
  const [placing, setPlacing] = useState<PlacingKind>(null);
  const [aiNotes, setAiNotes] = useState("");
  const [aiMsg, setAiMsg] = useState("");
  const [aiWeb, setAiWeb] = useState(true);
  const [enMsg, setEnMsg] = useState("");
  // Welche Übersetzung wird gerade geprüft/bearbeitet (eine Sprache zur Zeit).
  const [reviewLang, setReviewLang] = useState<string>(TARGET_LOCALES[0] ?? "en");
  const [aiAction, setAiAction] = useState<"generate" | "translate" | null>(null); // laufende KI-Aktion
  // Dauer: Zahl + Einheit in eigenem State (robust, keine verlustbehaftete Ableitung)
  const initDur = parseDuration(form.duration);
  const [durValue, setDurValue] = useState(initDur.value);
  const [durUnit, setDurUnit] = useState<"Std" | "Min">(initDur.unit);
  const [placeQ, setPlaceQ] = useState("");
  const [placeHits, setPlaceHits] = useState<PlaceHit[]>([]);
  const [placeMsg, setPlaceMsg] = useState("");
  const [placeBusy, setPlaceBusy] = useState(false);

  async function doPlaceSearch() {
    if (placeQ.trim().length < 3) return;
    setPlaceBusy(true);
    setPlaceMsg("");
    const r = await searchPlaces(placeQ);
    setPlaceBusy(false);
    if (!r.ok) {
      setPlaceHits([]);
      setPlaceMsg(r.error);
    } else {
      setPlaceHits(r.results);
      if (!r.results.length) setPlaceMsg("Keine Treffer.");
    }
  }

  const set = (patch: Partial<SpotInput>) => setForm((f) => ({ ...f, ...patch }));

  // Manuelle Öffnungszeiten: Woche klonen (immutably) + einen Tag verändern.
  const editWeek = (i: number, fn: (d: DayHours) => DayHours) =>
    setForm((f) => {
      const week = (f.openingHours ?? emptyManualWeek()).map((d) => ({
        closed: d.closed,
        ranges: d.ranges.map((r) => ({ ...r })),
      }));
      week[i] = fn(week[i]);
      return { ...f, openingHours: week };
    });

  // Ruhetag umschalten.
  const setDayClosed = (i: number, closed: boolean) =>
    editWeek(i, (d) =>
      closed
        ? { closed: true, ranges: [] }
        : { closed: false, ranges: d.ranges.length ? d.ranges : [{ open: "", close: "" }] },
    );

  // Zeit in Bereich ri setzen (0 = Haupt, 1 = nach Mittagspause).
  const setDayTime = (i: number, ri: number, key: "open" | "close", v: string) =>
    editWeek(i, (d) => {
      const ranges = d.ranges.length ? [...d.ranges] : [{ open: "", close: "" }];
      while (ranges.length <= ri) ranges.push({ open: "", close: "" });
      ranges[ri] = { ...ranges[ri], [key]: v };
      return { closed: false, ranges };
    });

  // Mittagspause (zweite Zeitspanne) hinzufügen / entfernen.
  const addBreak = (i: number) =>
    editWeek(i, (d) => {
      const ranges = d.ranges.length ? [...d.ranges] : [{ open: "", close: "" }];
      if (ranges.length < 2) ranges.push({ open: "", close: "" });
      return { closed: false, ranges };
    });
  const removeBreak = (i: number) =>
    editWeek(i, (d) => ({ closed: false, ranges: d.ranges.slice(0, 1) }));

  function applyDuration(value: string, unit: "Std" | "Min") {
    setDurValue(value);
    setDurUnit(unit);
    set({ duration: composeDuration(value, unit) });
  }

  // Pauschale Dauer („Halbtag") statt Zahl+Einheit. Ohne diesen Weg zeigte das Formular ein
  // gespeichertes „Halbtag" als leeres Feld an — der Wert war unsichtbar und beim nächsten
  // Tippen weg. Zahl und Wort schliessen einander aus, deshalb wird die Zahl geleert.
  function applyDurationWord(word: string) {
    setDurValue("");
    setDurUnit("Std");
    set({ duration: word });
  }
  const durWord = DURATION_WORDS.includes(form.duration.trim()) ? form.duration.trim() : "";

  function toggleSeason(s: string) {
    set({
      seasons: form.seasons.includes(s)
        ? form.seasons.filter((x) => x !== s)
        : [...form.seasons, s],
    });
  }
  function toggleCategory(id: string) {
    set({
      categoryIds: form.categoryIds.includes(id)
        ? form.categoryIds.filter((x) => x !== id)
        : [...form.categoryIds, id],
    });
  }
  function onPoint(which: "spot" | "parking", lat: number | null, lng: number | null) {
    if (which === "spot") set({ lat, lng });
    else set({ parkingLat: lat, parkingLng: lng });
  }

  // Zusatzpunkte (Wasserstellen/Hütten): ein gemeinsamer Satz Helfer für beide Typen.
  const poiList = (kind: "water" | "hut") => (kind === "water" ? form.waterStops : form.huts);
  function setPois(kind: "water" | "hut", pois: MapPoi[]) {
    if (kind === "water") set({ waterStops: pois });
    else set({ huts: pois });
  }
  function addPoi(kind: "water" | "hut") {
    // Neuer Punkt startet in der Kartenmitte-Region; per Ziehen/Setzen platzierbar.
    setPois(kind, [...poiList(kind), { lng: 13.05, lat: 47.8 }]);
  }
  function updatePoi(kind: "water" | "hut", i: number, patch: Partial<MapPoi>) {
    setPois(kind, poiList(kind).map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removePoi(kind: "water" | "hut", i: number) {
    setPois(kind, poiList(kind).filter((_, idx) => idx !== i));
  }
  // Setz-Modus umschalten: Klick auf denselben Knopf beendet ihn (Toggle).
  function togglePlacing(kind: PlacingKind) {
    setPlacing((cur) => (cur === kind ? null : kind));
  }

  // Kontrollpunkte ändern -> Snapping + Höhenprofil verwerfen (muss neu berechnet werden)
  function setRoute(pts: [number, number][]) {
    set({ routePoints: pts, routeSnapped: [], elevationProfile: null });
    setSnapMsg("");
  }
  function updateRoutePt(i: number, lng: number | null, lat: number | null) {
    const cur = form.routePoints[i] ?? [13.05, 47.8];
    const next: [number, number] = [lng ?? cur[0], lat ?? cur[1]];
    setRoute(form.routePoints.map((c, idx) => (idx === i ? next : c)));
  }
  function removeRoutePt(i: number) {
    setRoute(form.routePoints.filter((_, idx) => idx !== i));
  }
  function moveRoutePt(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= form.routePoints.length) return;
    const next = [...form.routePoints];
    [next[i], next[j]] = [next[j], next[i]];
    setRoute(next);
  }
  function addRoutePt() {
    setRoute([...form.routePoints, [13.05, 47.8]]);
  }
  function onSnap() {
    setSnapMsg("");
    start(async () => {
      const r = await snapRoute(form.routePoints);
      if (r.ok && r.coords) {
        const patch: Partial<SpotInput> = {
          routeSnapped: r.coords,
          elevationProfile: r.profile ?? null,
        };
        const auto: string[] = [];
        if (!form.duration.trim() && r.durationMin) {
          const lbl = durationFromMin(r.durationMin);
          const p = parseDuration(lbl);
          setDurValue(p.value);
          setDurUnit(p.unit);
          patch.duration = lbl;
          auto.push("Dauer");
        }
        if (!form.difficulty.trim() && r.distanceKm != null && r.profile) {
          patch.difficulty = suggestDifficulty(r.distanceKm, r.profile.ascent);
          auto.push("Schwierigkeit");
        }
        set(patch);
        const km = r.distanceKm ? `${r.distanceKm.toFixed(1)} km` : "";
        const hm = r.profile ? ` · ↑${r.profile.ascent} ↓${r.profile.descent} hm` : "";
        // Berechnete Gehzeit der GANZEN Route immer zeigen -> eine schon gesetzte (evtl.
        // veraltete) Dauer fällt sofort auf, sobald man z.B. auf hin+zurück umstellt.
        const time = r.durationMin ? ` · ~${durationFromMin(r.durationMin)}` : "";
        const autoMsg = auto.length ? ` · ${auto.join(" & ")} übernommen` : "";
        setSnapMsg(`Angepasst · ${km}${hm}${time}${autoMsg}`);
      } else {
        setSnapMsg(r.error ?? "Fehler beim Anpassen");
      }
    });
  }

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErr("");
    // Veröffentlichen-Gate: NUR beim Übergang Entwurf->Veröffentlicht (nicht beim Editieren eines
    // bereits live Spots). Live NUR mit vollständigen & aktuellen Übersetzungen. Entwurf geht immer.
    if (form.status === "published" && !wasPublished && !trComplete) {
      setErr(
        `Zum Veröffentlichen müssen alle Sprachen übersetzt & aktuell sein (${translatedLangs.length}/${TARGET_LOCALES.length}). ` +
          "Bitte „🌍 In alle Sprachen übersetzen“ – oder Status auf „Entwurf“ stellen.",
      );
      return;
    }
    // Deutsch geändert, Übersetzungen veraltet -> auffordern (nur bei veröffentlichten Spots;
    // Entwurf-Speichern bleibt immer ohne Rückfrage). Übersetzungen fallen sonst auf Deutsch zurück.
    if (
      form.status === "published" &&
      trStale &&
      !confirm(
        "Der deutsche Text wurde geändert – die Übersetzungen sind dadurch VERALTET.\n\nBesser zuerst „🌍 In alle Sprachen übersetzen“ klicken.\n\nTrotzdem jetzt speichern (veraltete Übersetzungen bleiben)?",
      )
    )
      return;
    start(async () => {
      const r = await saveSpot(form);
      if (r.ok) router.push("/admin");
      else
        setErr(
          r.error === "place_id_required"
            ? "Google Place ID ist Pflicht – bitte eintragen oder auf „Manuell angeben“ umstellen."
            : r.error === "required"
              ? "Bitte Slug und Titel ausfüllen."
              : r.error === "translations_incomplete"
                ? "Zum Veröffentlichen erst „🌍 In alle Sprachen übersetzen“ – oder als Entwurf speichern."
                : r.error === "translations_persist_failed"
                  ? "Übersetzungen konnten nicht gespeichert werden – der Spot bleibt als Entwurf. Bitte erneut versuchen."
                  : (r.error ?? "Fehler"),
        );
    });
  }

  function onDelete() {
    if (!form.id || !confirm("Diesen Spot wirklich löschen?")) return;
    start(async () => {
      const r = await deleteSpot(form.id!);
      if (r.ok) router.push("/admin");
      else setErr(r.error ?? "Fehler");
    });
  }

  function onGenerate() {
    if (!form.title.trim()) {
      setAiMsg("Bitte zuerst einen Titel eingeben.");
      return;
    }
    const hasText = [
      form.general,
      form.insiderTip,
      form.sectionA,
      form.sectionB,
      form.locationText,
      form.shortDesc,
    ].some((s) => s.trim());
    if (hasText && !confirm("Vorhandene Texte mit den KI-Vorschlägen überschreiben?")) return;
    setAiMsg("");
    setAiAction("generate");
    start(async () => {
      const localName = locals.find((l) => l.id === form.localId)?.name ?? "";
      const cats = categories
        .filter((c) => form.categoryIds.includes(c.id))
        .map((c) => c.title);
      const route =
        form.locationMode === "route" && form.elevationProfile
          ? {
              distanceKm: form.elevationProfile.distanceKm,
              ascent: form.elevationProfile.ascent,
              descent: form.elevationProfile.descent,
            }
          : null;
      const r = await generateSpotTexts({
        type: form.type,
        title: form.title,
        subtype: form.subtype,
        seasons: form.seasons,
        categories: cats,
        localName,
        notes: aiNotes,
        difficulty: form.difficulty,
        bestSeason: form.bestSeason,
        duration: form.duration,
        access: form.access,
        route,
        area: form.area,
        priceLevel: form.priceLevel,
        fame: form.fame,
        useWebResearch: aiWeb,
      });
      setAiAction(null);
      if (r.ok && r.texts) {
        set({
          general: r.texts.general,
          insiderTip: r.texts.insiderTip,
          sectionA: r.texts.sectionA,
          sectionB: r.texts.sectionB,
          locationText: r.texts.locationText,
          shortDesc: r.texts.shortDesc,
        });
        const web =
          r.searchCount && r.searchCount > 0
            ? ` · ${r.sources?.length ?? 0} Web-Quellen einbezogen`
            : aiWeb
              ? " (ohne Web-Recherche)"
              : "";
        setAiMsg(`✓ Texte erzeugt${web} – bitte prüfen und ggf. anpassen.`);
      } else {
        setAiMsg(r.error ?? "Fehler bei der KI-Generierung");
      }
    });
  }

  // Ein deutsches Textfeld (Quelle). Einspaltig; Übersetzungen stehen im Panel darunter.
  type TxtKey = "shortDesc" | "general" | "insiderTip" | "sectionA" | "sectionB" | "locationText";
  function deField(label: string, key: TxtKey, multiline: boolean, rows = 2) {
    const v = form[key];
    const on = (val: string) => set({ [key]: val } as Partial<SpotInput>);
    return (
      <div>
        <label className={labelCls}>{label}</label>
        {multiline ? (
          <textarea className={input} rows={rows} value={v} onChange={(e) => on(e.target.value)} placeholder="🇩🇪 Deutsch" />
        ) : (
          <input className={input} value={v} onChange={(e) => on(e.target.value)} placeholder="🇩🇪 Deutsch" />
        )}
      </div>
    );
  }

  // Ein Übersetzungs-Feld für die aktuell geprüfte Sprache (reviewLang).
  function trField(label: string, key: keyof SpotTexts, multiline: boolean, rows = 2) {
    const tx = form.translations[reviewLang] ?? emptyTexts();
    const v = tx[key];
    const on = (val: string) =>
      set({ translations: { ...form.translations, [reviewLang]: { ...tx, [key]: val } } });
    return (
      <div>
        <label className={labelCls}>{label}</label>
        {multiline ? (
          <textarea className={input} rows={rows} value={v} onChange={(e) => on(e.target.value)} />
        ) : (
          <input className={input} value={v} onChange={(e) => on(e.target.value)} />
        )}
      </div>
    );
  }

  // KI: deutsche Texte in ALLE Sprachen übersetzen (parallel). Ergebnis ist review-/editierbar.
  function onTranslateAll() {
    if (!form.title.trim() || ![form.general, form.shortDesc, form.insiderTip].some((s) => s.trim())) {
      setEnMsg("Bitte zuerst die deutschen Texte erstellen.");
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
      const r = await translateSpotTextsAll({
        title: form.title,
        shortDesc: form.shortDesc,
        general: form.general,
        insiderTip: form.insiderTip,
        sectionA: form.sectionA,
        sectionB: form.sectionB,
        locationText: form.locationText,
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

  // Übersetzungs-Status (Anti-Chaos): aktueller DE-Hash vs. Hash, aus dem übersetzt wurde.
  const liveDeHash = hashSpotTexts({
    title: form.title,
    shortDesc: form.shortDesc,
    general: form.general,
    insiderTip: form.insiderTip,
    sectionA: form.sectionA,
    sectionB: form.sectionB,
    locationText: form.locationText,
  });
  const translatedLangs = TARGET_LOCALES.filter((l) => form.translations[l]?.title?.trim());
  const trStale =
    translatedLangs.length > 0 &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash !== liveDeHash;
  // Veröffentlichbar = ALLE Sprachen da UND per „In alle Sprachen übersetzen" erzeugt & aktuell
  // (source_hash-Marke passt). Strenger als „nicht veraltet", damit von Hand getippte
  // Übersetzungen ohne Marke nicht als fertig zählen (deckt sich 1:1 mit dem Server).
  const trComplete =
    translatedLangs.length === TARGET_LOCALES.length &&
    !!form.translationsSourceHash &&
    form.translationsSourceHash === liveDeHash;
  // Nur der Übergang Entwurf->Veröffentlicht wird geblockt; ein bereits live Spot bleibt editierbar.
  const wasPublished = initial?.status === "published";

  const isFood = form.type === "food";
  const sommerCats = categories.filter((c) => c.season === "summer");
  const winterCats = categories.filter((c) => c.season === "winter");

  return (
    <form onSubmit={onSubmit} className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">
          {isNew ? "Neuer Spot" : "Spot bearbeiten"}
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
      {err && <p className="rounded-[12px] bg-accent/10 px-3 py-2 text-sm text-accent">{err}</p>}

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
            onChange={(e) => {
              const title = e.target.value;
              set(
                isNew && (form.slug === "" || form.slug === slugify(form.title))
                  ? { title, slug: slugify(title) }
                  : { title },
              );
            }}
            required
          />
        </div>
        {/* Typ zuerst: steuert die Emoji- und Unterkategorie-Vorschläge darunter. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Typ</label>
            <select className={input} value={form.type} onChange={(e) => set({ type: e.target.value as "activity" | "food" })}>
              <option value="activity">Aktiv (Wanderung/Ort)</option>
              <option value="food">Food (Lokal)</option>
            </select>
          </div>
          <div>
            {/* Auswahl statt Freitext: Die Unterkategorie steht auf der Detailseite und muss
                in 9 Sprachen erscheinen. Frei getippt entstand genau der Fehler, den das hier
                verhindert („Cafe" ohne Akzent, „See" statt „See & Baden"). */}
            <label className={labelCls}>Unterkategorie (Label)</label>
            <select className={input} value={form.subtype} onChange={(e) => set({ subtype: e.target.value })}>
              <option value="">—</option>
              {/* Altwert erhalten, statt ihn beim nächsten Speichern still zu löschen. */}
              {form.subtype && !factIsKnown("subtype", form.subtype) && (
                <option value={form.subtype}>{form.subtype} (alt, ohne Übersetzung)</option>
              )}
              {Object.entries(subtypeGroups(isFood)).map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Slug (URL)</label>
            <input className={input} value={form.slug} onChange={(e) => set({ slug: e.target.value })} required />
          </div>
          <div>
            <label className={labelCls}>Emoji</label>
            <input className={input} value={form.emoji} onChange={(e) => set({ emoji: e.target.value })} placeholder="🌳" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Emoji schnell wählen</label>
          <div className="flex flex-wrap gap-1">
            {(isFood ? EMOJIS_FOOD : EMOJIS_ACTIVITY).map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => set({ emoji: em })}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg ${
                  form.emoji === em ? "bg-accent/15 ring-1 ring-accent" : "bg-black/5"
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select className={input} value={form.status} onChange={(e) => set({ status: e.target.value as "draft" | "published" })}>
            <option value="draft">Entwurf</option>
            <option value="published">Veröffentlicht</option>
          </select>
          {!wasPublished && !trComplete && (
            <p className="mt-1 text-[12px] text-amber-700">
              🌍 Veröffentlichen erst möglich, wenn alle Sprachen übersetzt &amp; aktuell sind
              ({translatedLangs.length}/{TARGET_LOCALES.length}). Sonst nur als Entwurf.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-[#cc2924]" checked={form.seasons.includes("summer")} onChange={() => toggleSeason("summer")} />
            ☀️ Sommer
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-[#cc2924]" checked={form.seasons.includes("winter")} onChange={() => toggleSeason("winter")} />
            ❄️ Winter
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-[#cc2924]" checked={form.isPro} onChange={(e) => set({ isPro: e.target.checked })} />
            🔒 Pro-Spot
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-[#cc2924]" checked={form.hasOpeningHours} onChange={(e) => set({ hasOpeningHours: e.target.checked })} />
            🕒 Öffnungszeiten
          </label>
        </div>
      </section>

      {/* Öffnungszeiten – Modus: Google Places (Default) ODER manuell */}
      {form.hasOpeningHours && (
        <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-semibold text-ink">🕒 Öffnungszeiten</h2>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#cc2924]"
              checked={form.openingHoursManual}
              onChange={(e) => set({ openingHoursManual: e.target.checked })}
            />
            Manuell angeben (sonst automatisch über Google Places)
          </label>

          {!form.openingHoursManual ? (
            <div className="max-w-md space-y-3">
              {/* Ort suchen -> Place ID automatisch übernehmen */}
              <div>
                <label className={labelCls}>Ort suchen (übernimmt die Place ID)</label>
                <div className="flex gap-2">
                  <input
                    className={input}
                    value={placeQ}
                    onChange={(e) => setPlaceQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        doPlaceSearch();
                      }
                    }}
                    placeholder="z. B. Gasthof Name, Ort"
                  />
                  <button
                    type="button"
                    onClick={doPlaceSearch}
                    disabled={placeBusy}
                    className="shrink-0 rounded-[12px] bg-ink px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {placeBusy ? "…" : "Suchen"}
                  </button>
                </div>
                {placeMsg && <p className="mt-1 text-xs text-muted">{placeMsg}</p>}
                {placeHits.length > 0 && (
                  <ul className="mt-2 divide-y divide-black/[0.06] overflow-hidden rounded-[12px] border border-black/10">
                    {placeHits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => {
                            set({ googlePlaceId: h.id });
                            setPlaceHits([]);
                            setPlaceMsg(`✓ Übernommen: ${h.name}`);
                          }}
                          className="block w-full px-3 py-2 text-left hover:bg-black/[0.03]"
                        >
                          <span className="text-sm font-medium text-ink">{h.name}</span>
                          {h.address && (
                            <span className="block text-xs text-muted">{h.address}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label className={labelCls}>
                  Google Place ID <span className="text-accent">*</span>
                </label>
                <input
                  className={input}
                  value={form.googlePlaceId}
                  onChange={(e) => set({ googlePlaceId: e.target.value })}
                  placeholder="z. B. ChIJ…"
                />
                <p className="mt-1 text-xs text-muted">
                  Pflichtfeld im Google-Modus. Zeiten werden live von Google geladen
                  (serverseitig gecacht – nicht pro Besucher).
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {DAY_NAMES.map((name, i) => {
                const week = form.openingHours ?? emptyManualWeek();
                const d = week[i];
                const r0 = d.ranges[0] ?? { open: "", close: "" };
                const r1 = d.ranges[1] ?? { open: "", close: "" };
                const timeCls =
                  "rounded-[10px] border border-black/10 px-2 py-1 text-ink outline-none focus:border-accent";
                return (
                  <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="w-24 shrink-0 text-ink">{name}</span>
                    <label className="flex w-24 shrink-0 items-center gap-1 text-muted">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#cc2924]"
                        checked={d.closed}
                        onChange={(e) => setDayClosed(i, e.target.checked)}
                      />
                      Ruhetag
                    </label>
                    {!d.closed && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input type="time" className={timeCls} value={r0.open} onChange={(e) => setDayTime(i, 0, "open", e.target.value)} />
                        <span className="text-muted">–</span>
                        <input type="time" className={timeCls} value={r0.close} onChange={(e) => setDayTime(i, 0, "close", e.target.value)} />
                        {d.ranges.length >= 2 ? (
                          <>
                            <span className="mx-0.5 text-muted">+</span>
                            <input type="time" className={timeCls} value={r1.open} onChange={(e) => setDayTime(i, 1, "open", e.target.value)} />
                            <span className="text-muted">–</span>
                            <input type="time" className={timeCls} value={r1.close} onChange={(e) => setDayTime(i, 1, "close", e.target.value)} />
                            <button type="button" onClick={() => removeBreak(i)} className="ml-0.5 text-xs text-muted hover:text-accent">
                              ✕ Pause
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => addBreak(i)} className="ml-1 text-xs font-medium text-accent">
                            + Mittagspause
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-muted">
                Leer lassen = keine Angabe für den Tag. „+ Mittagspause“ für eine
                zweite Zeitspanne. Über Mitternacht (z. B. 20:00–02:00) ist erlaubt.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Kategorien */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Kategorien (Karussells)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sommer</p>
            <div className="flex flex-col gap-1.5">
              {sommerCats.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-[#cc2924]" checked={form.categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                  {c.title}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Winter</p>
            <div className="flex flex-col gap-1.5">
              {winterCats.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-[#cc2924]" checked={form.categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                  {c.title}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Fotos */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Fotos</h2>
        <p className="text-xs text-muted">
          Zum Sortieren ziehen. Das erste Bild ist das Hero (auf Karten & Detailseite),
          mit ★ holst du eines direkt nach vorn. Fotos lassen sich auch hierher ziehen;
          sie werden automatisch zu WebP verkleinert.
        </p>
        <PhotoUploader images={form.images} onChange={(urls) => set({ images: urls })} />
      </section>

      {/* Video (9:16, optional) */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Video (9:16, optional)</h2>
        <p className="text-xs text-muted">
          Ein kurzes Hochkant-Video für die Spot-Unterseite. Ohne Video erscheint keine
          Video-Sektion.
        </p>
        <VideoUploader
          videoUrl={form.videoUrl}
          posterUrl={form.videoPosterUrl}
          onChange={(videoUrl, posterUrl) =>
            set({ videoUrl, videoPosterUrl: posterUrl })
          }
        />
      </section>

      {/* Intro-Video: automatisch aus der Route gerendert. Nur für Spots mit Route. */}
      {!isNew && form.routeSnapped.length >= 2 && (
        <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Intro-Video (aus der Route)</h2>
            <span
              className={
                introStatus === "current"
                  ? STATUS_GOOD
                  : introStatus === "stale"
                    ? STATUS_ACCENT
                    : STATUS_NEUTRAL
              }
            >
              {introStatus === "current"
                ? "Aktuell"
                : introStatus === "stale"
                  ? "Veraltet"
                  : "Keins"}
            </span>
          </div>
          <p className="text-xs text-muted">
            {introStatus === "current"
              ? "Das 3D-Wander-Video passt zur aktuellen Route."
              : introStatus === "stale"
                ? "Die Route hat sich seit dem letzten Render geändert. Bitte neu rendern, sonst zeigt der Spot die alte Strecke."
                : "Noch kein Intro-Video. Erzeuge es mit dem Befehl unten."}
          </p>
          {introUrl && (
            <a
              href={introUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-accent underline"
            >
              Aktuelles Video ansehen
            </a>
          )}
          <div className="rounded-[10px] bg-black/5 p-3">
            <code className="select-all break-all text-[12px] text-ink">
              npm run render:intro -- {form.slug} --upload
            </code>
          </div>
          <p className="text-[11px] text-muted">
            Lokal ausführen, während der Dev-Server läuft. Rendert die Animation neu und lädt sie hoch.
          </p>
        </section>
      )}

      {/* Karte / Koordinaten */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Lage auf der Karte</h2>

        {/* Modus: Einzelner Punkt ODER Wanderung */}
        <div className="inline-flex rounded-full bg-black/5 p-1">
          {(
            [
              { m: "point", label: "📍 Einzelner Punkt" },
              { m: "route", label: "🥾 Wanderung" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.m}
              type="button"
              onClick={() => set({ locationMode: opt.m })}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                form.locationMode === opt.m ? "bg-white text-ink shadow-sm" : "text-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {form.locationMode === "route"
            ? "Wanderung: Start → (Wegpunkte) → Ziel auf die Karte klicken. Der Startpunkt ist automatisch das Anreiseziel (Auto/Öffis)."
            : "Einzelner Punkt: Spot-Ort setzen. Der Spot-Punkt ist zugleich das Anreiseziel."}
        </p>

        <LocationPicker
          mode={form.locationMode}
          spot={
            form.locationMode === "point" && form.lat != null && form.lng != null
              ? { lat: form.lat, lng: form.lng }
              : null
          }
          parking={form.parkingLat != null && form.parkingLng != null ? { lat: form.parkingLat, lng: form.parkingLng } : null}
          route={form.locationMode === "route" ? form.routePoints : []}
          line={
            form.locationMode === "route"
              ? form.routeSnapped.length >= 2
                ? form.routeSnapped
                : form.routePoints
              : []
          }
          placing={placing}
          waterStops={form.waterStops}
          huts={form.huts}
          onSet={onPoint}
          onRouteChange={setRoute}
          onPoiChange={setPois}
          onExitPlacing={() => setPlacing(null)}
        />

        {/* Wegpunkt-Editor (nur Wanderung): Koordinaten + Reihenfolge + Snapping */}
        {form.locationMode === "route" && (
          <div className="space-y-2 rounded-[12px] bg-black/[0.03] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted">Wegpunkte (Start → Ziel)</p>
              <button
                type="button"
                onClick={addRoutePt}
                className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-ink"
              >
                + Punkt
              </button>
            </div>
            {form.routePoints.length === 0 && (
              <p className="text-xs text-muted">
                Noch keine Punkte – auf die Karte klicken oder „+ Punkt“.
              </p>
            )}
            {form.routePoints.map((c, i) => (
              <div key={i} className="grid grid-cols-[22px_1fr_1fr_auto] items-center gap-2">
                <span className="text-center text-xs text-muted">
                  {i === 0 ? "🥾" : i === form.routePoints.length - 1 ? "🏁" : i + 1}
                </span>
                <input
                  className={input}
                  type="number"
                  step="any"
                  placeholder="lat"
                  value={c[1]}
                  onChange={(e) =>
                    updateRoutePt(i, c[0], e.target.value === "" ? null : parseFloat(e.target.value))
                  }
                />
                <input
                  className={input}
                  type="number"
                  step="any"
                  placeholder="lng"
                  value={c[0]}
                  onChange={(e) =>
                    updateRoutePt(i, e.target.value === "" ? null : parseFloat(e.target.value), c[1])
                  }
                />
                <span className="flex gap-1">
                  <button type="button" onClick={() => moveRoutePt(i, -1)} className="rounded-md bg-black/5 px-2 py-1 text-xs text-ink">↑</button>
                  <button type="button" onClick={() => moveRoutePt(i, 1)} className="rounded-md bg-black/5 px-2 py-1 text-xs text-ink">↓</button>
                  <button type="button" onClick={() => removeRoutePt(i)} className="rounded-md bg-black/5 px-2 py-1 text-xs text-accent">✕</button>
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onSnap}
                disabled={pending || form.routePoints.length < 2}
                className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                🥾 An Wanderwege anpassen
              </button>
              {form.routeSnapped.length >= 2 && (
                <>
                  <button
                    type="button"
                    onClick={() => set({ routeSnapped: [], elevationProfile: null })}
                    className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-medium text-ink"
                  >
                    Anpassung verwerfen
                  </button>
                  <span className="rounded-full bg-green-600/10 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                    an Wege gesnappt
                  </span>
                </>
              )}
              {snapMsg && <span className="text-xs text-muted">{snapMsg}</span>}
            </div>

            {form.elevationProfile && (
              <ElevationProfile profile={form.elevationProfile} title="Höhenprofil (Vorschau)" />
            )}
          </div>
        )}

        {/* Spot-Punkt: Koordinaten manuell (nur Einzelpunkt) */}
        {form.locationMode === "point" && (
          <div className="grid grid-cols-[96px_1fr_1fr] items-center gap-2">
            <span className="text-[13px] text-ink">Spot-Punkt</span>
            <input
              className={input}
              type="number"
              step="any"
              placeholder="lat (47.8…)"
              value={form.lat ?? ""}
              onChange={(e) => set({ lat: e.target.value === "" ? null : parseFloat(e.target.value) })}
            />
            <input
              className={input}
              type="number"
              step="any"
              placeholder="lng (13.0…)"
              value={form.lng ?? ""}
              onChange={(e) => set({ lng: e.target.value === "" ? null : parseFloat(e.target.value) })}
            />
          </div>
        )}

        {/* Eigener Schritt: Parkplatz (getrennt von Route/Spot) */}
        <div className="space-y-2 rounded-[12px] bg-black/[0.03] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">
              🅿️ Parkplatz <span className="font-normal text-muted">(optional)</span>
            </p>
            {form.parkingLat != null && form.parkingLng != null ? (
              <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                ✓ gesetzt
              </span>
            ) : (
              <span className={STATUS_NEUTRAL}>
                nicht gesetzt
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            Separater Schritt: Button drücken, dann den Parkplatz auf der Karte antippen.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => togglePlacing("parking")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                placing === "parking" ? "bg-black/10 text-ink" : "bg-[#2563eb] text-white"
              }`}
            >
              {placing === "parking"
                ? "Abbrechen"
                : form.parkingLat != null
                  ? "Auf Karte ändern"
                  : "📍 Auf der Karte setzen"}
            </button>
            {form.parkingLat != null && form.parkingLng != null && (
              <button
                type="button"
                onClick={() => {
                  set({ parkingLat: null, parkingLng: null });
                  setPlacing((p) => (p === "parking" ? null : p));
                }}
                className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-medium text-accent"
              >
                Entfernen
              </button>
            )}
          </div>
          <div className="grid grid-cols-[96px_1fr_1fr] items-center gap-2">
            <span className="text-[13px] text-muted">Koordinaten</span>
            <input
              className={input}
              type="number"
              step="any"
              placeholder="lat"
              value={form.parkingLat ?? ""}
              onChange={(e) => set({ parkingLat: e.target.value === "" ? null : parseFloat(e.target.value) })}
            />
            <input
              className={input}
              type="number"
              step="any"
              placeholder="lng"
              value={form.parkingLng ?? ""}
              onChange={(e) => set({ parkingLng: e.target.value === "" ? null : parseFloat(e.target.value) })}
            />
          </div>
        </div>

        {/* Zusatzpunkte: Wasserstellen und Hütten. Gleiche UI für beide Typen (einmal
            geschrieben), jeder Typ mit „auf der Karte sammeln" + optionalem Namen je Punkt. */}
        {(["water", "hut"] as const).map((kind) => {
          const style = POI_STYLE[kind];
          const list = kind === "water" ? form.waterStops : form.huts;
          const active = placing === kind;
          const plural = kind === "water" ? "Wasserstellen" : "Hütten";
          return (
            <div key={kind} className="space-y-2 rounded-[12px] bg-black/[0.03] p-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-ink">
                  {style.emoji} {plural} <span className="font-normal text-muted">(optional)</span>
                </p>
                <span className={STATUS_NEUTRAL}>
                  {list.length === 0 ? "keine" : `${list.length} gesetzt`}
                </span>
              </div>
              <p className="text-xs text-muted">
                Knopf drücken, dann auf der Karte antippen (mehrere möglich). Marker lassen sich ziehen.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePlacing(kind)}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-white"
                  style={{ background: active ? "#374151" : style.color }}
                >
                  {active ? "Fertig" : `${style.emoji} Auf der Karte setzen`}
                </button>
                <button
                  type="button"
                  onClick={() => addPoi(kind)}
                  className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-medium text-ink"
                >
                  + manuell
                </button>
              </div>
              {list.length > 0 && (
                <div className="space-y-2">
                  {list.map((p, i) => (
                    <div key={i} className="space-y-1.5 rounded-[10px] bg-white/70 p-2">
                      <div className="grid grid-cols-[140px_1fr] gap-1.5">
                        <select
                          className={input}
                          value={p.subtype ?? ""}
                          onChange={(ev) => updatePoi(kind, i, { subtype: ev.target.value })}
                        >
                          <option value="">Typ (optional)</option>
                          {POI_SUBTYPES[kind].map((s) => (
                            <option key={s.code} value={s.code}>
                              {s.emoji} {s.de}
                            </option>
                          ))}
                        </select>
                        <input
                          className={input}
                          type="text"
                          placeholder="Name (optional)"
                          value={p.name ?? ""}
                          onChange={(ev) => updatePoi(kind, i, { name: ev.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                        <input
                          className={input}
                          type="number"
                          step="any"
                          placeholder="lat"
                          value={p.lat}
                          onChange={(ev) =>
                            updatePoi(kind, i, { lat: ev.target.value === "" ? 0 : parseFloat(ev.target.value) })
                          }
                        />
                        <input
                          className={input}
                          type="number"
                          step="any"
                          placeholder="lng"
                          value={p.lng}
                          onChange={(ev) =>
                            updatePoi(kind, i, { lng: ev.target.value === "" ? 0 : parseFloat(ev.target.value) })
                          }
                        />
                        <button
                          type="button"
                          onClick={() => removePoi(kind, i)}
                          aria-label={`${plural}-Punkt entfernen`}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-accent"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Quick-Facts */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <h2 className="text-[15px] font-semibold text-ink">Quick-Facts</h2>
        {isFood ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Preisniveau</label>
              {/* factPrice bügelt Wort-Werte („mittel") auf €€ — die standen so in der DB und
                  waren auch auf Deutsch falsch. Dadurch trifft die Auswahl wieder zu. */}
              <select
                className={input}
                value={factPrice(form.priceLevel) ?? ""}
                onChange={(e) => set({ priceLevel: e.target.value })}
              >
                <option value="">—</option>
                {form.priceLevel && !PRICE_LEVELS.some(([v]) => v === factPrice(form.priceLevel)) && (
                  <option value={form.priceLevel}>{form.priceLevel} (alt)</option>
                )}
                {PRICE_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Bekanntheit</label>
              <select className={input} value={form.fame} onChange={(e) => set({ fame: e.target.value })}>
                <option value="">—</option>
                {form.fame && !factIsKnown("fame", form.fame) && (
                  <option value={form.fame}>{form.fame} (alt, ohne Übersetzung)</option>
                )}
                {FAME_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Dauer</label>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <input
                  className={input}
                  type="text"
                  inputMode="decimal"
                  placeholder="z. B. 1,5"
                  value={durValue}
                  disabled={Boolean(durWord)}
                  onChange={(e) => applyDuration(e.target.value, durUnit)}
                />
                <select
                  className={input}
                  value={durUnit}
                  disabled={Boolean(durWord)}
                  onChange={(e) => applyDuration(durValue, e.target.value as "Std" | "Min")}
                >
                  <option value="Std">Std</option>
                  <option value="Min">Min</option>
                </select>
              </div>
              <select
                className={`${input} mt-2`}
                value={durWord}
                onChange={(e) => (e.target.value ? applyDurationWord(e.target.value) : applyDuration("", "Std"))}
              >
                <option value="">… oder pauschal</option>
                {DURATION_WORDS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Schwierigkeit</label>
              <select className={input} value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
                <option value="">—</option>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Beste Zeit</label>
              <select className={input} value={form.bestSeason} onChange={(e) => set({ bestSeason: e.target.value })}>
                <option value="">—</option>
                {/* factIsKnown statt includes: „Mai–Oktober" löst sich per Alias auf
                    „Mai bis Oktober" auf und ist damit KEIN Altwert mehr. */}
                {form.bestSeason && !factIsKnown("season", form.bestSeason) && (
                  <option value={form.bestSeason}>{form.bestSeason} (alt, ohne Übersetzung)</option>
                )}
                {BEST_SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Anreise</label>
              <select className={input} value={form.access} onChange={(e) => set({ access: e.target.value })}>
                <option value="">—</option>
                {ACCESS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Gegend: EIN Feld für beide Spot-Typen, bewusst ausserhalb der beiden Raster.
            Bei Lokalen ist sie einer der vier Quick-Facts auf der Spot-Seite. Bei Aktivitäten
            sind die vier Plätze mit Dauer/Schwierigkeit/Zeit/Anreise belegt, dort erscheint
            sie NICHT — sie füttert nur Toni, der damit Spots einer Region findet
            (ai-assistant.ts: Suchbegriff und Spot-Details). Kein zweites Feld dafür: dieselbe
            Spalte, dieselbe Auswahlliste, nur ein anderer Hinweistext.

            Bewusst KEIN hartes Dropdown: Das Salzburger Land hat mehr Orte, als eine Liste je
            führen kann, und ein Riegel hiesse, den passenden Ort gar nicht einzutragen.
            Stattdessen viele Vorschläge plus sichtbare Warnung. */}
        <div>
          <label className={labelCls}>Standort / Gegend</label>
          <input className={input} list="sg-areas" value={form.area} onChange={(e) => set({ area: e.target.value })} placeholder="z. B. Aigen" />
          <datalist id="sg-areas">
            {Object.values(AREA_GROUPS).flat().map((a) => <option key={a} value={a} />)}
          </datalist>
          <p className="mt-1 text-[12px] leading-snug text-ink/50">
            {isFood
              ? "Steht als Quick-Fact auf der Spot-Seite."
              : "Steht nicht auf der Spot-Seite (dort sind die vier Plätze belegt), hilft aber Toni beim Finden."}
          </p>
          {!factIsKnown("area", form.area) && (
            <p className="mt-1 text-[12px] leading-snug text-accent">
              „{form.area}&ldquo; steht in keiner Gegend-Liste und bleibt in allen 9 Sprachen deutsch.
              Wähle einen Vorschlag oder trag den Ort in facts-i18n.json nach.
            </p>
          )}
        </div>
      </section>

      {/* Texte – Deutsch als Quelle, KI-Übersetzung in alle Sprachen */}
      <section className="space-y-3 rounded-[16px] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-ink">Texte · Deutsch + Übersetzungen</h2>
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

        {/* KI: Deutsch erzeugen + in alle Sprachen übersetzen – beides immer sichtbar */}
        <div className="space-y-2 rounded-[12px] bg-accent/[0.06] p-3">
          <label className={labelCls}>Notizen / Stichworte für die KI (Deutsch)</label>
          <textarea
            className={input}
            rows={2}
            value={aiNotes}
            onChange={(e) => setAiNotes(e.target.value)}
            placeholder="z. B. gratis parken hinterm Schloss, Pistazien-Croissant, früh morgens fast leer …"
          />
          <div className="flex flex-wrap items-center gap-2">
            <AiButton
              loading={aiAction === "generate"}
              loadingLabel={aiWeb ? "✨ Recherchiere" : "✨ Erzeuge"}
              onClick={onGenerate}
              disabled={pending}
              className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              ✨ Deutsche Texte erzeugen
            </AiButton>
            <AiButton
              loading={aiAction === "translate"}
              loadingLabel="🌍 Übersetze alle"
              onClick={onTranslateAll}
              disabled={pending}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              🌍 In alle Sprachen übersetzen
            </AiButton>
            <label className="flex items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[#cc2924]"
                checked={aiWeb}
                onChange={(e) => setAiWeb(e.target.checked)}
              />
              🔎 Web-Recherche
            </label>
          </div>
          {trStale && (
            <p className="rounded-[10px] bg-accent/10 px-3 py-2 text-xs font-medium text-accent">
              ⚠ Deutsch wurde geändert – die Übersetzungen sind dadurch veraltet. Bitte „🌍 In alle
              Sprachen übersetzen“, damit alle Sprachen wieder gleich sind.
            </p>
          )}
          {(aiMsg || enMsg) && (
            <p className="text-xs text-muted">{aiMsg || enMsg}</p>
          )}
          <p className="text-xs text-muted">
            Ablauf: Deutsch erzeugen/prüfen → „In alle Sprachen übersetzen“ → Übersetzungen unten
            je Sprache prüfen. Übersetzungen sind optional (fehlende Sprache fällt öffentlich auf
            Deutsch zurück).
          </p>
        </div>

        {/* Deutsche Quelltexte */}
        {deField("Kurzbeschreibung (Karte)", "shortDesc", false)}
        {deField("Allgemeines", "general", true, 3)}
        {deField("Insider-Tipp", "insiderTip", true, 2)}
        {deField(isFood ? "Küche & Stil" : "Dauer & Schwierigkeit", "sectionA", true, 2)}
        {deField(isFood ? "Preisniveau (Text)" : "Beste Jahreszeit (Text)", "sectionB", true, 2)}
        {deField("Lage & Erreichbarkeit", "locationText", true, 2)}

        {/* Übersetzungen: Sprache wählen -> Felder prüfen/anpassen. Grün = befüllt. */}
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
          {trField("Titel", "title", false)}
          {trField("Kurzbeschreibung", "shortDesc", false)}
          {trField("Allgemeines", "general", true, 3)}
          {trField("Insider-Tipp", "insiderTip", true, 2)}
          {trField(isFood ? "Küche & Stil" : "Dauer & Schwierigkeit", "sectionA", true, 2)}
          {trField(isFood ? "Preisniveau (Text)" : "Beste Jahreszeit (Text)", "sectionB", true, 2)}
          {trField("Lage & Erreichbarkeit", "locationText", true, 2)}
        </div>
        <div>
          <label className={labelCls}>Empfehlender Local</label>
          <select className={input} value={form.localId} onChange={(e) => set({ localId: e.target.value })}>
            <option value="">—</option>
            {locals.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </section>

      {/* Erweitert (optional) – eingeklappt, damit das Formular schlank bleibt */}
      <details className="rounded-[16px] bg-white p-5 shadow-sm">
        <summary className="cursor-pointer select-none text-[15px] font-semibold text-ink">
          Erweitert (optional)
        </summary>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Telefon</label><input className={input} value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
          <div><label className={labelCls}>Website-URL</label><input className={input} value={form.websiteUrl} onChange={(e) => set({ websiteUrl: e.target.value })} /></div>
          <div><label className={labelCls}>Seename (Wassertemp.)</label><input className={input} value={form.lakeName} onChange={(e) => set({ lakeName: e.target.value })} placeholder="z. B. Fuschlsee" /></div>
          <div>
            <label className={labelCls}>Sortier-Gewicht</label>
            <input type="number" className={input} value={form.sortWeight} onChange={(e) => set({ sortWeight: Number(e.target.value) })} />
          </div>
        </div>
      </details>
    </form>
  );
}
