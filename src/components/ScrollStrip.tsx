"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useDragScroll } from "@/lib/use-drag-scroll";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  DER Scroll-Streifen. Einer. Für jede Pillen-Leiste.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Es gab vier Nachbauten davon (Admin-Navigation, Event-Filter, Analytics, Mail-Sprachen),
// jeder mit einer eigenen Klassenliste, und keine zwei taten dasselbe: In einem fehlte das
// Verstecken der Scrollbar, in keinem konnte man mit der Maus ziehen, in allen waren die
// Pillen oben angeschnitten. Genau der Zustand, den man nicht sieht, wenn man immer nur eine
// Leiste vor sich hat, und der auffällt, sobald man zwei nebeneinander benutzt.
//
// WAS HIER DRINSTECKT, und jedes Stück davon hat einen Grund:
//
//   ÜBERBREITE ABFANGEN. Ohne eigenen Scroll-Bereich hört eine zu breite Pillen-Leiste nicht
//   am Rand auf, sondern schiebt das DOKUMENT breiter: Die ganze Seite lässt sich seitlich
//   wegschieben, Überschriften wandern mit. -mx-4/px-4 spiegelt das px-4 der Seitenrahmen,
//   damit die Pillen bis an den Bildschirmrand laufen statt vorher hart abzureissen.
//
//   MIT DER MAUS ZIEHEN. Am Desktop gibt es keinen Finger. Ohne Ziehen bleibt nur das
//   Trackpad-Wischen oder eine Scrollbar, die wir verstecken — für Anton fühlte sich die
//   Leiste deshalb kaputt an, während das Karussell auf der Startseite sich ziehen liess.
//   Dieselbe Logik wie dort (lib/use-drag-scroll.ts), plus cursor-grab, damit man es SIEHT.
//
//   KEIN scroll-smooth. Das Karussell hat es, hier wäre es ein Fehler: Beim Ziehen wird
//   scrollLeft pro Pointer-Bewegung gesetzt, und eine weiche Scroll-Animation läuft dann
//   hinter dem Finger her statt mit ihm. Der Streifen soll 1:1 an der Maus kleben.
//
//   py-1 GEGEN DAS ANSCHNEIDEN OBEN. Sobald overflow-x auf auto steht, rechnet CSS overflow-y
//   ebenfalls auf auto — eine Achse „visible" und die andere nicht gibt es nicht. Damit
//   schneidet der Streifen auch oben und unten ab, und zwar genau an der Kante des
//   Inhalts-Kastens. Die Pillen tragen shadow-sm und einen Ring, beides lag also auf der
//   Schnittkante (nachgemessen: 0px Luft). Geclippt wird am PADDING-Kasten, deshalb schafft
//   py-1 die Luft.
//
//   overflow-y-hidden: DIESE LEISTE SCROLLT WAAGRECHT UND SONST GAR NICHT. Der Satz oben hat
//   eine Kehrseite, die teuer war: Weil die zweite Achse zwangsweise auf `auto` steht, wird
//   der Streifen zum senkrechten Scroll-Container, sobald irgendein Kind auch nur zwei Pixel
//   nach unten übersteht. Genau das ist mit den Filter-Pillen passiert — `sg-hit` legt eine
//   44px-Fläche über eine 32px-Pille, und schon war die Leiste 2px vertikal scrollbar
//   (clientHeight 40 gegen scrollHeight 42). Am iPhone frisst so ein Container den Anfang
//   jeder senkrechten Geste: Der Finger schiebt erst diese zwei Pixel, das Sheet greift
//   verspätet, und die Zeile zappelt gegen den Rest.
//   `hidden` und nicht `clip`, obwohl clip die schönere Absicht wäre („gar kein Scroll-
//   Kasten"): Neben einer scrollenden Achse rechnet der Browser clip ohnehin zu hidden um
//   (nachgemessen: `overflow-y: clip` allein bleibt clip, zusammen mit `overflow-x: auto`
//   wird hidden daraus). Dann steht hier gleich der Wert, der wirklich gilt, statt einer
//   Angabe, die der Browser jedes Mal stillschweigend überschreibt.
//   Was hidden leistet: Wisch und Mausrad kommen auf dieser Achse nicht mehr durch, egal
//   was eine Aufrufstelle hineinlegt. Die Regel gehört hierher und nicht in die Disziplin
//   von fünf Aufrufern.
//   Waagrecht bleibt alles wie gehabt: overflow-x steht weiter auf auto.
//
//   UND KEIN NEGATIVES MARGIN DAZU, auch wenn es verlockend ist. Hier stand `-my-1`, um die
//   8px vom Layout wieder wegzunehmen. Das hat den Abstand nach unten AUFGEFRESSEN: Tailwind
//   v4 baut `space-y-4` als `margin-bottom` auf jedes Kind, und `-my-1` überschreibt genau
//   diese Eigenschaft. Aus 16px Abstand wurden also -4px, und die Pillen klebten an der Karte
//   darunter (nachgemessen: 0px sichtbar). Ein Streifen darf nicht am Abstand seines Aufrufers
//   drehen — er kennt dessen Spacing-Utility nicht, und `space-y`, `gap` und `mt-*` verhalten
//   sich alle drei anders. Die 8px kosten also 4px mehr Luft ober- und unterhalb als bei einem
//   normalen Element. Das ist der Preis, und er ist billiger als eine Leiste, die je nach
//   Elternteil klebt oder springt.
//
//   VERLAUF AN DEN SCROLL-RÄNDERN. Am breiten Fenster endet der Streifen mitten auf der Seite
//   (der Admin-Rahmen ist max-w-[820px]), und eine Pille wurde dort mittendurch geschnitten:
//   „Español" stand als „E" da, mit Creme daneben. Das liest sich als Fehler und nicht als
//   „da geht noch was". Der Verlauf macht aus dem Schnitt ein Auslaufen. Er erscheint NUR auf
//   der Seite, zu der es wirklich weitergeht — ein Streifen, der links ausfranst, obwohl er
//   am Anfang steht, behauptet verstecktes Zeug, das es nicht gibt.
//
// NICHT FÜR KARTEN-KARUSSELLS: Dafür ist Carousel.tsx da, mit Pfeilen, Snap-Punkten und einer
// berechneten Kartenbreite (siehe globals.css, „2 volle + 1 halbe Karte"). Beide teilen den
// robusten Kern, useDragScroll. Dieser hier ist die Pillen-Fassung: keine Pfeile, kein Snap,
// weil Pillen verschieden breit sind und ein Snap sie an willkürlichen Stellen einrasten liesse.

