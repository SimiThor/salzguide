"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Auf dem Server gibt es kein Layout, useLayoutEffect warnt dort. Auf dem Client MUSS es
// useLayoutEffect sein: Das Tor darf erst zugehen, nachdem feststeht, dass das Bild noch
// gar nichts zu zeigen hat, und das muss VOR dem ersten Paint passieren.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// WIE FOTOS AUF DIESER PLATTFORM ERSCHEINEN. Eine Regel, ein Ort.
//
// Das Problem: Jedes Foto erscheint schlagartig in dem Moment, in dem seine letzten Bytes
// da sind. Ein Regal aus sechs Karten blitzt damit sechsmal zu sechs zufälligen
// Zeitpunkten auf, und die Seite zappelt, statt ruhig dazustehen.
//
// DREI TEILE, und ihre Trennung ist der ganze Trick:
//
// 1. DIE SCHIMMER-KACHEL steht von Anfang an im Server-HTML. Sie braucht kein
//    JavaScript, sie liegt HINTER dem Bild und verschwindet, sobald das Bild da ist.
// 2. DAS TOR (opacity-0) geht erst beim Hydrieren zu, und nur, wenn das Bild zu diesem
//    Zeitpunkt noch NICHTS zu zeigen hat. Für das Auge ist das folgenlos.
// 3. DIE WELLE: Alle Bilder, die im selben Moment sichtbar warten, erscheinen GEMEINSAM,
//    sobald das letzte von ihnen da ist. Nicht eins, dann zwei, dann der Rest.
//
// WARUM NICHT EINFACH IM SERVER-HTML opacity-0:
// Genau so stand es hier zuerst, und es war messbar schlechter als gar keine Blende. Der
// Browser beginnt Bilder zu laden, sobald er das HTML liest, lange bevor React hydriert.
// Am gedrosselten Netz gemessen: Foto fertig nach 2,8s, JavaScript da nach 6,1s. Mit
// einem Tor im Server-HTML lag das fertige Foto 3,3 Sekunden unsichtbar hinter einem
// Schimmer und sprang dann hart hervor. Ein Tor, das erst zugeht, wenn ohnehin nichts zu
// sehen ist, kann diesen Schaden nicht anrichten. Und ohne JavaScript erscheinen Fotos
// wie eh und je.
//
// WARUM DIE WELLE EINE FRIST HAT:
// Ein einziges lahmes Foto darf nicht die ganze Reihe aufhalten. Nach der Frist erscheint,
// was fertig ist; die Nachzügler blenden danach für sich ein.
//
// MIN_SHIMMER: Ohne Mindestdauer blitzt der Schimmer bei schnellen Verbindungen 40ms auf
// und ist damit selbst das Zappeln, das er verhindern soll.
const MIN_SHIMMER_MS = 400;
// Wie lange eine Welle höchstens auf ihr langsamstes Bild wartet (nach dem Sammeln).
const WELLE_FRIST_MS = 1200;
// Dauer der Einblendung. Muss zur `duration-500`-Klasse unten passen (beide stehen
// bewusst in dieser Datei, damit sie nicht auseinanderlaufen können).
// Die Kurve dazu ist --sg-ease-ui, dieselbe wie bei den Karussell-Pfeilen: eine Blende
// verteilt gleichmässig. Eine Ankunftskurve (--sg-ease-sheet) schiebt die halbe Blende
// in die ersten Zehntel und sieht dadurch aus wie ein Sprung, siehe globals.css.
const FADE_MS = 500;

