"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import BottomSheet from "./BottomSheet";
import StoryPhotoPanel from "./StoryPhotoPanel";
import StoryVideoPanel from "./StoryVideoPanel";
import { drawRouteHero } from "@/lib/story-canvas";
import { BTN_PRIMARY } from "@/lib/ui";

type Mode = "photo" | "video";

// Peek zeigt nur den Auswahl-Zustand (Umschalter + Wählen-Fläche), Voll den Editor. Das Sheet
// öffnet im Peek und fährt automatisch auf Voll, sobald ein Foto/Clip gewählt ist (snapIndex).
// Gleiche Peek+Voll-Logik wie die anderen Content-Sheets der App (z.B. WaterExplore).
// Peek etwas höher (0.56), weil die mobile Tab-Leiste unten (~72px) die untersten Pixel des
// Sheets überdeckt: so bleibt unter der Wählen-Fläche genug Weißraum bis zur Leiste.
const SHEET_DETENTS = [0.56, 0.95];

// Was ein Panel dem Sheet über seinen Zustand meldet.
export type StoryPanelUi = {
  expanded: boolean; // Editor sichtbar -> Sheet auf Voll
  busy: boolean; // läuft gerade Verarbeitung/Export -> Umschalten sperren (sonst Abbruch)
};

// Story-Maker: eine Section auf der Spot-Seite mit zwei Wegen, die eigene Wanderung zu teilen.
// - Foto-Story (Strava-Look): eigenes Foto + echter Routenverlauf drüber. Auf JEDER Wanderung
//   mit Route.
// - Video-Story: eigener Clip an die vorgerenderte Wander-Animation. Nur wo ein Intro-Video da
//   ist (introUrl). Beides läuft komplett im Browser, nichts verlässt das Gerät.
// Section + Sheet + Umschalter leben hier; die eigentliche Arbeit in StoryPhotoPanel /
// StoryVideoPanel.
export default function StoryMaker({
  slug,
  route,
  stats,
  introUrl,
  introPosterUrl,
}: {
  slug: string;
  route: [number, number][];
  stats: { label: string; value: string }[];
  introUrl?: string | null;
  introPosterUrl?: string | null;
}) {
  const t = useTranslations("Detail.storyMaker");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("photo");
  // Vom aktiven Panel gemeldet: expanded (Editor -> Voll) und busy (Verarbeitung -> Umschalten sperren).
  const [ui, setUi] = useState<StoryPanelUi>({ expanded: false, busy: false });
  const bgRef = useRef<HTMLVideoElement>(null);
  const heroRef = useRef<HTMLCanvasElement>(null);

  // Stabiler Callback: das jeweils gemountete Panel meldet hierüber seinen Zustand.
  const onPanelUi = useCallback((s: StoryPanelUi) => setUi(s), []);

  // Sheet öffnen/schliessen; beim Öffnen im gewünschten Modus und im Peek starten.
  const openSheet = (m: Mode) => {
    setMode(m);
    setUi({ expanded: false, busy: false });
    setOpen(true);
  };
  // Modus wechseln (nur erlaubt, wenn nicht busy). Neues Panel startet im Auswahl-Zustand -> Peek.
  const switchMode = (m: Mode) => {
    if (ui.busy || m === mode) return;
    setUi({ expanded: false, busy: false });
    setMode(m);
  };

  // Intro-Hintergrundvideo nur abspielen, wenn die Section im Bild ist (Daten/Akku sparen).
  useEffect(() => {
    const v = bgRef.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  // Ohne Intro-Video: die Route als dekorative Grafik in den Hero zeichnen (sonst wäre die
  // Section eine leere dunkle Fläche). Backing-Store an CSS-Größe × DPR, neu bei Resize.
  useEffect(() => {
    if (introUrl) return;
    const c = heroRef.current;
    if (!c) return;
    const draw = () => {
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext("2d");
      if (ctx) drawRouteHero(ctx, c.width, c.height, route);
    };
    draw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    ro?.observe(c);
    return () => ro?.disconnect();
  }, [introUrl, route]);

  const seg = (on: boolean) =>
    `sg-native-tap whitespace-nowrap rounded-full px-5 py-1.5 leading-5 transition-colors active:opacity-70 ${
      on ? "bg-white text-ink shadow-sm" : "text-muted"
    }`;

  const showVideo = mode === "video" && !!introUrl;

  return (
    <>
      {/* Section im iOS-Stil. Mit Intro läuft das Video als Hintergrund; ohne Intro ein
          ruhiger dunkelgrüner Verlauf. Darüber ein Verlauf, kurzer Text und die CTA.
          Ist das Sheet offen, blenden wir die (dunkle) Section aus: sonst scheint sie hinter
          dem hellen Modal-Backdrop als dunkler Kasten durch (ein Schwarz-Scrim kann Schwarz
          nicht verdecken). So bleibt hinter dem Popup nur der helle, unscharfe Seiteninhalt. */}
      <section
        aria-hidden={open}
        // 16/10 statt 4/3: etwas flacher, damit der 9:16-Intro-Titel (Text sitzt bei ~1/4)
        // sauber oben WEGGESCHNITTEN wird und in der Vorschau kein On-Screen-Text mehr auftaucht.
        // Der Zuschnitt zentriert vertikal (object-cover), der obere Rand liegt so bei ~32 %,
        // klar unter der Wortmarke (~29 %). Eine Quelle -> gilt einheitlich für alle Spot-Seiten.
        className={`relative aspect-[16/10] overflow-hidden rounded-[22px] bg-gradient-to-b from-[#243b57] via-[#20263f] to-[#12131e] shadow-sm ring-1 ring-black/5 transition-opacity duration-300 ${
          open ? "opacity-0" : "opacity-100"
        }`}
      >
        {introUrl ? (
          <video
            ref={bgRef}
            src={introUrl}
            poster={introPosterUrl ?? undefined}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // Kein Video -> Route als Grafik (füllt den sonst leeren dunklen Hero).
          <canvas ref={heroRef} aria-hidden className="absolute inset-0 h-full w-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 pt-12">
          <h2 className="text-[19px] font-bold leading-tight text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.55)]">
            📸 {t("sectionTitle")}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-white/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]">
            {t("sectionSub")}
          </p>
          <button
            className={`${BTN_PRIMARY} mt-3 w-full active:scale-[0.98]`}
            onClick={() => openSheet("photo")}
          >
            {t("button")}
          </button>
        </div>
      </section>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("title")}
        detents={SHEET_DETENTS}
        initialDetent={0}
        snapIndex={ui.expanded ? 1 : 0}
      >
        {/* Kein eigenes px hier: das BottomSheet gibt den Rand (px-5) schon vor. Unten so viel
            Weißraum, dass Inhalt (Wählen-Fläche / Teilen+Speichern) NIE hinter der mobilen
            Tab-Leiste (--sg-nav-h) klebt oder verschwindet. Einheitlicher Abstand nach unten. */}
        <div className="pb-[calc(env(safe-area-inset-bottom)+var(--sg-nav-h)+0.75rem)]">
          {/* Umschalter nur, wenn es beide Wege gibt (Intro-Video vorhanden). Während der
              Verarbeitung (busy) gesperrt: ein Moduswechsel würde das laufende Panel aushängen
              und Upload/Export abbrechen. */}
          {introUrl && (
            <div
              className={`mb-4 flex justify-center transition-opacity ${ui.busy ? "opacity-40" : ""}`}
            >
              <div className="inline-flex rounded-full bg-black/5 p-1 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => switchMode("photo")}
                  disabled={ui.busy}
                  aria-pressed={mode === "photo"}
                  className={seg(mode === "photo")}
                >
                  {t("tabPhoto")}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("video")}
                  disabled={ui.busy}
                  aria-pressed={mode === "video"}
                  className={seg(mode === "video")}
                >
                  {t("tabVideo")}
                </button>
              </div>
            </div>
          )}

          {showVideo ? (
            <StoryVideoPanel introUrl={introUrl!} slug={slug} onUiChange={onPanelUi} />
          ) : (
            <StoryPhotoPanel slug={slug} route={route} stats={stats} onUiChange={onPanelUi} />
          )}
        </div>
      </BottomSheet>
    </>
  );
}
