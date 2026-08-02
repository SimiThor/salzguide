"use client";

import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "framer-motion";
import { useEffect, useRef, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { SpotCardData } from "@/lib/spots";
import { toggleSaved } from "@/lib/saved-actions";
import { Bookmark, BookmarkFilled } from "./icons";
import LockedMedia from "./LockedMedia";
import SmoothImage from "./SmoothImage";
import { useLoginGate } from "./auth/LoginGate";
import SheetGrabber from "./SheetGrabber";
import { useBodyDrag } from "./useBodyDrag";
import { useViewportHeight } from "@/lib/viewport";

// Dieselbe Bewegung wie beim Explore-Sheet (siehe MobileSheet / --sg-ease-sheet in
// globals.css): Apples Sheet-Kurve, 0.5s, ohne Überschwingen. Beide Sheets liegen
// übereinander – liefen sie unterschiedlich, fiele genau das auf.
const EASE_IOS: [number, number, number, number] = [0.32, 0.72, 0, 1];
const TRANSITION = { duration: 0.5, ease: EASE_IOS };
// Peek-Detent = Anteil der vh, den das Sheet unten abdeckt (halb: Bild sichtbar).
// Exportiert, damit die Explore-Karte den Spot GENAU über das Sheet einpasst
// (eine Quelle der Wahrheit -> bleibt synchron).
export const SPOT_SHEET_PEEK = 0.55;

// EINE Stufe, keine zweite.
//
// Vorher hatte das Sheet über dem Peek eine zweite, am Inhalt gemessene Stufe: Das Bild
// lief unten aus dem Bild heraus, und man musste das Sheet hochziehen, um es ganz zu
// sehen. Zwei Bewegungen für eine Vorschau, und bis man gezogen hat, sieht man ein
// angeschnittenes Foto. Jetzt passt die ganze Karte in die Ruheposition (siehe
// PEEK_CONTENT_MAX), also gibt es nichts mehr aufzuziehen: runterziehen schließt, mehr
// kann das Sheet nicht. Wer mehr will, tippt "Mehr ansehen" und ist auf der Detailseite.
//
// SPOT_SHEET_MAX ist deshalb nur noch die Höhe des Sheet-ELEMENTS: die Creme-Fläche muss
// unter der Ruheposition weiterlaufen, damit beim Runterziehen (dragElastic) keine Karte
// unter dem Sheet durchblitzt.
const SPOT_SHEET_MAX = 0.92;
// Höhe des Griffstreifens über dem Inhalt: py-3 (12+12) plus 6px Balken. Eine Konstante
// dieses Sheets, keine Messung wert – dieselbe Rechnung wie beim Explore-Sheet, das seine
// 26px in globals.css einrechnet. Wer die Polsterung am SheetGrabber ändert, zieht hier nach.
const GRAB_H = 30;
// Luft zwischen dem, was im Ruhezustand sichtbar sein MUSS, und der Tab-Leiste darunter.
// Dieselben 16px wie im MobileSheet (DETENT_AIR) und in --sg-sheet-peek, damit Peek-Inhalt
// überall gleich dicht an der Leiste steht.
const PEEK_AIR = 16;
// Was im Ruhezustand tatsächlich sichtbar ist: der Peek, minus Tab-Leiste (sie liegt ÜBER
// dem Sheet), minus Griffstreifen, minus Luft. Reines CSS und trotzdem aus SPOT_SHEET_PEEK
// abgeleitet: 100svh ist genau die Basis, die useViewportHeight() als Zahl liest
// (--sg-vh = 100svh), Zahl und Länge können also nicht auseinanderlaufen.
//
// DAS IST DER DECKEL FÜR DIE GANZE KARTE, gesperrt wie freigeschaltet: So hoch darf der
// Inhalt sein, damit im Ruhezustand nichts hinter der Tab-Leiste liegt.
const PEEK_CONTENT_MAX = `calc(${SPOT_SHEET_PEEK} * 100svh - var(--sg-nav-h) - ${GRAB_H + PEEK_AIR}px)`;

function X() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Spot-Bottom-Sheet (Apple Karten / Google Maps Stil): fährt auf Tippen herein, steht auf
// EINER Position, runterziehen schließt, kein Backdrop. Liegt über dem Explore-Sheet.
export default function SpotSheet({
  spot,
  onClose,
  onDismissStart,
  closing = false,
  loggedIn = false,
  saved = false,
  onSavedChange,
}: {
  // BEWUSST SpotCardData und nicht ExploreSpot: Das Sheet liest nur slug, title,
  // shortDesc, emoji, imageUrl, locked und previewUrl — also genau diese Basis. Mit dem
  // engeren Typ passt auch ein gespeicherter Spot hinein, und die Gespeichert-Karte
  // zeigt dasselbe Sheet wie Explore, statt ein zweites Kärtchen zu erfinden. Wer hier
  // ein Feld aus ExploreSpot braucht (seasons, categoryKeys, routeBounds), soll den Typ
  // bewusst wieder aufmachen und nicht aus Versehen zwei Sheets entstehen lassen.
  spot: SpotCardData;
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
  // Pro-Texte kommen aus dem Pro-Namensraum, auch hier: Der Satz über einen gesperrten Spot
  // und die Beschriftung des Knopfs standen früher in JEDEM Namensraum nochmal (Explore,
  // Detail, Tours, Ai) und liefen beim ersten Feinschliff auseinander. Eine Quelle, neun
  // Sprachen, ein Wortlaut.
  const tPro = useTranslations("Pro");
  const locale = useLocale();
  const gate = useLoginGate();
  // Stabile Viewport-Höhe: Vorher window.innerHeight an einem resize-Listener – und
  // iOS feuert resize bei jedem Leisten-Zug. Siehe lib/viewport.ts.
  const vh = useViewportHeight();
  const y = useMotionValue(2000);
  const dragControls = useDragControls();
  // Schließen darf nur EINMAL anlaufen: ✕, Esc, Runterziehen und der Karten-Klick
  // greifen alle in dismiss(), und zwei parallele Animationen auf dasselbe y kämpfen.
  const dismissed = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // false = der Körper scrollt nie. Er kann es auch nicht: Die Karte ist auf die sichtbare
  // Höhe gedeckelt, es gibt nichts, was unter der Kante läge. Damit zieht JEDE senkrechte
  // Geste auf der Karte das Sheet – am iPhone erwartet man genau das.
  const bodyDrag = useBodyDrag(dragControls, bodyRef, false);
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
  // Das Sheet-ELEMENT ist MAX hoch, seine Ruheposition zeigt davon den Peek. Der Rest
  // hängt unter dem Bildschirm und ist genau die Fläche, die beim Runterziehen
  // nachkommt.
  const sheetH = base * SPOT_SHEET_MAX;
  const closedY = sheetH;
  // Die eine Position, an der das Sheet steht. y ist der Weg nach unten aus der
  // Elementkante heraus: MAX minus Peek ist der Teil, der unten hinausragt.
  const restY = (SPOT_SHEET_MAX - SPOT_SHEET_PEEK) * base;

  // Beim Öffnen / Spot-Wechsel einfahren. Das ist die EINE Animation dieses Sheets:
  // Es kommt auf Tippen hin von unten herein.
  // Absichtlich an `measured` statt an `vh`: sonst liefe sie bei jeder Höhenänderung
  // erneut. Seit die Höhe aus useViewportHeight() kommt, ändert sie sich nur noch bei
  // Drehung – der Riegel bleibt trotzdem, denn auch eine Drehung darf das Sheet nicht
  // neu einfahren lassen.
  const measured = vh > 0;
  useEffect(() => {
    if (!measured) return;
    // Ein neuer Spot ist ein neues Sheet: Der Schließ-Riegel muss auf, sonst ließe
    // sich ein Sheet, das man mitten im Rausfahren durch einen Marker-Tipp wieder
    // hochgeholt hat, nie mehr schließen.
    dismissed.current = false;
    animate(y, restY, TRANSITION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.slug, measured]);

  // resize/Drehung: nur neu setzen, nie animieren.
  const settled = useRef(false);
  useEffect(() => {
    if (!vh) return;
    if (!settled.current) {
      settled.current = true; // erster Messwert -> gehört der Öffnen-Animation oben
      return;
    }
    y.jump(restY);
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
  // Loslassen: weit genug ODER schnell genug nach unten schließt, alles andere federt in
  // die Ruheposition zurück. Dieselben Schwellen wie vorher – nur gibt es kein Ziel mehr
  // außer diesen beiden.
  function handleDragEnd(_e: unknown, info: PanInfo) {
    if (y.get() > restY + 80 || info.velocity.y > 900) {
      dismiss();
      return;
    }
    animate(y, restY, TRANSITION);
  }

  const btn =
    "cursor-pointer flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-ink";

  return (
    <motion.div
      data-sg="spot-sheet"
      style={{ y, height: sheetH }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      // Nach oben ist die Ruheposition schon das Ende: Es gibt nichts aufzudecken, die
      // Karte steht ganz da. dragElastic lässt es trotzdem kurz nachgeben und
      // zurückfedern – das gummiartige Anschlagen, das iOS an seinem obersten Detent
      // macht, und die Rückmeldung "hier ist Schluss" statt eines toten Fingers.
      dragConstraints={{ top: restY, bottom: closedY }}
      dragElastic={0.06}
      onDragEnd={handleDragEnd}
      className="fixed inset-x-0 bottom-0 z-[55] flex w-full flex-col rounded-t-[22px] bg-cream shadow-[0_-10px_44px_-12px_rgba(0,0,0,0.4)]"
    >
      {/* Ohne onTap: Der Balken ist hier nur noch der Griff zum Runterziehen. Ein Tipp
          hatte das Sheet aufgezogen – es gibt keine Stufe mehr, auf die er zöge. */}
      <SheetGrabber dragControls={dragControls} className="py-3" />

      <div
        ref={bodyRef}
        {...bodyDrag}
        style={{ touchAction: "pan-x" }}
        className="flex-1 overflow-y-hidden overscroll-contain px-5"
      >
        {/* DER DECKEL – die eine Stellschraube dieses Sheets.
            So hoch, wie im Ruhezustand sichtbar ist (PEEK_CONTENT_MAX): Peek minus
            Tab-Leiste minus Griffstreifen minus 16px Luft. Was hier hineinpasst, steht
            ohne eine einzige Geste ganz da; das Foto ist in beiden Fällen das, was
            schrumpft. Gilt gesperrt wie freigeschaltet, damit sich die zwei Karten
            gleich anfühlen.

            Vorher hing hier eine Polsterung von 2.5rem und der Inhalt durfte beliebig
            hoch werden. Das Bild lief dann unten aus dem Bildschirm, und erst das
            Hochziehen brachte es ganz ins Bild. */}
        <div
          style={{ maxHeight: PEEK_CONTENT_MAX }}
          className="flex flex-col"
        >
          <div className="flex shrink-0 items-start justify-between gap-3">
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
            // Apple-Reihenfolge (App Store / TV+): Motiv (macht Lust), dann die Aktion,
            // dann der erklärende Nachsatz. Alles drei steht IMMER ganz da – gekürzt
            // wird nur das Foto.
            //
            // Warum das Foto: Der Deckel am gemessenen Kasten (siehe oben) gibt vor, wie
            // viel Platz es gibt; Titel, Knopf und Text nehmen sich davon, was ihre
            // Schrift braucht (shrink-0), das Foto bekommt den Rest. Vorher stand hier
            // eine feste Bildhöhe und der Nachsatz war auf zwei Zeilen gekürzt – auf
            // einem kleinen iPhone reichte das trotzdem nicht, die Tab-Leiste schnitt
            // die letzte Zeile ab. Eine Zahl, die für jede Sprache und jeden Schriftgrad
            // stimmt, gibt es nicht; "das Foto nimmt, was übrig bleibt" stimmt immer.
            //
            // min-h: Unter ~88px wäre das Foto ein Streifen und kein Motiv mehr. Am
            // Viewport nachgemessen (Chrome DevTools Protocol, Home-Indicator simuliert):
            // iPhone 15 390x844 -> Foto 150px, iPhone SE 375x667 -> 96px, in beiden
            // Fällen und in jeder Sprache 16px Luft unter dem Schlusssatz. Erst unter
            // ~600px Bildschirmhöhe (iPhone 5, seit iOS 15 kein Thema mehr) stößt das
            // Foto an den Riegel und die Karte bräuchte mehr Platz, als der Peek hat.
            <>
              <LockedMedia
                previewUrl={spot.previewUrl}
                emoji={spot.emoji}
                eager
                className="mt-3 h-[20svh] max-h-[220px] min-h-[88px] w-full shrink rounded-[16px]"
              />
              <Link
                href="/pro"
                className="mt-3 block shrink-0 rounded-full bg-accent px-5 py-3 text-center text-[15px] font-semibold text-white active:scale-[0.98]"
              >
                {tPro("cta")}
              </Link>
              <p className="mt-3 shrink-0 text-[14px] leading-snug text-muted">
                {tPro("spotTeaser")}
              </p>
            </>
          ) : (
            // Dieselbe Regel wie bei der Pro-Karte: Titel, Kurztext und Knopf nehmen
            // sich, was ihre Schrift braucht (shrink-0), das FOTO bekommt den Rest.
            //
            // Das Foto steht bewusst zuletzt und ist das einzige, was schrumpft: Wird der
            // Platz eng (lange Kurzbeschreibung, große Systemschrift), verliert das Bild
            // Höhe – nie der Text. Es wird dabei nicht gestaucht, sondern beschnitten
            // (object-cover), aus 16:10 wird ein breiterer Ausschnitt.
            //
            // min-h und die 12px Abstände sind dieselben wie bei der Pro-Karte: Die zwei
            // Karten stehen im selben Sheet und sollen denselben Rhythmus haben. Am
            // iPhone SE hing es genau daran – mit 16px Abständen stieß das Foto an seinen
            // Mindestwert und die Luft unten schrumpfte auf 6px.
            <>
              {spot.shortDesc && (
                <p className="mt-1.5 shrink-0 text-[15px] leading-relaxed text-muted">
                  {spot.shortDesc}
                </p>
              )}
              {/* self-start: In der Flex-Spalte würde der Knopf sonst auf die volle
                  Breite gezogen. Er soll so breit sein wie seine Schrift. */}
              <Link
                href={`/spot/${spot.slug}`}
                className="mt-3 inline-block shrink-0 self-start rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white active:scale-[0.98]"
              >
                {t("more")}
              </Link>

              {spot.imageUrl ? (
                <SmoothImage
                  src={spot.imageUrl}
                  alt={spot.title}
                  sizes="(min-width: 768px) 27rem, 100vw"
                  aiOrigin={spot.imageAiOrigin}
                  className="mt-3 aspect-[16/10] min-h-[88px] w-full shrink rounded-[16px]"
                />
              ) : (
                <div className="mt-3 flex aspect-[16/10] min-h-[88px] w-full shrink items-center justify-center overflow-hidden rounded-[16px] bg-gradient-to-br from-accent/20 to-muted/20">
                  <span className="text-6xl" aria-hidden>
                    {spot.emoji ?? "📍"}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