// ---------------------------------------------------------------------------
// DIE WELLE
//
// Modulweiter Zustand, also EINE Welle für die ganze Seite: Die Bilder wissen nichts
// voneinander, sie melden sich nur an derselben Stelle an. Das ist billiger als ein
// Context (kein Provider, kein Re-Render) und funktioniert über Regal-Grenzen hinweg,
// denn "sichtbar" ist eine Eigenschaft des Bildschirms, nicht der Komponente.
//
// Gesammelt wird bis zum nächsten Frame: Alle Bilder, die beim Hydrieren ihr Tor
// schliessen, tun das im selben Durchgang und gehören damit automatisch zusammen. Wer
// später dazukommt (hineingescrollt, Sommer/Winter umgeschaltet), bildet eine neue Welle.
// ---------------------------------------------------------------------------
type Mitglied = {
  fertig: boolean;
  /** true = wartet auf niemanden mehr (ausserhalb des Bildes, oder Nachzügler). */
  allein: boolean;
  welle: Welle | null;
  zeigen: () => void;
};

type Welle = {
  mitglieder: Set<Mitglied>;
  /** Nimmt noch Mitglieder auf (bis zum nächsten Frame). */
  offen: boolean;
  erledigt: boolean;
  start: number;
  frist: number;
};

let offeneWelle: Welle | null = null;

function trittBei(m: Mitglied) {
  let w = offeneWelle;
  if (!w) {
    w = {
      mitglieder: new Set(),
      offen: true,
      erledigt: false,
      start: performance.now(),
      frist: 0,
    };
    offeneWelle = w;
    const neu = w;
    requestAnimationFrame(() => {
      neu.offen = false;
      if (offeneWelle === neu) offeneWelle = null;
      pruefe(neu);
    });
    neu.frist = window.setTimeout(() => aufloesen(neu), MIN_SHIMMER_MS + WELLE_FRIST_MS);
  }
  w.mitglieder.add(m);
  m.welle = w;
}

function verlasse(m: Mitglied) {
  const w = m.welle;
  m.welle = null;
  if (!w) return;
  w.mitglieder.delete(m);
  pruefe(w);
}

// Sind alle da? Dann zeigen. Aber nie früher als MIN_SHIMMER nach dem Start der Welle.
function pruefe(w: Welle) {
  if (w.offen || w.erledigt) return;
  for (const m of w.mitglieder) if (!m.fertig) return;
  const rest = MIN_SHIMMER_MS - (performance.now() - w.start);
  if (rest > 0) {
    window.setTimeout(() => pruefe(w), rest);
    return;
  }
  aufloesen(w);
}

// Welle auflösen: Wer fertig ist, erscheint jetzt. Wer nicht, macht ab sofort sein
// eigenes Ding (sonst hielte ein hängendes Bild die ganze Reihe im Schimmer fest).
function aufloesen(w: Welle) {
  if (w.erledigt) return;
  w.erledigt = true;
  clearTimeout(w.frist);
  if (offeneWelle === w) offeneWelle = null;
  for (const m of w.mitglieder) {
    m.welle = null;
    if (m.fertig) m.zeigen();
    else m.allein = true;
  }
  w.mitglieder.clear();
}

// Steht das Bild gerade im Bild? Nur solche warten aufeinander: Ein Foto zehn Regale
// weiter unten lädt gar nicht erst (lazy) und würde die Welle ewig offen halten.
function imBild(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.top < window.innerHeight &&
    r.right > 0 &&
    r.left < window.innerWidth
  );
}

// "offen" = kein Tor (Server-HTML, schon geladenes Bild, LCP-Bild).
type Mode = "offen" | "zu" | "blende";

/**
 * Zustand fürs weiche Erscheinen EINES Bildes; die Bilder einer Ansicht erscheinen
 * dabei gemeinsam. Gibt zurück, was das Bild und seine Kachel brauchen, damit alle
 * Fotos der Plattform gleich erscheinen.
 * Benutzt von SmoothImage (Karten, Sheets), GalleryImage und LockedMedia.
 *
 * @param priority Nur fürs LCP-Bild: nie ein Tor, keine Welle. Ein server-gerendertes
 *   opacity-0 zählte erst nach Hydration + Laden als LCP-Kandidat und verzögerte genau
 *   die Metrik, für die priority da ist.
 */
