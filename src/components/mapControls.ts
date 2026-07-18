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
const MAP_CTRL_SIZE = 40;
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

