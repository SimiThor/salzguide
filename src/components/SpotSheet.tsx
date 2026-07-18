"use client";

import Image from "next/image";
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ExploreSpot } from "@/lib/spots";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";
import LockedMedia from "./LockedMedia";
import { useLoginGate } from "./auth/LoginGate";
import SheetGrabber from "./SheetGrabber";
import { useBodyDrag } from "./useBodyDrag";
import { useViewportHeight } from "@/lib/viewport";
import { NAV_H_VAR, readCssLength } from "@/lib/sheet-metrics";

// Dieselbe Bewegung wie beim Explore-Sheet (siehe MobileSheet / --sg-ease-sheet in
// globals.css): Apples Sheet-Kurve, 0.5s, ohne Überschwingen. Beide Sheets liegen
// übereinander – liefen sie unterschiedlich, fiele genau das auf.
const EASE_IOS: [number, number, number, number] = [0.32, 0.72, 0, 1];
const TRANSITION = { duration: 0.5, ease: EASE_IOS };
// Peek-Detent = Anteil der vh, den das Sheet unten abdeckt (halb: Bild sichtbar).
// Exportiert, damit die Explore-Karte den Spot GENAU über das Sheet einpasst
// (eine Quelle der Wahrheit -> bleibt synchron).
export const SPOT_SHEET_PEEK = 0.55;

