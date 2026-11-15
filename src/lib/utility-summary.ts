import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "./supabase/service";
import { startOfViennaDayIso } from "./events-format";
import type { UtilitySummary } from "./utility-summary-types";
import { freshLakes, getWaterMaps } from "./water-temp";

// Kleine, für alle Besucher gleiche Zusammenfassung für die zwei Einstiegs-Karten im
// Explore-Sheet: gibt es kommende Events, und in welcher Spanne liegen die gemessenen
// Seetemperaturen. Keine Texte, keine Betrachter-Abhängigkeit, deshalb Service-Client
// (kein Cookie-Zugriff) und ein gemeinsamer Cache über alle Besucher.
async function loadEvents(): Promise<boolean> {
  try {
    const now = new Date();
    // Dieselbe Auswahl wie getUpcomingEvents (lib/events.ts), nur als Zählung.
    const { count, error } = await createServiceClient()
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .or(
        `ends_at.gte.${now.toISOString()},and(ends_at.is.null,starts_at.gte.${startOfViennaDayIso(now)})`,
      );
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function loadWater(): Promise<UtilitySummary["water"]> {
  try {
    // Dieselben Funktionen wie die Seite /wasser: nur Seen mit aktueller, plausibler Messung.
    const lakes = freshLakes(await getWaterMaps(), {}, Date.now());
    if (lakes.length === 0) return null;
    const temps = lakes.map((l) => Math.round(l.tempC));
    return { min: Math.min(...temps), max: Math.max(...temps) };
  } catch {
    return null;
  }
}

export const getUtilitySummary = unstable_cache(
  async (): Promise<UtilitySummary> => {
    const [hasEvents, water] = await Promise.all([loadEvents(), loadWater()]);
    return { hasEvents, water };
  },
  ["utility-summary-v1"],
  { revalidate: 300 },
);
