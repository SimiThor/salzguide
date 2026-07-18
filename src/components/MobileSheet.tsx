"use client";

import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { NAV_H_VAR, SHEET_PEEK_VAR, readCssLength } from "@/lib/sheet-metrics";
import SheetGrabber from "./SheetGrabber";
import { useBodyDrag } from "./useBodyDrag";

// Persistentes, ziehbares Bottom-Sheet (Mobile) mit Detents/Grabber – iOS-2026.
//
// AUFBAU – zwei Ebenen, und das ist der Kern:
//
//   Schiene (div)   absolute bottom-0, Höhe = oberster Detent,
//                   transform: translate3d(0, calc(100% - Peek), 0)   <- reines CSS
//     Sheet (motion.div)  y = Abstand zur Ruheposition, 0 = Peek       <- framer-motion
//
// Die Schiene hält die Ruheposition in CSS. `100%` ist ihre eigene Höhe, die Peek-Höhe
// kommt aus --sg-sheet-peek – beides löst der Browser beim Parsen auf. Das Sheet sitzt
// dadurch schon im Server-HTML exakt richtig, ohne JavaScript.
//
// Deshalb ist y ein OFFSET (0 = Peek, negativ = aufgezogen, positiv = versteckt) und
// nicht die absolute Position: y = 0 ist der Ruhezustand, also genau das, was SSR
// rendert. Es gibt keinen Startwert, der erst korrigiert werden müsste.
//
// Vorher stand die Position in JS: y startete bei 99999, ein useEffect maß
// window.innerHeight und ließ eine Feder von dort zur Ruheposition laufen. Über die
// ~99400px Weg sammelte die (leicht unterdämpfte) Feder so viel Tempo, dass sie rund
// 50px über das Ziel hinausschoss und zurückfiel – das war der Sprung beim Laden.
// Jetzt animiert beim Mounten gar nichts mehr, weil nichts mehr zu korrigieren ist.
//
// JS misst nur noch für die INTERAKTION (Detent-Rechnung). Käme die Messung zu spät,
// wäre höchstens ein Ziehen in der ersten Millisekunde ungenau – die Position stimmt
// unabhängig davon.

// Apples Sheet-Bewegung. Die Kurve steht auch in globals.css (--sg-ease-sheet):
// framer-motion braucht sie als Zahlen, CSS als Text. Beide meinen dieselbe Kurve.
// 0.5s ist SwiftUIs Standard-Dauer, die Kurve schwingt bewusst nicht über.
const EASE_IOS: [number, number, number, number] = [0.32, 0.72, 0, 1];
const DURATION = 0.5;

// Schwellen beim Loslassen (px/s), aus Vauls Sheet-Logik – drei Stufen, und die
// mittlere ist die, die sich richtig anfühlt:
//  - über FLICK: entschlossener Wisch -> ans Ende, Zwischenstufen überspringen
//  - über STEP bei kurzem Weg: gezielter Wisch -> genau EINE Stufe weiter
//  - sonst: zur nächstgelegenen Stufe (langes Ziehen = Position zählt, nicht Tempo)
const V_FLICK = 2000;
const V_STEP = 400;
const STEP_MAX_DRAG = 0.4; // Anteil der Container-Höhe

// Luft zwischen dem, was eine Stufe zeigen soll, und der Tab-Leiste darunter.
const DETENT_AIR = 16;

// Eine Stufe ist entweder ein Anteil der Container-Höhe (0.9 = 90%) ODER die Ansage
// „hoch genug, dass DIESES Element noch ganz drübersteht". Letzteres ist das, was Apple
// mit einem eigenen Detent macht: eine Zahl aus dem Kontext rechnen statt raten.
// Nötig, weil sich der Inhalt nicht in Pixel schreiben lässt – eine Spot-Karte ist
// 76vw breit mit 4:3-Bild, also auf jedem iPhone verschieden hoch.
export type Detent = number | { fits: string; fallback: number };

// Modul-Konstante, kein Inline-Default: sonst wäre es bei jedem Render ein neues Array.
const DEFAULT_DETENTS: Detent[] = [0.5, 0.9];

