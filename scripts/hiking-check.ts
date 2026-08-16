// Prüft die Wanderzeit-Formel gegen veröffentlichte Tourenzeiten. Aufruf:
//   npm run hiking:check
//
// WARUM ES DIESE PRÜFUNG GIBT: Die Formel war schon einmal falsch, und zwar unauffällig.
// Sie rechnete nach DIN 33466 (300 Hm/h auf, 500 ab) plus einem ungedeckelten Pausen-Puffer
// und lag damit 50 bis 70 Prozent über allem, was der Gast sonst liest — Schafberg 10 Std
// statt 6, Gamskarkogel 13,5 statt 8. Niemandem im Team ist das aufgefallen, weil eine zu
// lange Zeit nicht falsch AUSSIEHT: Sie steht da wie jede andere Zahl. Gemeldet hat es ein
// Gast, der die Tour gegangen ist.
//
// Deshalb liegt hier eine Handvoll Touren, deren Zeit ausserhalb der App veröffentlicht ist,
// mit den Zahlen, die WIR gemessen haben. Wer an den Konstanten dreht, sieht sofort, ob die
// Formel noch zur Wirklichkeit passt. Es importiert die ECHTE Funktion aus src/lib, baut
// also nichts nach.
//
// TOLERANZ: 25 Prozent. Veröffentlichte Zeiten sind selbst keine Messung — dieselbe Tour
// steht bei drei Portalen mit drei Zahlen. Enger geprüft würde die Prüfung nur noch die
// Streuung der Quellen abbilden. Wir wollen wissen, ob wir im richtigen Fenster liegen,
// nicht ob wir eine bestimmte Quelle nachahmen.
import {
  hikingTimeMinutes,
  walkingTimeMinutes,
  ascentDescent,
  formatHikingDuration,
  suggestDifficulty,
  HIKE_SPEED_KMH,
  HIKE_ASCENT_MH,
  HIKE_DESCENT_MH,
} from "../src/lib/geo.ts";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};

/**
 * km/ascent/descent sind UNSERE gemessenen Werte aus dem Höhenprofil des Spots (die ganze
 * Tour, bei hin/retour also Hin- und Rückweg). `publishedH` ist die veröffentlichte Gehzeit
 * für dieselbe Runde. `source` steht dabei, damit man beim nächsten Zweifel nachlesen kann,
 * statt neu zu raten.
 */
type Reference = {
  name: string;
  km: number;
  ascent: number;
  descent: number;
  publishedH: number;
  source: string;
};

const REFERENCES: Reference[] = [
  {
    name: "Schafberg (St. Wolfgang, hin und zurück)",
    km: 15.6,
    ascent: 1253,
    descent: 1253,
    publishedH: 6.25,
    // Wegweiser 3 Std Aufstieg, Tourenbeschreibungen 3,5 Std; Abstieg ~2,5-3 Std.
    // Referenzdaten: 16 km, 1220 hm — sehr nah an unseren gemessenen 15,6 / 1253.
    source: "bergfex + rauf-und-davon.at",
  },
  {
    name: "Gamskarkogel (Bad Hofgastein, hin und zurück)",
    km: 14.9,
    ascent: 1761,
    descent: 1761,
    publishedH: 8,
    // Bergwelten: 8:00 h, 15 km, 1550 hm. Gasteinertal nennt für eine längere Variante
    // 6 Std Aufstieg + 3 Std Abstieg, also 9 — beides liegt in unserer Toleranz.
    source: "Bergwelten Tour 12754",
  },
  {
    name: "Tappenkarsee (vom Jägersee, hin und zurück)",
    km: 8.2,
    ascent: 770,
    descent: 769,
    publishedH: 3.75,
    source: "Wegweiser ~2 Std Aufstieg, ~1,5 Std Abstieg",
  },
  {
    name: "Schmittenhöhe (Zell am See, Aufstieg, Abfahrt mit der Bahn)",
    km: 7.6,
    ascent: 1207,
    descent: 102,
    publishedH: 3.75,
    source: "Tourenportale 3,5-4 Std für den Aufstieg",
  },
  {
    name: "Gollinger Wasserfall (Rundweg)",
    km: 1.3,
    ascent: 194,
    descent: 194,
    publishedH: 1,
    source: "TVB Golling: rund eine Stunde für Hin- und Rückweg",
  },
];