/** Wie weit der Verlauf am Rand einläuft. Etwas mehr als das px-4 des Rahmens. */
const FADE_PX = 24;

export default function ScrollStrip({
  children,
  className = "",
  scrollRef,
}: {
  /**
   * Die Leiste selbst, als EIN Element mit `flex w-max`.
   *
   * Absichtlich nicht hier erzeugt: Die Admin-Navigation ist ein Segment-Control mit eigener
   * Hintergrund-Pille (`rounded-full bg-black/5 p-1`), die Filter-Leisten sind blanke
   * Reihen mit `gap-2`. Ein `railClassName`-Prop dafür wäre eine Einstellung, die man an
   * jeder Aufrufstelle neu nachschlagen muss. Der Streifen kümmert sich um das Scrollen, die
   * Optik der Leiste bleibt beim Aufrufer.
   */
  children: ReactNode;
  /** Aussenabstände der Aufrufstelle, z.B. "mt-4". */
  className?: string;
  /**
   * Zugriff auf das scrollende Element, für Aufrufer, die selbst hinscrollen müssen.
   * Die Admin-Navigation holt damit den aktiven Reiter in den sichtbaren Bereich.
   */
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const { ref, dragProps } = useDragScroll(scrollRef);
  // Zu welcher Seite geht es weiter? Steuert nur den Verlauf, nichts Funktionales.
  const [more, setMore] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 1px Toleranz: Bei ungeraden Breiten und Browser-Zoom kommt scrollLeft als 0.5 zurück,
    // und ein Verlauf, der bei jedem Zoomschritt aufblitzt, ist schlimmer als keiner.
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setMore({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Nicht nur beim Scrollen: Wird das Fenster breiter, passt die Leiste irgendwann ganz
    // hinein und der Verlauf muss verschwinden. Ohne das bliebe er stehen, bis jemand scrollt.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const kid of Array.from(el.children)) ro.observe(kid);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [ref]);

  // Der Verlauf als Maske, aus zwei Hälften zusammengesetzt. Ohne Überbreite: gar keine
  // Maske. `undefined` und nicht "none", damit der Browser die Eigenschaft gar nicht anlegt.
  const mask =
    more.start || more.end
      ? `linear-gradient(to right, ${
          more.start ? `transparent 0, black ${FADE_PX}px` : "black 0"
        }, ${more.end ? `black calc(100% - ${FADE_PX}px), transparent 100%` : "black 100%"})`
      : undefined;

  return (
    <div
      ref={ref}
      {...dragProps}
      // select-none: Wer zieht, soll nicht die Pillen-Beschriftung markieren.
      // cursor-grab erst ab md: Am Handy gibt es keinen Zeiger, den man ändern könnte.
      className={`-mx-4 overflow-x-auto overflow-y-hidden px-4 py-1 select-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:cursor-grab md:active:cursor-grabbing ${className}`}
      // WebkitMaskImage mit: Safari kennt mask-image erst ab 15.4 unprefixed, und ein Handy,
      // das zwei Jahre kein Update gesehen hat, zeigt sonst gar keine Maske. Das ist kein
      // Beinbruch (dann ist der Rand hart wie vorher), kostet aber nichts.
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {children}
    </div>
  );
}