// Der Peek ist entweder eine feste CSS-Länge ODER – wie eine `fits`-Stufe – die Ansage
// „so hoch, dass DIESES Element im Ruhezustand ganz sichtbar ist".
//
// Warum es beim Peek die zweite Form braucht: eine feste Zahl beschreibt Inhalt, der
// nicht fest ist. Der Untertitel der Wasser-Seite bricht je nach Sprache und Gerät auf
// zwei oder drei Zeilen um, und wer im System größere Schrift eingestellt hat, bekommt
// mit jeder festen Zahl irgendwann eine Kante mitten durch den Text. Gemessen wird das
// zwangsläufig richtig.
//
// `fallback` ist trotzdem Pflicht und sollte die ehrliche Schätzung sein, nicht
// irgendein Platzhalter: sie steht im Server-HTML und gilt bis zur ersten Messung.
// Liegt sie daneben, sieht man beim Laden genau den Ruck, den die CSS-Ruheposition
// eigentlich verhindert (siehe Kopf).
export type Peek = string | { fits: string; fallback: string };

// Luft über der Tab-Leiste – dieselbe wie bei den Stufen, damit Peek und Stufen nicht
// unterschiedlich dicht an der Leiste kleben.
const PEEK_AIR = DETENT_AIR;

// Auf dem Server gibt es kein Layout, useLayoutEffect warnt dort. Auf dem Client MUSS
// es useLayoutEffect sein: die gemessene Peek-Höhe muss VOR dem ersten Paint stehen,
// sonst sieht man sie einrasten.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Unterkante eines Elements, gemessen ab Oberkante des Sheets.
//
// Über offsetTop statt getBoundingClientRect: offsetTop ist reines Layout und ignoriert
// transforms. Beim Saison-Wechsel fährt der Inhalt animiert ein (transform), und das
// Sheet selbst hängt dauernd an einem transform – mit Rects wäre die Messung genau dann
// daneben, wenn gerade etwas läuft. offsetTop ist auch vom Scrollstand unabhängig.
function offsetBottomWithin(el: HTMLElement, sheet: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  // Die Kette endet am Sheet, weil es `relative` ist und damit offsetParent.
  while (node && node !== sheet) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top + el.offsetHeight;
}

