"use client";

import mapboxgl from "mapbox-gl";
import { bcp47 } from "@/i18n/locales";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import BottomSheet from "./BottomSheet";
import { MapLoadingScreen, useMapLoading } from "./MapLoading";
import MobileSheet from "./MobileSheet";
import { SHEET_PEEK_VAR, readCssLength } from "@/lib/sheet-metrics";
import { useViewportHeight } from "@/lib/viewport";
import { useLatestRef } from "@/lib/use-latest-ref";
import { RecenterControl } from "./mapControls";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const BLUE = "#2f8fce"; // eine ruhige Akzentfarbe (Wasser), sonst ink/muted

// Im Ruhezustand müssen Titel und Untertitel vollständig dastehen. Vorher galt hier der
// globale Peek aus globals.css, und dessen 86px sind für die Explore-Karte gerechnet
// (Griff + Saison-Umschalter) – der Kopf dieser Seite ist höher, also lief die Kante
// mitten durch den Text. Der Wert ist die Schätzung fürs Server-HTML:
// Griff 26 + pt-1 4 + Titel 32 + mt-1 4 + zwei Zeilen Untertitel 46 + 16 Luft.
const SHEET_PEEK = { fits: '[data-sg="water-peek"]', fallback: "calc(128px + var(--sg-nav-h))" };

// Temperatur einheitlich formatieren (eine Nachkommastelle, lokalisiert). Bewusst auf
// Modulebene: so hängt der Marker-Effekt unten nur an der Sprache (ein String) statt an
// einer Funktion, die bei jedem Render neu entstünde und alle Marker neu setzen würde.
const formatTemp = (v: number, loc: string) =>
  v.toLocaleString(loc, { maximumFractionDigits: 1 });

export type LakeSpot = {
  slug: string;
  title: string;
  emoji: string | null;
  image: string | null;
};

export type LakeTemp = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  tempC: number | null;
  at: string | null;
  source: "salzburg" | "ages" | null;
  spots: LakeSpot[];
};

type Labels = {
  title: string;
  subtitle: string;
  noData: string;
  asOf: string;
  salzburg: string;
  ages: string;
  attribution: string;
};

// Apple-Disclosure-Chevron (SVG statt "›"-Glyph): schlank, sauber zentriert,
// unabhängig von Font-Metriken – wird in Liste & Spot-Zeilen wiederverwendet.
function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="7"
      height="13"
      viewBox="0 0 7 13"
      fill="none"
      aria-hidden
    >
      <path
        d="M1 1l5 5.5L1 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Vollbild-Karten-Erlebnis wie die Startseite (Explore): Karte + Left-Sidebar
