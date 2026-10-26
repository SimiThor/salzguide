"use server";

import { viewerCanSeePro } from "./spots";
import { saveUserTour } from "./user-tours";
import { buildAndSaveTour } from "./tour-generate-core";
import { routing } from "@/i18n/routing";
import type { TourDetail } from "./tour-types";

// KI-Runden-Generator, Web-Eingang. Die Arbeit (Claude-Auswahl, Reihenfolge, BRouter-Runde,
// Audio, Speichern) steckt in tour-generate-core.ts, damit die App-API sie mitbenutzt. Dieses
// "use server"-Modul exportiert nichts Neues: Jede exportierte Funktion ist ein oeffentlicher
// Eingang, den jeder direkt aufrufen kann.
//
// BAUEN IST PRO-ONLY (Anton, 07/2026). Vorher galt „Bauen gratis, 2 Stops hören": Jede
// Generierung kostet aber echtes Geld (Claude + Routendienst), und ein Gratis-Konto konnte
// beliebig viele Läufe auslösen, ohne dass je ein Cent zurückkommt. Free bekommt die
// kuratierten Runden mit ihren Gratis-Stops (free_stops); die eigene Runde ist das
// Pro-Argument. /touren/bauen zeigt Nicht-Pro dafür die Kauf-Fläche; der Riegel HIER
// gilt zusätzlich, weil eine Server-Action jeder direkt aufrufen kann.

const DE = "de";

export type GenerateInput = {
  areaId: string;
  interests: string[]; // gewählte Interessen-Labels
  freeText: string;
  maxStops?: number;
  locale: string;
};

export async function generateTour(
  input: GenerateInput,
): Promise<{ ok: boolean; tour?: TourDetail; id?: string; error?: string }> {
  // Volle Locale nutzen (nicht auf en/de stauchen) – so werden Titel & Audio der Punkte in der
  // gewählten Sprache geladen; unbekannte Werte fallen sicher auf Deutsch zurück.
  const locale = (routing.locales as readonly string[]).includes(input.locale)
    ? input.locale
    : DE;
  const canSeePro = await viewerCanSeePro();
  if (!canSeePro) return { ok: false, error: "pro" };

  const r = await buildAndSaveTour({
    areaId: input.areaId,
    interests: input.interests,
    freeText: input.freeText,
    maxStops: input.maxStops,
    locale,
    canSeePro,
    save: saveUserTour,
  });
  if (!r.ok) return r;
  return { ok: true, tour: r.tour, id: r.id };
}
