"use client";

import { useInsertionEffect, useRef, type RefObject } from "react";

// Hält einen Wert (Prop, Callback, State) in einem Ref, der immer den neuesten Stand
// zeigt. Gedacht für langlebige Fremd-Handler — vor allem Mapbox: die Karte wird EINMAL
// aufgebaut, ihre Event-Handler leben danach weiter und würden sonst ewig die Props vom
// ersten Render sehen (veralteter Closure).
//
// Warum ein eigener Hook statt der Kurzform?
//
//   const onSetRef = useRef(onSet);
//   onSetRef.current = onSet;        // <- Zuweisung mitten im Render
//
// Das war an ~30 Stellen so geschrieben und ist unter React 19 nicht mehr erlaubt
// (react-hooks/refs). Grund: React darf ein Rendering abbrechen und verwerfen, im
// StrictMode rendert es zusätzlich doppelt. Der Ref behielte den geschriebenen Wert
// trotzdem — er gehört dann zu einem Render, den es nie gegeben hat.
//
// useInsertionEffect statt useEffect ist hier Absicht: es läuft als Erstes im Commit,
// noch vor allen Layout- und normalen Effects. Damit sehen auch die Effects in derselben
// Komponente (Karte aufbauen, Marker setzen, Route zeichnen) bereits den frischen Wert.
// Mit useEffect wäre die Reihenfolge von der Deklarationsreihenfolge abhängig und damit
// eine Falle für später. Es ist dasselbe Muster, mit dem React selbst useEffectEvent
// nachbildet.
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