// Die obere Stufe ist KEINE feste Zahl, sondern „so hoch wie der Inhalt".
//
// Vorher stand hier 0.92. Ein Spot hat aber selten 92vh Inhalt: Titel, ein kurzer Text,
// ein Knopf und ein 16:10-Bild sind auf einem iPhone 15 zusammen rund 560px. Aufgezogen
// blieben darunter also ~220px leere Creme-Fläche stehen, und das Bild klebte in der
// Mitte des Bildschirms. Apple lässt ein Sheet nie höher werden, als sein Inhalt braucht
// (Karten, Musik, Fotos-Info) – man zieht es hoch, es hält am Inhalt an, fertig.
//
// MAX bleibt trotzdem: Es begrenzt lange Inhalte (großer Schriftgrad, langer Text) und
// ist zugleich die Höhe des Sheet-Elements selbst (siehe sheetH unten).
const SPOT_SHEET_MAX = 0.92;
// Auf dem Server gibt es kein Layout, useLayoutEffect warnt dort. Auf dem Client MUSS es
// useLayoutEffect sein: die Höhe muss VOR dem ersten Paint stehen, sonst sieht man das
// Sheet einrasten.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function X() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Echtes ziehbares Spot-Bottom-Sheet (Apple Karten / Google Maps Stil):
// Peek/Halb/Voll, runterziehen schließt, kein Backdrop. Liegt über dem Explore-Sheet.
export default function SpotSheet({
  spot,
  onClose,
  onDismissStart,
  closing = false,
  loggedIn = false,
  saved = false,
  onSavedChange,
}: {
  spot: ExploreSpot;
  onClose: () => void;
  // Feuert, sobald das Sheet losfährt — nicht erst, wenn es unten ist. Daran hängt
  // die Karte ihre Route und den hervorgehobenen Pin ab, damit beide MIT dem Sheet
  // gehen und nicht 0.5s später wegschnappen.
  onDismissStart?: () => void;
  closing?: boolean;
  loggedIn?: boolean;
  saved?: boolean; // controlled durch Explore (Quelle der Wahrheit)
  onSavedChange?: (slug: string, saved: boolean) => void;
}) {
  const t = useTranslations("Explore");
  const locale = useLocale();
  const gate = useLoginGate();
  // Stabile Viewport-Höhe: Vorher window.innerHeight an einem resize-Listener – und
  // iOS feuert resize bei jedem Leisten-Zug. Siehe lib/viewport.ts.
  const vh = useViewportHeight();
  const y = useMotionValue(2000);
  const dragControls = useDragControls();
  const idxRef = useRef(0);
  // Schließen darf nur EINMAL anlaufen: ✕, Esc, Runterziehen und der Karten-Klick
  // greifen alle in dismiss(), und zwei parallele Animationen auf dasselbe y kämpfen.
  const dismissed = useRef(false);
  const [atFull, setAtFull] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyDrag = useBodyDrag(dragControls, bodyRef, atFull);
  // Bis zur ersten Messung gilt MAX. Das ist der ehrliche Rückfall („noch nichts
  // gemessen, also alles erlauben") und nicht bloß ein Platzhalter: Läge er zu niedrig,
  // ließe sich das Sheet für einen Wimpernschlag nicht weit genug aufziehen.
  const [fullDetent, setFullDetent] = useState(SPOT_SHEET_MAX);
  const [, startTransition] = useTransition();

  function onSave() {
    const next = !saved;
    // Optimistisch: Explore aktualisiert die Quelle der Wahrheit -> Icon flippt sofort.
    if (loggedIn) onSavedChange?.(spot.slug, next);
    startTransition(async () => {
      // gate.run prüft beide Login-Wege: vorher loggedIn, nachher needLogin (abgelaufene
      // Session). Ohne Konto öffnet sich das Gate, statt hart auf /profil zu springen.
      // next: Der offene Spot steht nur im Client-State der Explore-Karte, nie in der
      // URL – nach dem Login käme man sonst auf der nackten Karte raus.
      const r = await gate.run(
        { loggedIn, reason: "saveSpot", next: `/${locale}/spot/${spot.slug}` },
        () => toggleSaved(spot.slug),
      );
      if (r && typeof r.saved === "boolean" && r.saved !== next) {
        onSavedChange?.(spot.slug, r.saved);
      }
      // Nicht eingeloggt oder Session weg -> optimistischen Flip zurücknehmen.
      if (!r || r.needLogin) onSavedChange?.(spot.slug, saved);
    });
  }

  const base = vh || 800;
  // Das Sheet-ELEMENT ist immer MAX hoch, nur die Stufe, an der es anhält, folgt dem
  // Inhalt. Beides zu koppeln wäre eine Rückkopplung: Die Messung säße im Element,
  // dessen Höhe sie gerade bestimmt. So misst sie in einem Kasten, der sich nicht rührt.
  const sheetH = base * SPOT_SHEET_MAX;
  const snapY = (d: number) => (SPOT_SHEET_MAX - d) * base;
  const closedY = sheetH;
  const detents = [SPOT_SHEET_PEEK, fullDetent];
  const fullY = snapY(fullDetent);

  // Misst, wie hoch das Sheet sein müsste, damit alles ganz drinsteht, und macht daraus
  // die obere Stufe. Gemessen statt gerechnet, weil sich der Inhalt nicht in Pixel
  // schreiben lässt: Der Kurztext bricht je nach Sprache auf ein bis vier Zeilen um, das
  // Bild ist 16:10 der Bildschirmbreite, und wer im System größere Schrift eingestellt
  // hat, bekommt mit jeder festen Zahl irgendwann wieder eine leere Fläche oder eine
  // Kante mitten im Text.
  const measure = useCallback(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!body || !content || !base) return;
    // offsetTop des Körpers = Höhe des Griffstreifens darüber (das Sheet ist fixed und
    // damit offsetParent). offsetHeight des Inhalts schließt seine Polsterung unten mit
    // ein – genau der Weißraum, der unter dem Bild stehen bleiben soll.
    //
    // Die Tab-Leiste zählt mit: Sie liegt ÜBER dem Sheet und deckt dessen unterste ~72px
    // zu. Ohne sie stimmte die Rechnung auf dem Papier und das Bild wäre trotzdem von
    // "Entdecken/KI/Gespeichert/Profil" angeschnitten – am Viewport nachgemessen, genau
    // so ist es passiert. Dieselbe Korrektur wie bei den Stufen im MobileSheet.
    const needed =
      body.offsetTop + content.offsetHeight + readCssLength(NAV_H_VAR, body);
    // Nie unter den Peek (sonst stünden die Stufen verkehrt herum) und nie über MAX.
    const next = Math.min(SPOT_SHEET_MAX, Math.max(SPOT_SHEET_PEEK, needed / base));
    setFullDetent((cur) => (Math.abs(cur - next) < 0.005 ? cur : next));
  }, [base]);

  // Der Inhalt wächst noch nach dem ersten Paint: Schriften tauschen, `line-clamp` greift
  // erst mit der echten Schrift, und ein fehlendes Bild fällt auf den Emoji-Kasten
  // zurück. Ein ResizeObserver nimmt all das mit, ohne dass jede Quelle einzeln Bescheid
  // geben muss.
  useIsoLayoutEffect(() => {
    measure();
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [measure, spot.slug]);

  // Steht das Sheet schon oben und der Inhalt ändert sich, wandert die Stufe unter ihm
  // weg. Nachziehen ohne Animation: Das ist eine Korrektur, keine Bewegung, die jemand
  // ausgelöst hat.
  useEffect(() => {
    if (idxRef.current === detents.length - 1) y.jump(fullY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullY]);

  // Beim Öffnen / Spot-Wechsel auf Peek einfahren. Das ist die EINE gewollte Animation
  // dieses Sheets: Es kommt auf Tippen hin von unten herein.
  // Absichtlich an `measured` statt an `vh`: sonst liefe sie bei jeder Höhenänderung
  // erneut und das aufgezogene Sheet klappte mitten im Lesen auf Peek zurück. Seit die
  // Höhe aus useViewportHeight() kommt, ändert sie sich nur noch bei Drehung – der
  // Riegel bleibt trotzdem, denn auch eine Drehung darf das Sheet nicht zuklappen.
  const measured = vh > 0;
  useEffect(() => {
    if (!measured) return;
    idxRef.current = 0;
    // Bewusste Ausnahme von set-state-in-effect: Das hier IST der imperative Ablauf
    // "neues Sheet fährt herein" — Stufe, Scroll-Zustand und Schließ-Riegel zurücksetzen
    // und dann animieren. atFull ist echter Zustand (der Drag setzt ihn weiter unten),
    // also nicht ableitbar. Die zweite Render-Runde kostet hier nichts, ein Umbau würde
    // dagegen die fein abgestimmte Öffnen-Animation gefährden.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAtFull(false);
    // Ein neuer Spot ist ein neues Sheet: Der Schließ-Riegel muss auf, sonst ließe
    // sich ein Sheet, das man mitten im Rausfahren durch einen Marker-Tipp wieder
    // hochgeholt hat, nie mehr schließen.
    dismissed.current = false;
    animate(y, snapY(SPOT_SHEET_PEEK), TRANSITION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.slug, measured]);

  // resize/Drehung: nur neu rechnen, nie animieren und nie die Stufe zurücksetzen.
  const settled = useRef(false);
  useEffect(() => {
    if (!vh) return;
    if (!settled.current) {
      settled.current = true; // erster Messwert -> gehört der Öffnen-Animation oben
      return;
    }
    y.jump(snapY(detents[idxRef.current]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vh]);

  function dismiss() {
    if (dismissed.current) return;
    dismissed.current = true;
    onDismissStart?.();
    animate(y, closedY, TRANSITION).then(() => onClose());
  }

  // Esc schließt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Klick neben das Sheet (Karte) -> gleiche Schließ-Animation wie das ✕
  useEffect(() => {
    if (closing) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  function snapToIndex(i: number) {
    const c = Math.max(0, Math.min(detents.length - 1, i));
    idxRef.current = c;
    setAtFull(c === detents.length - 1);
    animate(y, snapY(detents[c]), TRANSITION);
  }
  function handleDragEnd(_e: unknown, info: PanInfo) {
    const cur = y.get();
    const points = detents.map(snapY);
    const lowest = Math.max(...points);
    if (cur > lowest + 80 || info.velocity.y > 900) {
      dismiss();
      return;
    }
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      if (Math.abs(points[i] - cur) < Math.abs(points[best] - cur)) best = i;
    }
    if (info.velocity.y < -400 && best < detents.length - 1) best++;
    if (info.velocity.y > 400 && best > 0) best--;
    snapToIndex(best);
  }
  function onGrabberTap() {
    snapToIndex(idxRef.current + 1); // snapToIndex klemmt oben, bleibt also auf Voll stehen
  }

  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-ink";

  return (
    <motion.div
      data-sg="spot-sheet"
      style={{ y, height: sheetH }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      // Oben endet der Zug an der Inhaltsstufe, nicht an der Elementkante: Weiter
      // hochziehen würde nur leere Fläche aufdecken. dragElastic lässt es dabei kurz
      // nachgeben und zurückfedern – das gummiartige Anschlagen, das iOS am obersten
      // Detent macht.
      dragConstraints={{ top: fullY, bottom: closedY }}
      dragElastic={0.06}
      onDragEnd={handleDragEnd}
      className="fixed inset-x-0 bottom-0 z-[55] flex w-full flex-col rounded-t-[22px] bg-cream shadow-[0_-10px_44px_-12px_rgba(0,0,0,0.4)]"
    >
      <SheetGrabber dragControls={dragControls} onTap={onGrabberTap} className="py-3" />

      <div
        ref={bodyRef}
        {...bodyDrag}
        style={{ touchAction: atFull ? "auto" : "pan-x" }}
        className={`flex-1 overscroll-contain px-5 ${
          atFull ? "overflow-y-auto" : "overflow-y-hidden"
        }`}
      >
        {/* Der gemessene Kasten. Die Polsterung unten sitzt HIER und nicht am scrollenden
            Körper darüber: Sie ist der Weißraum unter dem Bild, und offsetHeight zählt
            sie nur mit, wenn sie am gemessenen Element hängt. Sie ist damit die eine
            Stellschraube für die Luft unten – wer sie ändert, verschiebt zugleich die
            obere Stufe, ohne dass irgendwo eine zweite Zahl nachgezogen werden muss.
            2.5rem statt 2rem, weil ohne Home-Indicator (iPhone SE) sonst nur 32px
            Weißraum unter dem Bild stünden und die Kante wie abgeschnitten wirkte. */}
        <div ref={contentRef} className="pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
          <div className="flex items-start justify-between gap-3">
            {/* Gesperrt: "🤫 Geheimtipp" ist der EINZIGE Sperr-Hinweis. Das Bild trägt
                deshalb kein Abzeichen mehr – sonst stünde dasselbe Wort doppelt da. */}
            <h2 className="text-2xl font-bold leading-tight text-ink">
              {spot.locked ? t("lockedLabel") : spot.title}
            </h2>
            <div className="flex shrink-0 gap-2">
              {!spot.locked && (
                <button
                  type="button"
                  onClick={onSave}
                  aria-label={t("save")}
                  aria-pressed={saved}
                  className={btn}
                >
                  {saved ? (
                    <BookmarkFilled className="h-[17px] w-[17px] text-accent" />
                  ) : (
                    <Bookmark className="h-[17px] w-[17px]" />
                  )}
                </button>
              )}
              <button type="button" onClick={dismiss} aria-label={t("close")} className={btn}>
                <X />
              </button>
            </div>
          </div>

          {spot.locked ? (
            // Conversion-Reihenfolge: Motiv (macht Lust) -> ein Satz warum -> Button.
            // ALLES muss in den Peek passen, sonst sieht man am iPhone das Foto, aber
            // nicht den Button – und weiß nicht, wie man freischaltet.
            //
            // Das Sheet ist 92vh hoch, zeigt am Peek aber nur SPOT_SHEET_PEEK (55vh);
            // sein unteres Ende liegt außerhalb des Bildschirms. Ein am Sheet-Boden
            // klebender Button (sticky) wäre also unsichtbar – die Höhe muss stimmen.
            //
            // Deshalb vh-relativ statt fester Pixel: Auf kleinen Geräten (iPhone SE)
            // schrumpft das Foto mit, statt den Button hinauszuschieben. Rechnung für
            // den engsten Fall (667px hoch): 55vh Peek ≈ 367px, minus Griff ≈ 337px
            // nutzbar; Inhalt ≈ 32 (Titel) + 160 (Foto) + 40 (Teaser) + 46 (Button)
            // + 36 (Abstände) ≈ 314px. Passt mit Reserve.
            // Apple-Reihenfolge (App Store / TV+): Motiv, dann die Aktion, dann Details.
            // Der Button steht klar unter dem Bild – nichts liegt übereinander.
            //
            // Er MUSS im Peek sichtbar sein, sonst sieht man am iPhone nur das Foto und
            // weiß nicht, wie man kauft. Das Sheet ist 92vh hoch, sichtbar sind aber nur
            // SPOT_SHEET_PEEK (55vh) minus Tab-Leiste. Deshalb ist die Bildhöhe vh-relativ:
            // Auf kleinen Geräten schrumpft das Foto, statt den Button hinauszudrücken.
            // Gemessen (Chrome DevTools Protocol, echtes Viewport): iPhone SE 375x667 und
            // iPhone 15 390x844 -> Button in beiden Fällen über der Tab-Leiste.
            <>
              <LockedMedia
                previewUrl={spot.previewUrl}
                emoji={spot.emoji}
                eager
                className="mt-3 h-[20svh] max-h-[220px] min-h-[120px] w-full rounded-[16px]"
              />
              <Link
                href="/pro"
                className="mt-3 block rounded-full bg-accent px-5 py-3 text-center text-[15px] font-semibold text-white active:scale-[0.98]"
              >
                {t("unlock")}
              </Link>
              {/* Erklärender Nachsatz. Steht bewusst NACH dem Button: Er darf am Peek
                  angeschnitten sein, die Kernbotschaft (Motiv + Aktion) steht schon oben. */}
              <p className="mt-3 line-clamp-2 text-[14px] leading-snug text-muted">
                {t("proTeaser")}
              </p>
            </>
          ) : (
            <>
              {spot.shortDesc && (
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
                  {spot.shortDesc}
                </p>
              )}
              <Link
                href={`/spot/${spot.slug}`}
                className="mt-4 inline-block rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white active:scale-[0.98]"
              >
                {t("more")}
              </Link>

              {/* Bild (sichtbar beim Hochziehen) */}
              <div className="mt-5">
                {spot.imageUrl ? (
                  <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[16px]">
                    <Image
                      src={spot.imageUrl}
                      alt={spot.title}
                      fill
                      sizes="(min-width: 768px) 27rem, 100vw"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[16px] bg-gradient-to-br from-accent/20 to-muted/20">
                    <span className="text-6xl" aria-hidden>
                      {spot.emoji ?? "📍"}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {/* Nur für den gedeckelten Fall: Ist der Inhalt höher als MAX, endet das Sheet
            nicht mehr am Inhalt, und seine untersten ~72px liegen hinter der Tab-Leiste.
            Ohne diesen Streifen ließe sich der letzte Absatz nicht darüber hinausscrollen
            – er stünde dauerhaft hinter "Entdecken/KI/Gespeichert/Profil".

            Bewusst ein eigenes Element NEBEN dem gemessenen Kasten und nicht dessen
            Polsterung: Die Leiste steckt schon in der Messung (siehe measure). Läge sie
            auch im Kasten, zählte sie doppelt und die Stufe stünde 72px zu hoch. Passt
            der Inhalt ohnehin, kostet der Streifen nichts – dann wird gar nicht
            gescrollt. */}
        <div className="h-[var(--sg-nav-h)] shrink-0" aria-hidden />
      </div>
    </motion.div>
  );
}
