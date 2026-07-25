"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Auf dem Server gibt es kein Layout, useLayoutEffect warnt dort. Auf dem Client MUSS es
// useLayoutEffect sein: Ob ein Foto schon etwas zeigt, muss VOR dem ersten Paint
// feststehen, sonst blinkt es.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// WIE FOTOS AUF DIESER PLATTFORM ERSCHEINEN. Eine Regel, ein Ort.
//
// Das Ziel: Beim Aufbau einer Ansicht erscheinen die Fotos GEMEINSAM und weich. Kein
// einzelnes Aufpoppen, kein Aufblitzen mit Ladeschirm hinterher.
//
// DREI TEILE:
//
// 1. SCHIMMER-KACHEL + WARTE-KLASSE stehen im Server-HTML. Ein Foto ist also vom ersten
//    Bild an verdeckt, auch wenn es lange vor React fertig lädt. Genau daran ist die
//    erste Fassung gescheitert: Wer das Tor erst beim Hydrieren zuzieht, lässt schnelle
//    Fotos einzeln aufpoppen und langsame hinterherhinken.
// 2. DIE WELLE: Alle Fotos, die im selben Moment sichtbar warten, erscheinen zusammen,
//    sobald das letzte da ist.
// 3. DER CSS-RIEGEL: Die Warte-Klasse blendet sich nach 2s von selbst ein (globals.css).
//    Deshalb darf Teil 1 überhaupt im Server-HTML stehen: Hängt das JavaScript, wartet
//    kein Foto länger als zwei Sekunden. Gemessen war genau das der Schaden der ersten
//    Fassung: Foto fertig nach 2,8s, JavaScript erst nach 6,1s.
//
// UND DIE GNADENFRIST (Teil 2b): Kommt ein Foto aus dem Cache – beim Zurücknavigieren
// etwa – ist es innerhalb von zwei Frames da. Dann wird gar kein Tor zugezogen und gar
// kein Schimmer gezeigt: Wer ein Foto schon gesehen hat, soll es nicht noch einmal
// laden sehen. Ohne diese Frist blitzte beim Zurückkommen kurz der Schimmer auf.
const GNADENFRIST_MS = 40;
// Mindestdauer, die ein Schimmer zu sehen sein muss, sonst zappelt er selbst.
const MIN_SCHIMMER_MS = 400;
// Wie lange eine Welle höchstens auf ihr langsamstes Foto wartet.
const WELLE_FRIST_MS = 1200;
// Dauer der Einblendung. Muss zur `duration-500`-Klasse unten passen, und zu der
// Animation in globals.css. Die Kurve (--sg-ease-ui) ist für alle Blenden dieselbe.
const FADE_MS = 500;

// Ist die Seite schon hydriert? Ab dann mounten Komponenten aus dem Router (weiche
// Navigation), und für die gilt die Gnadenfrist statt des Server-Tors.
let hydriert = false;

type Mode = "frei" | "zu" | "blende";

// ---------------------------------------------------------------------------
// DIE WELLE
//
// Modulweiter Zustand, also EINE Welle für die ganze Seite: Die Fotos wissen nichts
// voneinander, sie melden sich nur an derselben Stelle an. Billiger als ein Context
// (kein Provider, kein Re-Render) und über Regal-Grenzen hinweg richtig, denn "sichtbar"
// ist eine Eigenschaft des Bildschirms, nicht der Komponente.
// ---------------------------------------------------------------------------
type Mitglied = { fertig: boolean; welle: Welle | null; zeigen: () => void };

type Welle = {
  mitglieder: Set<Mitglied>;
  offen: boolean;
  erledigt: boolean;
  /** Ab wann der Schimmer dieser Welle zu sehen ist (für MIN_SCHIMMER). */
  sichtbarSeit: number;
  frist: number;
};

let offeneWelle: Welle | null = null;