console.log("1. Gerechnete Dauer gegen veröffentlichte Zeiten (Toleranz 25 %)");
const TOLERANCE = 0.25;
for (const r of REFERENCES) {
  const min = hikingTimeMinutes(r.km, r.ascent, r.descent);
  const h = min / 60;
  const off = (h - r.publishedH) / r.publishedH;
  const label = `${r.name}: ${formatHikingDuration(min)} gegen ${r.publishedH} Std (${
    off >= 0 ? "+" : ""
  }${Math.round(off * 100)} %)`;
  if (Math.abs(off) <= TOLERANCE) ok(label);
  else bad(label, `${r.source}. Ausserhalb der Toleranz von ${TOLERANCE * 100} %.`);
}

console.log("\n2. Die Konstanten sind die SAC-Werte");
{
  const want = { speed: 4, up: 400, down: 800 };
  const got = { speed: HIKE_SPEED_KMH, up: HIKE_ASCENT_MH, down: HIKE_DESCENT_MH };
  if (got.speed === want.speed && got.up === want.up && got.down === want.down)
    ok(`${got.speed} km/h, ${got.up} Hm/h auf, ${got.down} Hm/h ab`);
  else
    bad(
      "Konstanten weichen ab",
      `erwartet ${JSON.stringify(want)}, bekommen ${JSON.stringify(got)}`,
    );
}

console.log("\n3. Der Pausen-Zuschlag ist gedeckelt");
{
  // Genau der Fehler, der die 13 Stunden erzeugt hat: ein Zuschlag, der linear mitwächst.
  // Bei einer sehr langen Tour darf zwischen Gehzeit und Dauer keine Stunde mehr liegen.
  const lang = { km: 30, up: 2500, down: 2500 };
  const walk = walkingTimeMinutes(lang.km, lang.up, lang.down);
  const total = hikingTimeMinutes(lang.km, lang.up, lang.down);
  const zuschlag = total - walk;
  if (zuschlag <= 30 + 1) ok(`Marathon-Tour: Gehzeit ${Math.round(walk)} min, Zuschlag ${Math.round(zuschlag)} min`);
  else bad("Zuschlag wächst unbegrenzt mit", `${Math.round(zuschlag)} min statt höchstens 30`);

  // Kurze Runde: der Zuschlag ist da, aber klein.
  const kurz = hikingTimeMinutes(2, 100, 100) - walkingTimeMinutes(2, 100, 100);
  if (kurz > 0 && kurz < 10) ok(`Kurze Runde: Zuschlag ${Math.round(kurz)} min`);
  else bad("Zuschlag bei kurzen Runden unplausibel", `${Math.round(kurz)} min`);
}

console.log("\n4. Höhenmeter: Rauschen wird verschluckt");
{
  // Eine Höhenreihe, die in Wahrheit 100 m steigt, aber meterweise zittert. Ohne Schwelle
  // summiert sich das Zittern zu Höhenmetern, die niemand geht.
  const zittern: number[] = [];
  for (let i = 0; i <= 100; i++) zittern.push(500 + i + (i % 2 === 0 ? 1.5 : -1.5));
  const { ascent, descent } = ascentDescent(zittern);
  if (ascent >= 90 && ascent <= 115) ok(`Zitternde Reihe: ${ascent} hm auf, ${descent} hm ab`);
  else bad("Rauschen landet in den Höhenmetern", `${ascent} hm statt rund 100`);

  if (ascentDescent([]).ascent === 0 && ascentDescent([500]).ascent === 0)
    ok("Leere und einpunktige Reihe ergeben 0");
  else bad("Leere Höhenreihe", "sollte 0 ergeben");
}

console.log("\n5. Schreibweise der Dauer");
{
  const cases: [number, string][] = [
    [3, "5 min"], // nie unter 5 Minuten
    [42, "40 min"],
    [58, "1 Std"], // rundet auf die Stunde statt "60 min" zu schreiben
    [95, "1,5 Std"],
    [430, "7 Std"],
    [545, "9 Std"],
  ];
  for (const [min, want] of cases) {
    const got = formatHikingDuration(min);
    if (got === want) ok(`${min} min -> ${got}`);
    else bad(`${min} min`, `erwartet "${want}", bekommen "${got}"`);
  }
}

console.log("\n6. Schwierigkeit");
{
  const cases: [number, number, string][] = [
    [1.4, 116, "leicht"], // Aignerpark
    [7.8, 488, "mittel"], // Zwölferhorn
    [8.2, 770, "mittel"], // Tappenkarsee
    [15.6, 1253, "schwer"], // Schafberg
    [14.9, 1761, "schwer"], // Gamskarkogel
    [6.9, 1178, "schwer"], // Spinnerin: kurz, aber steil
  ];
  for (const [km, up, want] of cases) {
    const got = suggestDifficulty(km, up);
    if (got === want) ok(`${km} km / ${up} hm -> ${got}`);
    else bad(`${km} km / ${up} hm`, `erwartet "${want}", bekommen "${got}"`);
  }
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
