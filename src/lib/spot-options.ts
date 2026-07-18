// Die Auswahllisten des Spot-Admins — abgeleitet aus facts-i18n.json.
//
// WARUM ABGELEITET UND NICHT GETIPPT: Vorher standen dieselben Listen zweimal im Code, einmal
// als Dropdown in SpotForm.tsx und einmal als Übersetzungstabelle. Die beiden sind
// auseinandergelaufen, und zwar lautlos: „See" und „Cafe" liessen sich auswählen, hatten aber
// keine Übersetzung, also stand in jeder Sprache Deutsch da. Solange die Liste aus der Tabelle
// kommt, KANN eine auswählbare Option ohne Übersetzung nicht mehr existieren.
//
// Reihenfolge ist bewusst die der JSON-Gruppen (nach Häufigkeit/Region sortiert, nicht
// alphabetisch): Was man beim Anlegen am öftesten braucht, steht oben.
import facts from "./facts-i18n.json" with { type: "json" };

const DATA = facts as unknown as {
  SUBTYPE_GROUPS: Record<string, string[]>;
  AREA_GROUPS: Record<string, string[]>;
  SEASON: Record<string, unknown>;
  FAME: Record<string, unknown>;
  DIFFICULTY: Record<string, unknown>;
  DURATION: Record<string, unknown>;
};

// Unterkategorie: hartes Dropdown, deshalb nach Spot-Typ getrennt. Die Gruppen sind zugleich
// die <optgroup>-Überschriften im Formular.
export const SUBTYPE_GROUPS_ACTIVITY = Object.fromEntries(
  Object.entries(DATA.SUBTYPE_GROUPS).filter(([g]) => !g.startsWith("Food:")),
);
export const SUBTYPE_GROUPS_FOOD = Object.fromEntries(
  Object.entries(DATA.SUBTYPE_GROUPS)
    .filter(([g]) => g.startsWith("Food:"))
    .map(([g, list]) => [g.replace(/^Food:\s*/, ""), list]),
);

export const subtypeGroups = (isFood: boolean) =>
  isFood ? SUBTYPE_GROUPS_FOOD : SUBTYPE_GROUPS_ACTIVITY;

/** Alle gültigen Unterkategorien eines Typs — flach, für Validierung. */
export const subtypesFor = (isFood: boolean) => Object.values(subtypeGroups(isFood)).flat();

// Gegend: bewusst KEIN hartes Dropdown. Das Salzburger Land hat mehr Orte, als eine Liste
// je vollständig abbilden kann; ein Riegel würde nur dazu führen, dass ein passender Ort gar
// nicht eingetragen wird. Stattdessen: viele Vorschläge + Warnung im Formular, wenn der
// getippte Wert keine Übersetzung hat.
export const AREA_GROUPS = DATA.AREA_GROUPS;
export const AREAS = Object.values(DATA.AREA_GROUPS).flat();

export const BEST_SEASONS = Object.keys(DATA.SEASON);
export const FAME_LEVELS = Object.keys(DATA.FAME);
export const DIFFICULTIES = Object.keys(DATA.DIFFICULTY);
export const DURATION_WORDS = Object.keys(DATA.DURATION);

// Preisniveau ist sprachneutral und steht deshalb nicht in der Übersetzungstabelle.
// Label nur fürs Dropdown — gespeichert wird immer das €-Zeichen.
export const PRICE_LEVELS: [string, string][] = [
  ["€", "€ · günstig"],
  ["€€", "€€ · mittel"],
  ["€€€", "€€€ · gehoben"],
];

export const ACCESS_OPTIONS: [string, string][] = [
  ["oeffis", "Öffis"],
  ["auto", "Auto"],
  ["beides", "Öffis & Auto"],
];