// Seit wann ist überhaupt etwas auf dem Schirm? Der Schimmer der ersten Ansicht steht
// schon im Server-HTML, ist also seit dem ersten Anstrich zu sehen. Ohne diese Zahl
// hinge an jedem Seitenaufbau eine geschenkte halbe Sekunde: Die Welle würde ihre
// Mindestdauer erst ab dem Hydrieren zählen, obwohl der Schimmer längst stand.
function ersterAnstrich() {
  const p = performance.getEntriesByType("paint");
  const fcp = p.find((e) => e.name === "first-contentful-paint");
  return fcp ? fcp.startTime : 0;
}

function trittBei(m: Mitglied, ausDemServerHtml: boolean) {
  let w = offeneWelle;
  if (!w) {
    w = {
      mitglieder: new Set(),
      offen: true,
      erledigt: false,
      sichtbarSeit: ausDemServerHtml ? ersterAnstrich() : performance.now(),
      frist: 0,
    };
    offeneWelle = w;
    const neu = w;
    // Bis zum nächsten Frame sammeln: Alle Fotos, die beim Hydrieren ihr Tor schliessen,
    // tun das im selben Durchgang und gehören damit automatisch zusammen.
    requestAnimationFrame(() => {
      neu.offen = false;
      if (offeneWelle === neu) offeneWelle = null;
      pruefe(neu);
    });
    neu.frist = window.setTimeout(() => aufloesen(neu), MIN_SCHIMMER_MS + WELLE_FRIST_MS);
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

function pruefe(w: Welle) {
  if (w.offen || w.erledigt) return;
  for (const m of w.mitglieder) if (!m.fertig) return;
  const rest = MIN_SCHIMMER_MS - (performance.now() - w.sichtbarSeit);
  if (rest > 0) {
    window.setTimeout(() => pruefe(w), rest);
    return;
  }
  aufloesen(w);
}

// Welle auflösen: Wer fertig ist, erscheint jetzt. Wer nicht, macht ab sofort sein
// eigenes Ding, sonst hielte ein hängendes Foto die ganze Reihe im Schimmer fest.
function aufloesen(w: Welle) {
  if (w.erledigt) return;
  w.erledigt = true;
  clearTimeout(w.frist);
  if (offeneWelle === w) offeneWelle = null;
  for (const m of w.mitglieder) {
    m.welle = null;
    if (m.fertig) m.zeigen();
  }
  w.mitglieder.clear();
}

// Steht das Foto gerade im Bild? Nur solche warten aufeinander: Eines zehn Regale weiter
// unten lädt gar nicht erst (lazy) und würde die Welle bis zur Frist offen halten.
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

// Zeigt das Bild schon etwas? NICHT `complete` fragen: Das ist false, sobald eine zweite
// srcset-Fassung nachgeladen wird, obwohl die erste längst gemalt ist. Genau daran hing
// das Aufblitzen mit Ladeschirm danach. naturalWidth gehört zur AKTUELL angezeigten
// Fassung und bleibt stehen, solange eine neue lädt.
function zeigtSchon(img: HTMLImageElement | null) {
  return !!img && img.naturalWidth > 0;
}

/**
 * Zustand fürs weiche, gemeinsame Erscheinen EINES Fotos. Gibt zurück, was Bild und
 * Kachel brauchen; damit erscheinen alle Fotos der Plattform gleich.
 * Benutzt von SmoothImage (Karten, Sheets), GalleryImage und LockedMedia.
 *
 * @param priority Nur fürs LCP-Bild einer Detailseite: nie ein Tor, nie eine Welle.
 */
export function useImageReveal(src: string | null | undefined, priority = false) {
  const idle = priority || !src;
  // Server-HTML und der Hydrations-Render müssen dasselbe liefern, sonst verwirft React
  // den Baum. Erst spätere Mounts (weiche Navigation) starten offen.
  const ausDemServerHtml = typeof window === "undefined" || !hydriert;
  const ref = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<Mode>(!idle && ausDemServerHtml ? "zu" : "frei");
  const [skeleton, setSkeleton] = useState(!idle && ausDemServerHtml);
  const timer = useRef(0);
  const mitglied = useRef<Mitglied>({ fertig: false, welle: null, zeigen: () => {} });

  const zeigen = useCallback(() => {
    setMode("blende");
    // Schimmer erst NACH der Blende abschalten: Er liegt dahinter, und während das Foto
    // halb durchsichtig ist, soll dahinter nicht plötzlich leere Fläche stehen. Danach
    // ist er wirklich weg, nicht nur verdeckt: Eine Endlos-Animation hinter jedem
    // geladenen Foto kostet auf einer Seite mit ~70 Karten dauerhaft Rechenzeit.
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSkeleton(false), FADE_MS);
  }, []);

  // Frei schalten: kein Tor, kein Schimmer, keine Blende. Für alles, was ohnehin schon
  // zu sehen ist.
  const frei = useCallback(() => {
    setMode("frei");
    setSkeleton(false);
  }, []);

  useIsoLayoutEffect(() => {
    hydriert = true;
    const m = mitglied.current;
    verlasse(m);
    clearTimeout(timer.current);
    m.fertig = false;
    m.zeigen = zeigen;
    if (idle) {
      frei();
      return;
    }

    const img = ref.current;
    // Schon zu sehen -> nichts anfassen. Der häufigste Fall beim Zurücknavigieren.
    if (zeigtSchon(img)) {
      frei();
      return;
    }

    // Gnadenfrist: Vielleicht liegt das Foto im Cache und ist in zwei Frames da. Dann
    // soll niemand einen Schimmer gesehen haben. Aus dem Server-HTML heraus ist das Tor
    // ohnehin schon zu, dort kostet die Frist nichts.
    let abgebrochen = false;
    const entscheiden = () => {
      if (abgebrochen) return;
      if (zeigtSchon(ref.current)) {
        frei();
        return;
      }
      // Nichts zu sehen -> Tor zu (für das Auge folgenlos) und auf die Welle warten.
      setMode("zu");
      setSkeleton(true);
      if (ref.current && imBild(ref.current)) trittBei(m, ausDemServerHtml);
    };
    if (ausDemServerHtml) entscheiden();
    else timer.current = window.setTimeout(entscheiden, GNADENFRIST_MS);

    return () => {
      abgebrochen = true;
      verlasse(m);
      clearTimeout(timer.current);
    };
    // src in den Abhängigkeiten: Die Karussells tauschen ihre Karten aus (Sommer/Winter),
    // React benutzt dabei dasselbe <img> mit neuer Quelle weiter.
  }, [src, idle, ausDemServerHtml, zeigen, frei]);

  const angekommen = () => {
    const m = mitglied.current;
    m.fertig = true;
    if (m.welle) pruefe(m.welle);
    // Ohne Welle (ausserhalb des Bildes, Nachzügler nach der Frist): allein einblenden.
    else if (mode !== "frei") zeigen();
  };

  return {
    /** An das <img>/<Image> hängen (für die Prüfung "zeigt schon etwas"). */
    ref,
    /** Klasse für die Kachel hinter dem Bild. */
    skeletonClassName: skeleton ? "sg-skeleton" : "",
    /** Klassen fürs Bild selbst.
     *  "zu" ist die CSS-Klasse aus globals.css, NICHT opacity-0: Nur so trägt der
     *  wartende Zustand seinen eigenen CSS-Riegel mit (blendet sich nach 2s selbst ein).
     *  Den Übergang trägt nur die Blende, nie das geschlossene Tor: Stünde er schon
     *  dort, blendete das Zuziehen sichtbar aus statt sofort zu greifen. */
    imageClassName:
      mode === "frei"
        ? ""
        : mode === "zu"
          ? "sg-img-wait"
          : "transition-opacity duration-500 ease-[var(--sg-ease-ui)] opacity-100",
    /** Beide an das Bild hängen: Ein kaputtes Bild darf keine Welle aufhalten. */
    onLoad: angekommen,
    onError: angekommen,
  };
}