export function useImageReveal(src: string | null | undefined, priority = false) {
  // Ohne Quelle gibt es nichts zu laden (Emoji-Fallback, fehlende Vorschau): keine
  // Kachel, die ewig auf ein Bild wartet, das nie kommt.
  const idle = priority || !src;
  const ref = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<Mode>("offen");
  const [skeleton, setSkeleton] = useState(!idle);
  // War das Tor je zu? Nur dann gibt es etwas einzublenden. Ohne diese Frage schaltete
  // ein nachgeladenes srcset-Bild ein längst sichtbares Foto noch einmal auf "Blende".
  const zu = useRef(false);
  const timer = useRef(0);
  const mitglied = useRef<Mitglied>({
    fertig: false,
    allein: false,
    welle: null,
    zeigen: () => {},
  });

  const zeigen = useCallback(() => {
    setMode("blende");
    // Schimmer erst NACH der Blende abschalten: Er liegt dahinter, und während das Bild
    // halb durchsichtig ist, soll dahinter nicht plötzlich leere Fläche stehen.
    // Danach ist er wirklich weg, nicht nur verdeckt: Eine Endlos-Animation hinter jedem
    // geladenen Foto kostet auf einer Seite mit ~70 Karten dauerhaft Rechenzeit.
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSkeleton(false), FADE_MS);
  }, []);

  useIsoLayoutEffect(() => {
    const m = mitglied.current;
    verlasse(m);
    clearTimeout(timer.current);
    m.fertig = false;
    m.allein = false;
    m.zeigen = zeigen;
    zu.current = false;

    if (idle) {
      setMode("offen");
      setSkeleton(false);
      return;
    }

    // Zeigt das Bild schon etwas? Dann NICHTS anfassen und auch keine Welle aufhalten.
    // `complete` allein genügt nicht, es ist auch bei einem fehlgeschlagenen Bild true.
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) {
      setMode("offen");
      setSkeleton(false);
      return;
    }

    // Nichts zu sehen -> Tor zu (für das Auge folgenlos) und Schimmer stehen lassen.
    zu.current = true;
    setMode("zu");
    setSkeleton(true);
    if (img && imBild(img)) trittBei(m);
    else m.allein = true;

    return () => {
      verlasse(m);
      clearTimeout(timer.current);
    };
    // src in den Abhängigkeiten: Die Karussells tauschen ihre Karten aus (Sommer/Winter),
    // React benutzt dabei dasselbe <img> mit neuer Quelle weiter. Ohne Rücksetzen bliebe
    // die Kachel auf "fertig" stehen.
  }, [src, idle, zeigen]);

  const angekommen = () => {
    const m = mitglied.current;
    m.fertig = true;
    if (!zu.current) return; // Tor war nie zu, es gibt nichts einzublenden
    if (m.welle) pruefe(m.welle);
    else zeigen(); // allein: Nachzügler oder ausserhalb des Bildes
  };

  return {
    /** An das <img>/<Image> hängen (für die Prüfung "zeigt schon etwas"). */
    ref,
    /** Klasse für die Kachel hinter dem Bild. */
    skeletonClassName: skeleton ? "sg-skeleton" : "",
    /** Klassen fürs Bild selbst. Den Übergang trägt NUR die Blende, nie das geschlossene
     *  Tor: Stünde er schon dort, blendete das Zuziehen beim Hydrieren über eine halbe
     *  Sekunde aus (gemessen: 1 -> 0,03 -> 1). Für das Auge folgenlos, solange das Bild
     *  leer ist, aber ein Bild, das mitten hinein fertig wird, sackte sichtbar ab. */
    imageClassName:
      mode === "offen"
        ? ""
        : mode === "zu"
          ? "opacity-0"
          : "transition-opacity duration-500 ease-[var(--sg-ease-ui)] opacity-100",
    /** Beide an das Bild hängen: Ein kaputtes Bild darf nicht ewig schimmern und auch
     *  keine Welle aufhalten. */
    onLoad: angekommen,
    onError: angekommen,
  };
}
