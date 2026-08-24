"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoFix } from "./bike-nav-core";

export type GeoStatus =
  | "idle"
  | "requesting"
  | "watching"
  | "denied"
  | "unavailable"
  | "signal-lost";

// GPS-Strom für die S-Bike-Navigation. Bewusst ein eigener, schlanker Hook statt eines
// generischen "useGeolocation": bike-nav-core.ts braucht GENAU die Felder von GeoFix
// (inkl. Kurs/Tempo für die Fahrtrichtung), und `start()` MUSS aus einer Nutzer-Geste
// aufgerufen werden – iOS Safaris Erlaubnis-Dialog erscheint sonst gar nicht erst. Der
// Hook startet deshalb nie von selbst; der "Navigation starten"-Knopf ist die Geste.
export function useGeolocationWatch(): {
  fix: GeoFix | null;
  status: GeoStatus;
  start: () => void;
  stop: () => void;
} {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const watchIdRef = useRef<number | null>(null);

  const clearWatch = useCallback(() => {
    if (watchIdRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearWatch();
    setStatus("idle");
  }, [clearWatch]);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    if (watchIdRef.current != null) return; // läuft schon
    setStatus("requesting");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("watching");
        setFix({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracyM: pos.coords.accuracy,
          headingDeg: pos.coords.heading,
          speedMps: pos.coords.speed,
          at: pos.timestamp,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          clearWatch();
          setStatus("denied");
        } else {
          // TIMEOUT/POSITION_UNAVAILABLE: letzten Fix behalten, weiter beobachten – ein
          // kurzer Empfangsverlust (Tunnel, Häuserschlucht) soll die Navigation nicht
          // beenden, nur sichtbar machen, dass der Fix gerade veraltet.
          setStatus((s) => (s === "denied" || s === "unavailable" ? s : "signal-lost"));
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }, [clearWatch]);

  // Aufräumen beim Verlassen des Screens – sonst liefe der Watch (und der GPS-Chip)
  // weiter, auch wenn die Navigation längst nicht mehr sichtbar ist.
  useEffect(() => clearWatch, [clearWatch]);

  return { fix, status, start, stop };
}
