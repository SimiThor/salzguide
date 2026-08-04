// Maße des Spot-Kopfbilds, geteilt zwischen page.tsx (echtes Hero) und loading.tsx
// (Skelett): Beide Kästen müssen exakt gleich groß sein, sonst springt die Seite in
// dem Moment, in dem die echten Daten das Skelett ablösen.
//
// Höhe aus der BREITE, nicht aus der Viewport-Höhe (Fall 1 in globals.css unter
// "VIEWPORT-HÖHE"): Vorher stand hier h-[42svh], und in Browsern, die svh beim Ein-
// und Ausfahren ihrer Leisten doch mitbewegen, wuchs und schrumpfte das Foto beim
// Scrollen. 75vw entspricht am Handy dem alten Maß (390px breit -> ~300px hoch),
// die px-Deckel halten Tablet und Desktop im bisherigen Rahmen.
export const HERO_BOX = "h-[clamp(300px,75vw,460px)] w-full";
