import mapboxgl from "mapbox-gl";

/**
 * Kantenlänge eines Karten-Bedienknopfs, plus dem Rand, den Mapbox um die Gruppe legt.
 *
 * GEZEICHNET wird die Grösse in globals.css über `--sg-map-ctrl` (34px am Finger,
 * 32px am Zeiger; bis zu Apples 44 kommt am Finger unsichtbar dazu). Hier steht der
 * GRÖSSERE der beiden Werte, denn der Rand muss den breitesten Fall abdecken. Diese Zahl hier ist die
 * JS-Seite derselben Sache: Sie sagt den Karten, wie viel Rand sie beim Einpassen
 * freihalten müssen, damit Marker NEBEN den Knöpfen landen und nicht darunter. CSS kann
 * kein TypeScript lesen, deshalb stehen sie an zwei Orten — wer die eine ändert, muss
 * die andere mitnehmen, und beide Kommentare sagen es.
 */
const MAP_CTRL_SIZE = 34;
/** Knopf + Aussenabstand der Gruppe (10px) + etwas Luft, damit nichts anklebt. */
export const MAP_CTRL_PAD = MAP_CTRL_SIZE + 22;

// Eigener "Zentrieren"-Button (docs/10) im nativen Mapbox-Control-Stil.
// Wird auf der Explore-/Detail-Karte UND im Admin-Picker genutzt.
//
// DAS SYMBOL: ein Rahmen mit gerundeten Ecken und einem Punkt in der Mitte —
// „alles wieder ins Bild, mittig". Vorher standen hier vier lose Klammern ohne
// Mittelpunkt: Das las sich als Sucherrahmen und sagte dasselbe wie das
// Standort-Fadenkreuz darunter. Zwei Symbole, die beide „Zielen" bedeuten,
// unterscheidet niemand auf 34px.
//
// GEZEICHNET IN DER HAUSSCHRIFT: 24er-Raster, stroke-width 1.75, runde Enden —
// exakt die Werte aus components/icons.tsx („Schlankes Apple-Style-Line-Icon-Set").
// Die alten 2.4 waren der eigentliche Grund, warum der Knopf klobig wirkte: Er war
// das einzige Symbol der App in einer fremden Strichstärke.
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
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.25"/></svg>';
    btn.addEventListener("click", this.onClick);
    div.appendChild(btn);
    this.container = div;
    return div;
  }
  onRemove() {
    this.container?.remove();
  }
}

