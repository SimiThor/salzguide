"use server";

// Aktueller Merk-Status des eingeloggten Users (Spot-slugs + Event-IDs) – damit
// die Karten im KI-Chat den echten Speicher-Zustand zeigen (auch nach Wieder-
// Öffnen). RLS über die Session -> nur die eigenen. Gast/Fehler -> leer.
import { getSavedSlugs } from "./saved";
import { getSavedEventIds } from "./events";

export async function getSavedSets(): Promise<{ spots: string[]; events: string[] }> {
  try {
    const [spots, ev] = await Promise.all([getSavedSlugs(), getSavedEventIds()]);
    return { spots: [...spots], events: ev.ids };
  } catch {
    return { spots: [], events: [] };
  }
}