export default function MobileSheet({
  children,
  hide,
  peek,
  detents = DEFAULT_DETENTS,
}: {
  children: ReactNode;
  hide: boolean;
  // Überschreibt --sg-sheet-peek für diese Seite. Feste Länge oder gemessen (siehe Peek).
  // Muss eine Länge sein, kein Prozentwert: die Property ist als <length> registriert.
  peek?: Peek;
  // Die weiteren Stufen, von unten nach oben. Peek ist immer die unterste und steht
  // NICHT hier drin – die kommt aus CSS. Die LETZTE muss ein Anteil sein: sie bestimmt
  // die Höhe des Sheets selbst.
  detents?: Detent[];
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0); // 0 = Peek = die Ruheposition aus CSS
  const dragControls = useDragControls();
  const idxRef = useRef(0); // 0 = Peek, dann die Detents
  const [atFull, setAtFull] = useState(false);
  const bodyDrag = useBodyDrag(dragControls, bodyRef, atFull);
  const reduceMotion = useReducedMotion();

  // Nur für die Interaktion, nicht für die Position (siehe Kopf).
  const [metrics, setMetrics] = useState({ peekPx: 0, fullPx: 0, containerPx: 0 });

  // ── Peek: feste Länge oder gemessen ────────────────────────────────────────
  const peekFits = typeof peek === "object" ? peek.fits : null;
  const peekFallback = typeof peek === "object" ? peek.fallback : peek;
  const [peekMeasured, setPeekMeasured] = useState<string | null>(null);
  // Was tatsächlich gilt: die Messung, solange es eine gibt, sonst die Schätzung.
  const effectivePeek = peekMeasured ?? peekFallback;

  // Misst die Unterkante des Peek-Ankers und schreibt sie als CSS-Länge fort. Damit
  // bleibt die Ruheposition weiterhin eine reine CSS-Rechnung – JS liefert nur die Zahl,
  // es verschiebt das Sheet nicht selbst. Genau darum gibt es hier auch kein animate():
  // ändert sich der Peek, ändert sich der Nullpunkt, und y = 0 stimmt weiter.
  const measurePeek = useCallback(() => {
    const rail = railRef.current;
    const sheet = sheetRef.current;
    const body = bodyRef.current;
    if (!rail || !sheet || !body || !peekFits) return;
    const el = body.querySelector<HTMLElement>(peekFits);
    // Kein Anker (Inhalt noch nicht da, Audio gesperrt) -> bei der Schätzung bleiben.
    if (!el) return;
    const fullPx = rail.getBoundingClientRect().height;
    if (!fullPx) return;
    // Die Tab-Leiste liegt ÜBER dem Sheet, ihre Höhe gehört also dazu – sonst steht der
    // Anker zwar im Sheet, aber hinter der Leiste. Nach oben begrenzt die Sheet-Höhe:
    // ein Peek über der obersten Stufe wäre eine Ruheposition, die es nicht gibt.
    const h = offsetBottomWithin(el, sheet) + PEEK_AIR + readCssLength(NAV_H_VAR, rail);
    const next = `${Math.round(Math.min(fullPx, h))}px`;
    setPeekMeasured((cur) => (cur === next ? cur : next));
  }, [peekFits]);

  // Der Anker wird direkt beobachtet, nicht nur bei resize nachgemessen. Sonst bliebe der
  // Peek genau dann stehen, wenn sich am DOM nichts ändert und trotzdem alles höher wird:
  // Inter lädt nach und der Untertitel bricht plötzlich auf drei Zeilen um. Ein
  // MutationObserver sieht das nicht, ein ResizeObserver schon.
  //
  // Der MutationObserver daneben ist nur dafür da, den Anker neu zu greifen, wenn der
  // Inhalt ausgetauscht wird (anderer Stopp) – dann zeigt der alte Beobachter ins Leere.
  useIsoLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !peekFits) return;
    let watched: HTMLElement | null = null;
    const ro = new ResizeObserver(() => measurePeek());
    const attach = () => {
      const next = body.querySelector<HTMLElement>(peekFits);
      if (next !== watched) {
        if (watched) ro.unobserve(watched);
        watched = next;
        if (watched) ro.observe(watched);
      }
      measurePeek();
    };
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(body, { childList: true, subtree: true });
    // resize bleibt trotzdem: die Tab-Leiste steckt im Peek, und die ändert sich mit der
    // Safe Area, ohne dass der Anker selbst anders wird.
    window.addEventListener("resize", measurePeek);
    window.addEventListener("orientationchange", measurePeek);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measurePeek);
      window.removeEventListener("orientationchange", measurePeek);
    };
  }, [measurePeek, peekFits]);

  // Der Peek gilt nicht nur fürs Sheet: das Karten-Padding hält Pins darüber und
  // --sg-map-bottom hebt Mapbox-Logo und -Attribution an. Beide lesen dieselbe Variable,
  // stehen aber außerhalb der Schiene – deshalb wird ein abweichender Peek an die Wurzel
  // durchgereicht, statt jeden Verbraucher einzeln zu verkabeln. Pro Seite gibt es genau
  // ein persistentes Sheet, also streitet sich niemand darum; beim Verlassen der Seite
  // fällt der globale Standard aus globals.css zurück.
  //
  // `metrics.fullPx` ist die Sicherung: am Desktop hängt das Sheet in einem `md:hidden`
  // und hat gar kein Layout (Höhe 0). Ohne die Abfrage schriebe es dort trotzdem einen
  // Handy-Peek an die Wurzel, und --sg-map-bottom schöbe das Mapbox-Logo grundlos hoch.
  useEffect(() => {
    if (!effectivePeek || !metrics.fullPx) return;
    const root = document.documentElement;
    root.style.setProperty(SHEET_PEEK_VAR, effectivePeek);
    return () => {
      root.style.removeProperty(SHEET_PEEK_VAR);
    };
  }, [effectivePeek, metrics.fullPx]);

  // Die oberste Stufe gibt dem Sheet seine Höhe, muss also ein Anteil sein.
  const last = detents[detents.length - 1];
  const fullFraction = typeof last === "number" ? last : 0.9;

  const transition = useMemo(
    () => (reduceMotion ? { duration: 0 } : { duration: DURATION, ease: EASE_IOS }),
    [reduceMotion],
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      // Die Schiene ist `fullFraction` der Container-Höhe -> daraus fällt beides ab.
      const fullPx = rail.getBoundingClientRect().height;
      if (!fullPx) return;
      setMetrics({
        peekPx: readCssLength(SHEET_PEEK_VAR, rail),
        fullPx,
        containerPx: fullPx / fullFraction,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
    // effectivePeek in den Deps: nach der Messung ist peekPx ein anderer, und daran
    // hängen die Zieh-Grenzen. Ohne das zöge man gegen die Grenzen der Schätzung.
  }, [fullFraction, effectivePeek]);

  // y-Offset je Stufe. stops[0] ist immer 0 (Peek = Ruheposition).
  //
  // Wird bei JEDER Interaktion frisch gerechnet, nicht gecacht. Eine `fits`-Stufe hängt
  // am tatsächlichen Inhalt, und der wechselt (Saison-Umschalter tauscht die Regale,
  // Schriften/Bilder laden nach). Ein gecachter Wert wäre irgendwann still falsch;
  // Messen kostet hier nur ein paar offsetTop-Zugriffe, und zwar genau dann, wenn
  // ohnehin etwas passiert.
  const computeStops = useCallback((): number[] => {
    const rail = railRef.current;
    const sheet = sheetRef.current;
    if (!rail || !sheet) return [0];
    const fullPx = rail.getBoundingClientRect().height;
    if (!fullPx) return [0];
    const containerPx = fullPx / fullFraction;
    const peekPx = readCssLength(SHEET_PEEK_VAR, rail);
    const navPx = readCssLength(NAV_H_VAR, rail);

    const heights = detents.map((d) => {
      if (typeof d === "number") return d * containerPx;
      const el = bodyRef.current?.querySelector<HTMLElement>(d.fits);
      // Kein Anker da (leere Saison, Inhalt noch nicht gerendert) -> Rückfall auf einen
      // Anteil, damit die Stufe nie verschwindet.
      if (!el) return d.fallback * containerPx;
      // Die Tab-Leiste liegt über dem Sheet -> ihre Höhe gehört zur Stufe dazu, sonst
      // steht der Anker zwar im Sheet, aber hinter der Leiste.
      return offsetBottomWithin(el, sheet) + DETENT_AIR + navPx;
    });

    return [peekPx, ...heights].map((h) =>
      // Nie unter Peek und nie über die Sheet-Höhe: ein sehr hohes Regal wird sonst zu
      // einer Stufe, die es nicht gibt.
      peekPx - Math.min(fullPx, Math.max(peekPx, h)),
    );
  }, [detents, fullFraction]);

  const snapTo = useCallback(
    (i: number) => {
      const stops = computeStops();
      const c = Math.max(0, Math.min(stops.length - 1, i));
      idxRef.current = c;
      setAtFull(c === stops.length - 1);
      animate(y, stops[c], transition);
    },
    [computeStops, transition, y],
  );

  // Ein-/Ausblenden, wenn die Spot-Vorschau aufgeht. Die einzige Animation von außen.
  const mounted = useRef(false);
  useEffect(() => {
    // Beim Mounten NICHT animieren: die CSS-Ruheposition stimmt bereits. Eine
    // Animation von irgendwo nach hier WÄRE der Sprung, den wir loswerden wollten.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!metrics.fullPx) return;
    animate(y, hide ? metrics.peekPx : computeStops()[idxRef.current], transition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hide]);

  // Resize/Drehung: neu einrasten, aber NIE animieren. iOS fährt beim Scrollen die
  // Toolbar ein und aus, das löst resize aus – eine Animation darauf würde dem
  // Toolbar-Wechsel sichtbar hinterherruckeln.
  useEffect(() => {
    if (!metrics.fullPx) return;
    y.jump(hide ? metrics.peekPx : computeStops()[idxRef.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  function onDragStart() {
    draggingRef.current = true;
  }
  function onDragEnd(_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    draggingRef.current = false;
    const cur = y.get();
    const stops = computeStops();
    let best = 0;
    for (let i = 1; i < stops.length; i++) {
      if (Math.abs(stops[i] - cur) < Math.abs(stops[best] - cur)) best = i;
    }
    const v = info.velocity.y; // negativ = nach oben
    const shortDrag = Math.abs(info.offset.y) < metrics.containerPx * STEP_MAX_DRAG;
    if (v < -V_FLICK) best = stops.length - 1;
    else if (v > V_FLICK) best = 0;
    else if (shortDrag && v < -V_STEP) best = idxRef.current + 1;
    else if (shortDrag && v > V_STEP) best = idxRef.current - 1;
    snapTo(best);
  }

  // Eine `fits`-Stufe hängt am Inhalt – wechselt der, sind die gemessenen Werte falsch.
  // Genau dafür hat Apple invalidateDetents(): "If the closure depends on any external
  // inputs, call invalidateDetents() when the external inputs change."
  //
  // Der MutationObserver fängt jeden Wechsel selbst (Saison-Umschalter tauscht die
  // Regale, Inhalte laden nach) – die Seite muss nichts melden und kann es nicht
  // vergessen.
  //
  // Stört dabei nichts: Peek und die oberste Stufe hängen NICHT am Inhalt, dort ist das
  // Ziel unverändert und es passiert schlicht nichts. Bewegt wird nur, wenn das Sheet
  // wirklich auf einer inhaltsabhängigen Stufe steht – dann aber muss es.
  const hideRef = useRef(hide);
  useEffect(() => {
    hideRef.current = hide;
  }, [hide]);
  const draggingRef = useRef(false);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let raf = 0;
    const invalidate = () => {
      cancelAnimationFrame(raf);
      // Ein Frame warten: beim Saison-Wechsel hängt kurz noch das alte Regal im DOM.
      raf = requestAnimationFrame(() => {
        if (hideRef.current || draggingRef.current) return;
        const target = computeStops()[idxRef.current];
        if (Math.abs(y.get() - target) > 1) animate(y, target, transition);
      });
    };
    const mo = new MutationObserver(invalidate);
    mo.observe(body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [computeStops, transition, y]);

  // Tippen (statt ziehen) geht eine Stufe weiter, oben wieder zurück auf Peek.
  // detents.length = oberste Stufe (Peek ist die zusätzliche unterste).
  function onGrabberTap() {
    snapTo(idxRef.current < detents.length ? idxRef.current + 1 : 0);
  }

  const railStyle = {
    height: `${fullFraction * 100}%`,
    // DIE Zeile, die den Ladesprung beseitigt: Ruheposition = Peek, komplett in CSS.
    // `100%` ist die Höhe dieses Elements, --sg-sheet-peek kommt aus globals.css.
    transform: `translate3d(0, calc(100% - var(${SHEET_PEEK_VAR})), 0)`,
    ...(effectivePeek ? { [SHEET_PEEK_VAR]: effectivePeek } : null),
  } as CSSProperties;

  return (
    <div
      ref={railRef}
      style={railStyle}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[45]"
    >
      <motion.div
        ref={sheetRef}
        data-sg="mobile-sheet"
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        // Ziehbar zwischen ganz auf und Peek. Aus metrics, nicht aus computeStops():
        // die Grenzen sind reine Geometrie und dürfen nicht am Inhalt hängen.
        dragConstraints={{ top: metrics.peekPx - metrics.fullPx, bottom: 0 }}
        dragElastic={0.08}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="pointer-events-auto relative flex h-full flex-col rounded-t-[22px] bg-cream/95 shadow-2xl backdrop-blur-xl"
      >
        {/* pb-2 pt-3 = 26px Streifen; genau der Wert, mit dem globals.css den Peek rechnet. */}
        <SheetGrabber dragControls={dragControls} onTap={onGrabberTap} className="pb-2 pt-3" />
        <div
          ref={bodyRef}
          {...bodyDrag}
          style={{ touchAction: atFull ? "auto" : "pan-x" }}
          className={`flex-1 overscroll-contain pb-[calc(var(--sg-nav-h)+16px)] pt-1 ${
            atFull ? "overflow-y-auto" : "overflow-y-hidden"
          }`}
        >
          {children}
        </div>
        {/* Zieht man das Sheet über den obersten Detent hinaus (dragElastic), rutscht
            seine Unterkante ins Bild und die Karte blitzte darunter durch. Diese
            Fläche hängt unter dem Sheet und füllt das. */}
        <div aria-hidden className="absolute inset-x-0 top-full h-1/2 bg-cream/95" />
      </motion.div>
    </div>
  );
}
