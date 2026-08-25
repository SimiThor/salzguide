"use client";

import { useEffect, useRef, useState } from "react";

// WER ENTSCHEIDET, OB ETWAS ABGESPIELT WIRD: der SERVER, ueber `audioUrl`.
//
// Hier stand frueher zusaetzlich `stop.locked ||` vor jedem Abspielen. Das war eine zweite
// Entscheidung an der falschen Stelle, denn die erste faellt in lib/tours.ts: Ein offener
// Stopp bekommt eine signierte URL auf die Volldatei, ein gesperrter eine auf die KOSTPROBE,
// und wer nichts bekommen darf, bekommt null. Mit dem zusaetzlichen `locked` blieb die
// Kostprobe stumm, obwohl der Server sie ausdruecklich freigegeben hatte.
//
// `locked` bleibt als Feld, aber nur noch fuer die Oberflaeche: Sie zeigt daran, ob hier
// eine Kostprobe laeuft oder die ganze Geschichte.
export type PlayerStop = {
  order: number;
  title: string;
  audioUrl: string | null;
  locked: boolean;
  durationSec: number | null;
};

export type TourAudioApi = {
  playing: boolean;
  time: number;
  max: number;
  toggle: () => void;
  /**
   * Anhalten, ohne die Stelle zu verlieren. `toggle()` waere hier falsch: Es STARTET,
   * wenn gerade nichts laeuft, und genau das ist beim Schliessen oder beim Wechsel auf
   * einen anderen Stopp das Gegenteil dessen, was gemeint ist.
   */
  pause: () => void;
  seek: (v: number) => void;
  go: (i: number) => void;
  // Auf einen Stopp wechseln UND ihn im selben Tastendruck starten. Fuer den Play-Knopf
  // im Fahrmodus: go() allein ist ein React-Zustandswechsel, der erst im naechsten Render
  // greift, ein toggle() direkt danach spricht also noch die ALTE Datei an.
  playAt: (i: number) => void;
  beginSeek: () => void;
  endSeek: () => void;
};

// EIN wiederverwendetes HTMLAudioElement, gesteuert über `index` (Single Source of
// Truth im Aufrufer). setState läuft in der Regel über Media-Event-Listener; einzige
// Ausnahme ist der Stop-Wechsel, dessen "pause" der Quellenwechsel verwirft (siehe
// dort). 1:1 aus dem alten AudioPlayer extrahiert, damit Player-Leiste, Peek und
// Desktop-Panel dieselbe eine Quelle teilen.
//
// Grundregel: Abgespielt wird NUR auf Druck des Users (toggle). Kein Weg, der den
// Stopp wechselt, startet Audio von selbst.
export function useTourAudio(
  stops: PlayerStop[],
  index: number,
  onIndex: (i: number) => void,
): TourAudioApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Welcher Stopp steckt GERADE im Element? Trennt "der Aufrufer hat den Index gewechselt"
  // von "die Quelle haengt schon richtig", was playAt() unten braucht.
  const srcIndexRef = useRef<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(stops[index]?.durationSec ?? 0);
  const seekingRef = useRef(false);
  const endedRef = useRef<() => void>(() => {});
  useEffect(() => {
    endedRef.current = () => {
      // "ended" feuert kein "pause" -> playing hier selbst zurücksetzen.
      setPlaying(false);
      // Nächsten Stopp nur AUSWÄHLEN; das Abspielen bleibt beim User (siehe Effect unten).
      if (index < stops.length - 1) onIndex(index + 1);
    };
  });

  // Element einmalig auf Mount erzeugen (nicht während SSR/Render).
  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    audioRef.current = a;
    const onTime = () => {
      if (!seekingRef.current) setTime(a.currentTime);
    };
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onLoadStart = () => {
      setTime(0);
      setDuration(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => endedRef.current();
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("loadstart", onLoadStart);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("loadstart", onLoadStart);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    };
  }, []);

  // Quelle bei Stop-Wechsel tauschen und dabei immer pausiert landen.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // Haengt die Quelle schon auf diesem Stopp, weil playAt() sie gerade synchron gesetzt
    // und gestartet hat? Dann hier nichts tun. Ohne diese Zeile pausiert der Effekt genau
    // die Geschichte wieder weg, die der Gast eben angetippt hat.
    if (srcIndexRef.current === index) return;
    const s = stops[index];
    a.pause();
    // Zustand hier DIREKT setzen statt auf das "pause"-Event zu warten: Der
    // Quellenwechsel unten (src/load) verwirft laut HTML-Spec alle noch nicht
    // ausgelieferten Media-Events – das "pause" von oben käme also nie an, und der
    // Button bliebe auf "Pause" stehen, obwohl nichts mehr läuft.
    setPlaying(false);
    if (!s || !s.audioUrl) {
      a.removeAttribute("src");
      a.load();
      srcIndexRef.current = -1;
      return;
    }
    a.src = s.audioUrl;
    a.load();
    srcIndexRef.current = index;
    // Bewusst KEIN play(): Der Guide startet nie von selbst – egal ob der Track
    // ausgelaufen ist, der User die Pfeile nutzt oder einen Stopp in Liste/Karte
    // antippt. Man geht erst zum Ort und drückt dort selbst Play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const stop = stops[index];
  const max = duration || stop?.durationSec || 0;

  return {
    playing,
    time,
    max,
    toggle() {
      const a = audioRef.current;
      if (!a || !stop || !stop.audioUrl) return;
      if (a.paused) a.play().catch(() => setPlaying(false));
      else a.pause();
    },
    pause() {
      const a = audioRef.current;
      if (a && !a.paused) a.pause();
    },
    seek(v: number) {
      setTime(v);
      const a = audioRef.current;
      if (a) a.currentTime = v;
    },
    go(i: number) {
      onIndex(Math.max(0, Math.min(stops.length - 1, i)));
    },
    // Wechseln und starten in EINEM Tastendruck. Die Quelle wird hier synchron gesetzt,
    // nicht erst im Effekt: Nur so bleibt der Nutzergesten-Kontext erhalten, den iOS fuer
    // play() verlangt, und nur so spricht das play() die richtige Datei an.
    //
    // Die Grundregel bleibt unangetastet: Abgespielt wird ausschliesslich auf Druck des
    // Users. playAt() wird nur aus dem Play-Knopf gerufen, kein Weg, der bloss den Stopp
    // wechselt (Pfeile, Track zu Ende, Antippen in Liste oder Karte), landet hier.
    playAt(i: number) {
      const idx = Math.max(0, Math.min(stops.length - 1, i));
      const target = stops[idx];
      const a = audioRef.current;
      onIndex(idx);
      if (!a || !target || !target.audioUrl) return;
      if (srcIndexRef.current !== idx) {
        a.src = target.audioUrl;
        a.load();
        srcIndexRef.current = idx;
      }
      void a.play().catch(() => setPlaying(false));
    },
    beginSeek() {
      seekingRef.current = true;
    },
    endSeek() {
      seekingRef.current = false;
    },
  };
}
