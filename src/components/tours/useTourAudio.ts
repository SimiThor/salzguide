"use client";

import { useEffect, useRef, useState } from "react";

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
  seek: (v: number) => void;
  go: (i: number) => void;
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
    const s = stops[index];
    a.pause();
    // Zustand hier DIREKT setzen statt auf das "pause"-Event zu warten: Der
    // Quellenwechsel unten (src/load) verwirft laut HTML-Spec alle noch nicht
    // ausgelieferten Media-Events – das "pause" von oben käme also nie an, und der
    // Button bliebe auf "Pause" stehen, obwohl nichts mehr läuft.
    setPlaying(false);
    if (!s || s.locked || !s.audioUrl) {
      a.removeAttribute("src");
      a.load();
      return;
    }
    a.src = s.audioUrl;
    a.load();
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
      if (!a || !stop || stop.locked || !stop.audioUrl) return;
      if (a.paused) a.play().catch(() => setPlaying(false));
      else a.pause();
    },
    seek(v: number) {
      setTime(v);
      const a = audioRef.current;
      if (a) a.currentTime = v;
    },
    go(i: number) {
      onIndex(Math.max(0, Math.min(stops.length - 1, i)));
    },
    beginSeek() {
      seekingRef.current = true;
    },
    endSeek() {
      seekingRef.current = false;
    },
  };
}
