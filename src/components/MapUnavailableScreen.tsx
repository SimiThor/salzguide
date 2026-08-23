"use client";

import { useTranslations } from "next-intl";

/**
 * Ruhige Fläche statt Karte. Gleiche Lage im Kasten wie der Ladeschirm (z-30).
 *
 * WARUM DAS EINE EIGENE DATEI IST, und das ist der ganze Grund: Der Hinweis wird genau
 * dann gebraucht, wenn Mapbox NICHT da ist. Stünde er weiter in MapUnavailable.tsx, zöge
 * jeder Import von ihm `mapbox-gl` mit (die Datei braucht es für tryCreateMap) — der
 * Ersatz hinge also an dem, wofür er der Ersatz ist. MapLoading.tsx zeigt ihn nach
 * abgelaufener Frist an und darf deshalb nichts von Mapbox wissen.
 *
 * MapUnavailable.tsx reicht ihn weiter, damit die Karten ihn wie bisher von dort holen.
 */
export function MapUnavailableScreen() {
  const t = useTranslations("Map");
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-cream p-6">
      <div className="max-w-[30ch] text-center">
        <div aria-hidden className="mb-2 text-2xl">
          🗺️
        </div>
        <p className="text-sm leading-snug text-muted">{t("unavailable")}</p>
      </div>
    </div>
  );
}
