import mapboxgl from "mapbox-gl";

/**
 * Kantenlänge eines Karten-Bedienknopfs, plus dem Rand, den Mapbox um die Gruppe legt.
 *
 * GEZEICHNET wird die Grösse in globals.css über `--sg-map-ctrl` (40px, wie bei Google
 * Maps; die 4px bis zu Apples 44 kommen dort unsichtbar dazu). Diese Zahl hier ist die
 * JS-Seite derselben Sache: Sie sagt den Karten, wie viel Rand sie beim Einpassen
 * freihalten müssen, damit Marker NEBEN den Knöpfen landen und nicht darunter. CSS kann
 * kein TypeScript lesen, deshalb stehen sie an zwei Orten — wer die eine ändert, muss
 * die andere mitnehmen, und beide Kommentare sagen es.
 */
export const MAP_CTRL_SIZE = 40;
/** Knopf + Aussenabstand der Gruppe (10px) + etwas Luft, damit nichts anklebt. */
export const MAP_CTRL_PAD = MAP_CTRL_SIZE + 22;

// Eigener "Zentrieren"-Button (docs/10) im nativen Mapbox-Control-Stil.
// Wird auf der Explore-/Detail-Karte UND im Admin-Picker genutzt.
export class RecenterControl implements mapboxgl.IControl {
  private onClick: () => void;
  private container?: HTMLDivElement;
  constructor(onClick: () => void) {
    this.onClick = onClick;
  }
  onAdd() {
    const div = document.createElement("div");
    div.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Zentrieren";
    btn.setAttribute("aria-label", "Zentrieren");
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden><path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9"/><path d="M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9"/><path d="M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15"/></svg>';
    btn.addEventListener("click", this.onClick);
    div.appendChild(btn);
    this.container = div;
    return div;
  }
  onRemove() {
    this.container?.remove();
  }
}

// "Vollbild"-Button (Karte gross öffnen). Eigenes Overlay (kein natives Fullscreen,
// da iOS Safari das für DIVs nicht unterstützt) -> Klick ruft den Callback.
export class FullscreenControl implements mapboxgl.IControl {
  private onClick: () => void;
  private container?: HTMLDivElement;
  constructor(onClick: () => void) {
    this.onClick = onClick;
  }
  onAdd() {
    const div = document.createElement("div");
    div.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Vollbild";
    btn.setAttribute("aria-label", "Vollbild");
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    // Diagonalpfeile (maximize) — klar unterscheidbar vom Zentrieren-Rahmen
    btn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    btn.addEventListener("click", this.onClick);
    div.appendChild(btn);
    this.container = div;
    return div;
  }
  onRemove() {
    this.container?.remove();
  }
}
