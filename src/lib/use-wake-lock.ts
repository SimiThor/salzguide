"use client";

import { useEffect, useRef } from "react";

// Hält den Bildschirm wach, solange `active` true ist – ohne das schläft das Handy in
// der S-Bike-Halterung nach der üblichen Sperrzeit ein, mitten in der Navigation. Die
// Wake Lock API gibt die Sperre selbst frei, sobald der Tab in den Hintergrund geht
// (App-Wechsel, Bildschirm sperren); das `visibilitychange`-Listener holt sie beim
// Zurückkommen wieder. Fehlt die API (älteres Safari/iOS) oder schlägt die Anfrage fehl:
// stiller No-op – kein Absturz, die Navigation läuft nur ohne den Wach-Schutz weiter.
export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let cancelled = false;
    const acquire = async () => {
      // `released` statt nur `lockRef.current`: Der Ref sagt bloß, dass wir irgendwann
      // einmal eine Sperre bekommen haben, nicht ob sie noch gilt. Genau daran hing der
      // Fehler, den diese Zeile behebt (siehe Kommentar am release-Listener unten).
      if (lockRef.current && !lockRef.current.released) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        // Das System gibt die Sperre von sich aus frei, sobald der Tab in den Hintergrund
        // geht, und setzt dabei NICHT unseren Ref zurück. Ohne diesen Listener zeigte er
        // danach dauerhaft auf ein totes Sentinel, die Prüfung oben sah "haben wir schon"
        // und der Bildschirm schlief ab dem ersten App-Wechsel jedes Mal wieder ein.
        lock.addEventListener("release", () => {
          if (lockRef.current === lock) lockRef.current = null;
        });
        lockRef.current = lock;
      } catch {
        // z.B. Tab war beim Anfragen schon im Hintergrund – beim nächsten
        // visibilitychange (sichtbar) wird es erneut versucht.
      }
    };

    void acquire();
    const onVisible = () => {
      // Ohne eigene Ref-Prüfung: acquire() entscheidet oben selbst, ob eine gültige
      // Sperre schon da ist. Eine Bedingung an zwei Stellen wäre eine zu viel.
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lockRef.current?.release();
      lockRef.current = null;
    };
  }, [active]);
}