// (Desktop) / ziehbares Bottom-Sheet (Mobile) mit der Seenliste; Tippen auf einen
// See fokussiert die Karte und öffnet ein Sheet mit Temperatur + Spots am See.
export default function WaterExplore({
  lakes,
  locale,
  labels,
}: {
  lakes: LakeTemp[];
  locale: string;
  labels: Labels;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const { bindMap, loading } = useMapLoading();
  const [isDesktop, setIsDesktop] = useState(false);
  // Stabile Viewport-Höhe fürs Karten-Padding (siehe lib/viewport.ts).
  const vh = useViewportHeight();
  const [selected, setSelected] = useState<string | null>(null);

  const t = useTranslations("Water");
  const loc = bcp47(locale);
  const dfmt = new Intl.DateTimeFormat(loc, { day: "numeric", month: "long" });
  const fmt = (v: number) => formatTemp(v, loc);

  // Alle Seen einpassen (fitBounds) – wie die Startseiten-Karte. Die Ref hält immer die
  // neueste Fassung, liest also die aktuellen Seen/Layout-Werte (kein veralteter Closure)
  // und versorgt sowohl den "Zentrieren"-Button als auch das automatische Einpassen beim
  // ersten Laden. Siehe use-latest-ref.ts.
  const fitRef = useLatestRef((duration: number) => {
    const map = mapRef.current;
    if (!map) return;
    const valid = lakes.filter((l) => l.lat != null && l.lng != null);
    if (valid.length === 0) return;
    const b = new mapboxgl.LngLatBounds();
    valid.forEach((l) => b.extend([l.lng, l.lat]));
    // Padding: Desktop rundum Luft; Mobile unten Platz fürs Peek-Sheet (die Tab-Leiste
    // steckt in --sg-sheet-peek schon drin), damit kein Marker verdeckt wird – analog
    // zur Explore-Karte, aus derselben CSS-Variable gelesen.
    const pad = isDesktop
      ? { top: 70, right: 70, bottom: 70, left: 70 }
      : {
          top: 120,
          right: 40,
          bottom: Math.round(readCssLength(SHEET_PEEK_VAR)) + 24,
          left: 40,
        };
    map.fitBounds(b, { padding: pad, maxZoom: 12, duration });
  });

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const u = () => setIsDesktop(mq.matches);
    u();
    mq.addEventListener("change", u);
    return () => mq.removeEventListener("change", u);
  }, []);

  // Karte einmal aufbauen
  useEffect(() => {
    if (!TOKEN || !mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [13.25, 47.72],
      zoom: 7.6,
      // Immer flache 2D-Ansicht — keine 3D-Neigung (Pitch), wie die Startseiten-Karte.
      pitch: 0,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
      // Attribution kompakt, wie auf allen anderen Karten (Begründung in SpotMap):
      // Mapbox entschiede das sonst je nach Kartenbreite selbst, und diese Karte ist
      // breiter als die übrigen — genau deshalb stand hier als einziger der
      // ausgeschriebene Text, während der Rest den „i"-Knopf zeigte.
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    // Gleiche Karten-Tools wie die Startseite: Zoom, Zentrieren (alle Seen einpassen),
    // Standort (blauer Punkt / Heading).
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new RecenterControl(() => fitRef.current(600)), "top-right");
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      "top-right",
    );
    // Beim ersten Laden automatisch auf alle Seen einpassen (kein fixer Ausschnitt).
    map.on("load", () => fitRef.current(0));
    map.on("click", () => setSelected(null));
    // Ladeschirm über der Karte, bis das erste fertige Kartenbild steht (siehe MapLoading).
    const unbindLoading = bindMap(map);
    mapRef.current = map;
    return () => {
      unbindLoading();
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
    // Die Karte wird GENAU EINMAL aufgebaut. bindMap und fitRef sind identitaetsstabil
    // -> der Effekt laeuft trotz der Liste weiterhin nur beim Einhaengen.
  }, [bindMap, fitRef]);

  // Marker (Temperatur-Badge, eine Farbe)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};
    lakes.forEach((l) => {
      const el = document.createElement("div");
      el.textContent = l.tempC != null ? `${formatTemp(l.tempC, loc)}°` : "–";
      el.style.cssText =
        "display:flex;align-items:center;justify-content:center;min-width:36px;height:27px;padding:0 8px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.3);font:700 12px system-ui;color:#fff;cursor:pointer;transition:box-shadow .15s;background:" +
        (l.tempC != null ? BLUE : "#9aa0a6");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(l.slug);
      });
      markersRef.current[l.slug] = new mapboxgl.Marker({ element: el })
        .setLngLat([l.lng, l.lat])
        .addTo(map);
    });
  }, [lakes, loc]);

  // Auswahl -> Karte fokussieren + Marker hervorheben
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.entries(markersRef.current).forEach(([slug, m]) => {
      const on = slug === selected;
      m.getElement().style.boxShadow = on
        ? "0 0 0 3px rgba(255,255,255,.95),0 3px 12px rgba(0,0,0,.4)"
        : "0 1px 5px rgba(0,0,0,.3)";
      m.getElement().style.zIndex = on ? "5" : "1";
    });
    if (!selected) return;
    const l = lakes.find((x) => x.slug === selected);
    if (!l) return;
    map.flyTo({
      center: [l.lng, l.lat],
      zoom: Math.max(map.getZoom(), 11),
      duration: 650,
      padding: isDesktop
        ? { top: 30, bottom: 30, left: 30, right: 30 }
        : { top: 40, bottom: Math.round((vh || 800) * 0.45), left: 20, right: 20 },
    });
  }, [selected, lakes, isDesktop, vh]);

  useEffect(() => {
    mapRef.current?.resize();
  }, [isDesktop]);

  const ordered = [
    ...lakes.filter((l) => l.tempC != null).sort((a, b) => b.tempC! - a.tempC!),
    ...lakes.filter((l) => l.tempC == null),
  ];
  const selectedLake = lakes.find((l) => l.slug === selected) ?? null;

  const list = (
    <div className="px-4">
      {/* Kopf = der Ruhezustand des Sheets. Der Peek misst sich an diesem Anker
          (SHEET_PEEK oben), damit die Kante unter dem Untertitel liegt und nicht
          mittendrin. Gemessen statt gerechnet, weil der Untertitel je nach Sprache,
          Gerätebreite und eingestellter Schriftgröße auf zwei oder drei Zeilen umbricht. */}
      <div className="mb-4" data-sg="water-peek">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{labels.title}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{labels.subtitle}</p>
      </div>
      {ordered.length === 0 ? (
        <div className="rounded-[18px] bg-white p-5 text-center text-[14px] text-muted shadow-sm">
          {labels.noData}
        </div>
      ) : (
      <div className="divide-y divide-black/[0.06] overflow-hidden rounded-[18px] bg-white shadow-sm">
        {ordered.map((l) => (
          <button
            key={l.slug}
            type="button"
            onClick={() => setSelected(l.slug)}
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition ${
              selected === l.slug ? "bg-black/[0.03]" : "active:bg-black/[0.02] md:hover:bg-black/[0.02]"
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
              {l.name}
            </span>
            {/* Temperatur-Spalte: rechtsbündig + feste Breite -> alle Zahlen bündig
                untereinander. Das Datum ("Stand") steht nur in der Detailansicht. */}
            <span className="flex w-[52px] shrink-0 justify-end tabular-nums">
              {l.tempC != null ? (
                <span className="text-[17px] font-semibold" style={{ color: BLUE }}>
                  {fmt(l.tempC)}°
                </span>
              ) : (
                <span className="text-[17px] font-semibold text-muted/50">–</span>
              )}
            </span>
            {/* Chevron-Slot mit fester Breite auf jeder Zeile -> Spalte bleibt bündig. */}
            <span className="flex w-2 shrink-0 justify-end">
              {l.spots.length > 0 && <Chevron className="text-muted/40" />}
            </span>
          </button>
        ))}
      </div>
      )}
      <p className="mt-4 text-[11px] leading-snug text-muted">{labels.attribution}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-0 md:top-[var(--sg-header-h)]">
      {/* --sg-map-bottom: hebt Mapbox-Logo und -Attribution über das Peek-Sheet mit der
          Seenliste – dieselbe Mechanik wie auf der Startseite (Lizenzpflicht, siehe
          globals.css). Das Sheet liegt hier dauerhaft im Peek an, nicht erst bei der
          Auswahl eines Sees – das ist das separate Detail-Sheet. */}
      <div
        className="absolute inset-0 md:left-[var(--sg-panel-water)]"
        style={{ "--sg-map-bottom": `calc(var(${SHEET_PEEK_VAR}) + 10px)` } as React.CSSProperties}
      >
        {TOKEN ? (
          <div className="relative isolate h-full w-full">
            <div ref={mapEl} className="h-full w-full" />
            <MapLoadingScreen {...loading} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Karte nicht verfügbar (Mapbox-Token fehlt).
          </div>
        )}
      </div>

      {/* CSS entscheidet, nicht ein State nach der Hydration – siehe TourView/Explore.
          Vorher zeigte der PC hier für 258ms die Handy-Ansicht in voller Breite. */}
      <aside className="absolute inset-y-0 left-0 z-10 hidden w-[var(--sg-panel-water)] overflow-y-auto border-r border-black/5 bg-cream/95 py-6 backdrop-blur-xl md:block">
        {list}
      </aside>
      <div className="contents md:hidden">
        <MobileSheet hide={selected != null} peek={SHEET_PEEK}>
          {list}
        </MobileSheet>
      </div>

      {/* Preview: Temperatur + Spots am See – wie auf der Startseite ohne Backdrop
          (Karte bleibt scharf): mobil ziehbares Sheet, Desktop schwebende Karte. */}
      <BottomSheet
        open={selectedLake != null}
        onClose={() => setSelected(null)}
        title={selectedLake?.name}
        detents={[0.42, 0.9]}
        variant="floating"
      >
        {selectedLake && (
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-[34px] font-bold leading-none" style={{ color: BLUE }}>
                {selectedLake.tempC != null ? `${fmt(selectedLake.tempC)} °C` : "–"}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-muted">
              {selectedLake.tempC != null && selectedLake.at
                ? `${labels.asOf} ${dfmt.format(new Date(selectedLake.at))} · ${
                    selectedLake.source === "salzburg" ? labels.salzburg : labels.ages
                  }`
                : labels.noData}
            </p>

            {selectedLake.spots.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  {t("spotsHere", { count: selectedLake.spots.length })}
                </p>
                <div className="space-y-1.5">
                  {selectedLake.spots.map((sp) => (
                    <Link
                      key={sp.slug}
                      href={`/spot/${sp.slug}`}
                      className="flex items-center gap-3 rounded-[14px] bg-white py-2 pl-2 pr-4 shadow-sm transition active:scale-[0.99] md:hover:bg-black/[0.02]"
                    >
                      {sp.image ? (
                        <span
                          className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[12px]"
                          aria-hidden
                        >
                          <Image src={sp.image} alt="" fill sizes="48px" quality={50} className="object-cover" />
                        </span>
                      ) : (
                        <span
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-black/5 text-xl"
                          aria-hidden
                        >
                          {sp.emoji ?? "📍"}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
                        {sp.title}
                      </span>
                      <Chevron className="shrink-0 text-muted/40" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
