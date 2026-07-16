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
// Truth im Aufrufer). Alle setState-Aufrufe liegen in Media-Event-Listenern -> kein
// react-hooks/set-state-in-effect-Verstoß. 1:1 aus dem alten AudioPlayer extrahiert,
// damit Player-Leiste, Peek und Desktop-Panel dieselbe eine Quelle teilen.
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
  const playIntentRef = useRef(false);
  const endedRef = useRef<() => void>(() => {});
  useEffect(() => {
    endedRef.current = () => {
      setPlaying(false);
      // Nächsten Stopp AUSWÄHLEN, aber NICHT automatisch abspielen – der User geht
      // erst zum nächsten Ort und drückt dann selbst Play.
      playIntentRef.current = false;
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

  // Quelle bei Stop-Wechsel tauschen (kein synchrones setState im Effect-Body).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const s = stops[index];
    if (!s || s.locked || !s.audioUrl) {
      playIntentRef.current = false;
      a.pause(); // feuert "pause" -> setPlaying(false); load() allein tut das nicht
      a.removeAttribute("src");
      a.load();
      return;
    }
    a.src = s.audioUrl;
    a.load();
    if (playIntentRef.current) a.play().catch(() => setPlaying(false));
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
      if (a.paused) {
        playIntentRef.current = true;
        a.play().catch(() => setPlaying(false));
      } else {
        playIntentRef.current = false;
        a.pause();
      }
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
