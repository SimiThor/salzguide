// Behauptungen, die ein Mensch bereits nachgeschlagen hat. Der Audit laesst sie danach weg.
//
// WARUM ES DIESE LISTE GIBT: Der Block NACHSCHLAGEN in wp:audit listet Angaben auf, die das
// System selbst nicht pruefen kann - Jahreszahlen, Hoehen, Superlative, Preise, Buslinien.
// Ohne Gedaechtnis erscheinen dieselben vierunddreissig Zeilen bei jedem Lauf, auch die
// laengst geprueften. Eine Liste, die sich nie leert, liest beim dritten Mal niemand mehr,
// und dann faellt auch die neue Zeile darin nicht mehr auf.
//
// GEPRUEFT AM 17.08.2026: fuenfunddreissig Behauptungen, jede einzeln recherchiert und jedes
// zweifelhafte Urteil unabhaengig gegengeprueft. Einunddreissig bestaetigt, drei waren gar
// keine Faktenansprueche, eine war falsch: Der Schuhflickersee liegt auf rund 2.040 Metern,
// nicht auf 2.100 (amtlicher BEV-Hoehendienst, korrigiert in fix-text-numbers.ts).
//
// VERAENDERLICH heisst: Preis, Fahrplan oder Oeffnungszeit. Solche Angaben tauchen nach
// einem Jahr wieder auf der Liste auf, weil sie dann neu belegt gehoeren.
export type GeprueftesFaktum = {
  slug: string;
  /** Wie im Audit: Jahreszahl, Hoehe, Superlativ, Preis, Buslinie. */
  art: string;
  /** Datum der Pruefung, ISO. */
  am: string;
  /** Die Quelle, an der es haengt. Damit die naechste Pruefung nicht bei null anfaengt. */
  quelle: string;
  /** Preise, Fahrplaene, Oeffnungszeiten: nach einem Jahr wieder vorlegen. */
  veraenderlich?: boolean;
  hinweis?: string;
};

/** Nach einem Jahr gilt eine veraenderliche Angabe wieder als ungeprueft. */
export const HALTBAR_TAGE = 365;

