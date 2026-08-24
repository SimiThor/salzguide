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
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        lockRef.current = lock;
      } catch {
        // z.B. Tab war beim Anfragen schon im Hintergrund – beim nächsten
        // visibilitychange (sichtbar) wird es erneut versucht.
      }
    };

    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !lockRef.current) void acquire();
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
