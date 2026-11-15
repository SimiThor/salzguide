// Eigene Datei ohne server-only: Die Client-Komponente braucht den Typ, ein Typ-Import
// aus lib/utility-summary.ts (server-only) risse sie mit in den Server-Graph.
export type UtilitySummary = {
  hasEvents: boolean;
  /** Gerundete Spanne der aktuell gemessenen Seen in ganzen Grad, null = keine Messung. */
  water: { min: number; max: number } | null;
};
