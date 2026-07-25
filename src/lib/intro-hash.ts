// Erkennt, ob ein gespeichertes Intro-Video noch zur aktuellen Route passt.
// Ändert sich die Route (oder der Look des Renderers), ändert sich der Hash, und der
// Admin sieht "Intro veraltet, neu rendern". Bewusst geteilt zwischen dem Render-Skript
// (schreibt den Hash) und der App (vergleicht), damit beide Seiten dasselbe rechnen.

// Hochzählen, wenn sich die OPTIK des Renderers ändert (z.B. Terrain-Überhöhung, Zoom,
// Wasserzeichen), damit bestehende Intros als veraltet gelten und neu gerendert werden.
export const INTRO_STYLE_VERSION = "21";

// FNV-1a (32-bit): stabil, deterministisch, ohne Abhängigkeit und identisch in Node und
// Browser (kein crypto nötig). Reicht als Änderungs-Erkennung völlig.
export function introSourceHash(routeGeojson: unknown): string {
  const s = `${INTRO_STYLE_VERSION}:${JSON.stringify(routeGeojson ?? null)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// „Ist für diesen Spot ein Render fällig?" Kein Video oder ein Hash, der nicht mehr passt.
// Die eine Quelle für diese Frage: Admin-Liste, Server-Action und der Planer im Workflow
// müssen sich einig sein. Weichen sie ab, stehen Zeilen auf „in Warteschlange", hinter
// denen nie ein Render kommt, oder es wird gerendert, was längst aktuell ist.
export function introNeedsRender(
  routeGeojson: unknown,
  videoUrl: string | null | undefined,
  storedHash: string | null | undefined,
): boolean {
  return !videoUrl || introSourceHash(routeGeojson) !== (storedHash ?? "");
}