export const GEPRUEFT: GeprueftesFaktum[] = [
  { slug: "almgreisslerei", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://salzburg-verkehr.at/downloads/obus-5-groedig-birkensiedlung-zentrum-hauptbahnhof-itzling-pflanzmann-4/" },
  { slug: "almkanal", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://salzburg-verkehr.at/downloads/obus-5-groedig-birkensiedlung-zentrum-hauptbahnhof-itzling-pflanzmann-4/" },
  { slug: "balkan-grill-walter", art: "Jahreszahl", am: "2026-08-17", quelle: "https://www.salzburg.info/de/magazin/schauplaetze/balkan-grill-salzburg-die-heimat-der-original-salzburger-bosna_a_10952136" },
  { slug: "balkan-grill-walter", art: "Superlativ", am: "2026-08-17", quelle: "https://www.salzburg.info/de/magazin/schauplaetze/balkan-grill-salzburg-die-heimat-der-original-salzburger-bosna_a_10952136" },
  { slug: "bondlsee", art: "Superlativ", am: "2026-08-17", quelle: "https://wiki.sn.at/wiki/B%C3%B6ndlsee", hinweis: "kein Faktenanspruch, sondern eine Ortsbeschreibung" },
  { slug: "early-winter-mountainkart", art: "Preis", am: "2026-08-17", veraenderlich: true, quelle: "https://www.gasteinertal.com/winter-mountaincart/" },
  { slug: "festung-hohensalzburg", art: "Superlativ", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Festung_Hohensalzburg" },
  { slug: "fuschlsee-steg", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://salzburg-verkehr.at/downloads/regionalbus-150-150x-salzburg-koppl-hof-fuschl-st-gilgen-strobl-bad-ischl-2/" },
  { slug: "gaisberg", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://www.salzburg-ag.at/bus-bahn/freizeit-tourismus/gaisbergbus.html" },
  { slug: "gamskarkogel", art: "Superlativ", am: "2026-08-17", quelle: "https://www.gastein.com/ski-berge/gasteiner-bergwelt/gamskarkogel/" },
  { slug: "goldbergbahn", art: "Superlativ", am: "2026-08-17", quelle: "https://www.skiamade.com/en/ski-areas/gastein/sportgastein" },
  { slug: "groser-barmstein", art: "Höhe", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Barmsteine" },
  { slug: "jagersee", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://salzburg-verkehr.at/wp-content/uploads/2026/04/Aushang-95-530-j26-21_R1.pdf" },
  { slug: "krimmler-wasserfalle", art: "Superlativ", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Krimmler_Wasserf%C3%A4lle" },
  { slug: "lackenkogel", art: "Höhe", am: "2026-08-17", quelle: "https://www.flachau.com/en/tours/flachau-lackenkogel-73.html" },
  { slug: "lammerklamm", art: "Jahreszahl", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Lammer%C3%B6fen" },
  { slug: "landgasthof-lammerklause", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://salzburg-verkehr.at/downloads/regionalbus-470-hallein-golling-abtenau-russbach-gosau/" },
  { slug: "landgasthof-lammerklause", art: "Jahreszahl", am: "2026-08-17", quelle: "https://www.lammerklause.at/" },
  { slug: "landgasthof-lammerklause", art: "Preis", am: "2026-08-17", veraenderlich: true, quelle: "https://www.lammerklause.at/wp-content/uploads/2026/06/Lammerklause_Speisekarte_26_06_26.pdf" },
  { slug: "leopoldskroner-weiher", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://wiki.sn.at/wiki/Hofhaymer-Allee_(Haltestelle)" },
  { slug: "mondi-alm", art: "Höhe", am: "2026-08-17", quelle: "https://www.gastein.mondihotels.com/en/cuisine/bellevue-alm/" },
  { slug: "panoramakugel-sportgastein", art: "Superlativ", am: "2026-08-17", quelle: "https://www.skiamade.com/de/skigebiete/gastein/sportgastein" },
  { slug: "postalm", art: "Superlativ", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Postalm" },
  { slug: "postalm", art: "Superlativ", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Postalm" },
  { slug: "rossfeld-panoramastrase", art: "Superlativ", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Ro%C3%9Ffeldh%C3%B6henringstra%C3%9Fe", hinweis: "kein Faktenanspruch, sondern eine Ortsbeschreibung" },
  { slug: "schafberg", art: "Höhe", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Schafberg_(Salzkammergut-Berge)" },
  {
    slug: "schuhflickersee",
    art: "Höhe",
    am: "2026-08-17",
    quelle: "https://transformator.bev.gv.at/at.gv.bev.transformator/api/height/singleHeight?point=13.148333,47.264167",
    hinweis:
      "Stand 2.100 m, amtlich sind 2.041,6 m (BEV-Höhendienst, am Gipfel gegengeprüft). " +
      "Korrigiert auf 2.040 in fix-text-numbers.ts. Der See liegt katastermäßig in St. Veit " +
      "im Pongau; „über Großarl“ bleibt, weil die Tour dort startet und der Satz die " +
      "Blickrichtung meint, nicht die Gemeindegrenze.",
  },
  { slug: "schlosspark-hellbrunn", art: "Buslinie", am: "2026-08-17", veraenderlich: true, quelle: "https://www.hellbrunn.at/en/info/opening-hours-prices-arrival" },
  { slug: "stubnerkogel", art: "Höhe", am: "2026-08-17", quelle: "https://www.gastein.com/service/gastein-von-a-z/detail/infrastruktur/haengebruecke-am-stubnerkogel-bad-gastein/" },
  { slug: "stubnerkogelbahn", art: "Superlativ", am: "2026-08-17", quelle: "https://www.gastein.com/blog/resort-check-schlossalm-angertal-stubnerkogel/" },
  { slug: "zwolferhorn", art: "Höhe", am: "2026-08-17", quelle: "https://de.wikipedia.org/wiki/Zw%C3%B6lferhorn" },
];

/** Steht diese Behauptung als geprueft in der Liste, und ist die Pruefung noch gueltig? */
export function istGeprueft(slug: string, art: string, heute = new Date()): boolean {
  const e = GEPRUEFT.find((x) => x.slug === slug && x.art === art);
  if (!e) return false;
  if (!e.veraenderlich) return true;
  const tage = (heute.getTime() - Date.parse(e.am)) / 86400000;
  return tage <= HALTBAR_TAGE;
}
