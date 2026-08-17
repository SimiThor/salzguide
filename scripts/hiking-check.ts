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
import { hoursInText, fieldHours, difficultyInText, widersprichtDenFeldern } from "./wp-import/facts-in-text.ts";
import { factDuration } from "../src/lib/facts-i18n.ts";

import { LOCALES } from "../src/i18n/locales.ts";

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

console.log("\n7. Zeitangaben in allen 13 Sprachen finden (facts-in-text.ts)");
{
  // JEDE Zeile hier stand einmal ungefunden in der Datenbank. Ein Parser, der eine Angabe
  // übersieht, meldet keinen Widerspruch — die Prüfung sagt dann „alles gut" und der falsche
  // Satz bleibt stehen. Genau so sind vierzehn Spots mit alten Zahlen durchgerutscht.
  const F: [string, string, number][] = [
    // Grundformen: Ziffer und Zahlwort
    ["de", "Gut sieben Stunden für hin und zurück.", 7],
    ["en", "A good seven hours there and back.", 7],
    ["it", "Sette ore abbondanti tra andata e ritorno.", 7],
    ["nl", "Ruim zeven uur heen en terug.", 7],
    ["es", "Siete horas largas ida y vuelta.", 7],
    ["pt", "Umas boas sete horas ida e volta.", 7],
    ["pl", "Dobre siedem godzin tam i z powrotem.", 7],
    ["cs", "Dobrých sedm hodin tam a zpátky.", 7],
    ["sk", "Dobrých sedem hodín tam a späť.", 7],
    ["hu", "Jó hét óra oda-vissza.", 7],
    ["ko", "왕복 일곱 시간입니다.", 7],
    ["zh", "往返七小时。", 7],
    // „und ein halb": dreizehn Sprachen, dreizehn Bauweisen
    ["de", "Hin und zurück sind das dreizehneinhalb Stunden.", 13.5],
    ["en", "There and back that is thirteen and a half hours.", 13.5],
    // Englisch stellt die Einheit auch VOR die Haelfte, mit oder ohne Artikel.
    ["en", "A good hour and a half there and back.", 1.5],
    ["en", "An hour and a half there and back.", 1.5],
    // Deutsch schiebt das Beiwort zwischen Zahl und Einheit.
    ["de", "Ohne den See bist du in einer knappen Stunde durch.", 1],
    ["de", "Rechne eine gute Stunde fuer den Rundweg.", 1],
    ["it", "Andata e ritorno sono tredici ore e mezza.", 13.5],
    ["nl", "Heen en terug zijn dat dertieneneenhalf uur.", 13.5],
    // Niederlaendisch baut die halbe Stunde auf vier Arten zusammen. Die Trema-Formen
    // fielen durch, und der Hochkeil-Spiegelsee stand deshalb gar nicht auf der Liste.
    ["nl", "Ruim tweeenhalf uur heen en terug.".replace("tweeenhalf", "twee\u00ebnhalf"), 2.5],
    ["nl", "Drieeneenhalf uur.".replace("Drieeneenhalf", "Drie\u00ebneenhalf"), 3.5],
    ["nl", "Viereneenhalf uur heen en terug.", 4.5],
    ["fr", "Aller-retour, ça fait treize heures et demie.", 13.5],
    ["es", "Ida y vuelta son trece horas y media.", 13.5],
    ["pt", "Ida e volta são treze horas e meia.", 13.5],
    ["pl", "Tam i z powrotem to trzynaście i pół godziny.", 13.5],
    ["cs", "Tam a zpátky je to třináct a půl hodiny.", 13.5],
    ["sk", "Tam a späť je to trinásť a pol hodiny.", 13.5],
    ["hu", "Oda-vissza ez tizenhárom és fél óra.", 13.5],
    ["ko", "왕복 열세 시간 반입니다.", 13.5],
    ["zh", "往返十三个半小时。", 13.5],
    // Französisch stellt das Adjektiv ZWISCHEN Zahl und Einheit und elidiert das Substantiv.
    // Vier französische Texte behielten deshalb stumm die alte Zahl.
    ["fr", "On revient par le même chemin, trois bonnes heures en tout.", 3],
    ["fr", "À pied, une bonne dizaine d'heures aller-retour.", 10],
    ["fr", "Presque quatre heures aller-retour.", 4],
    // Chinesisch: vor der Zahl steht fast immer ein Han-Zeichen. Eine pauschale CJK-Sperre
    // verschluckte die Angabe komplett.
    ["zh", "开车的话一小时，每人五欧。", 1],
    ["zh", "往返十一小时。", 11],
    // Minuten als WORT. Jeder Spot unter einer Stunde war blind, bis das hier ging.
    ["de", "F\u00fcnfzig Minuten f\u00fcr hin und zur\u00fcck.", 50 / 60],
    ["en", "Forty minutes there and back.", 40 / 60],
    ["it", "Quaranta minuti andata e ritorno.", 40 / 60],
    ["nl", "Veertig minuten heen en terug.", 40 / 60],
    ["fr", "Quarante minutes aller-retour.", 40 / 60],
    ["es", "Cuarenta minutos ida y vuelta.", 40 / 60],
    ["pt", "Quarenta minutos ida e volta.", 40 / 60],
    ["pl", "Czterdzie\u015bci minut tam i z powrotem.", 40 / 60],
    ["cs", "\u010cty\u0159icet minut tam a zp\u00e1tky.", 40 / 60],
    ["sk", "\u0160tyridsa\u0165 min\u00fat tam a sp\u00e4\u0165.", 40 / 60],
    ["hu", "Negyven perc oda-vissza.", 40 / 60],
    ["ko", "\uc655\ubcf5 \uc0ac\uc2ed \ubd84.", 40 / 60],
    ["zh", "\u5f80\u8fd4\u56db\u5341\u5206\u949f\u3002", 40 / 60],
    // Slowakisch und Tschechisch schreiben die Zusammensetzung ohne Leerzeichen.
    ["sk", "Dvadsa\u0165p\u00e4\u0165 min\u00fat tam a sp\u00e4\u0165.", 25 / 60],
    // Ein Beiwort ZWISCHEN Zahl und Einheit, in jeder Sprache anders gebaut.
    ["en", "A good hour for the loop from the top station.", 1],
    ["en", "a good half hour, flat and easy", 0.5],
    ["nl", "Een ruim uur heen en terug.", 1],
    ["cs", "dobr\u00e1 p\u016flhodina, po rovin\u011b", 0.5],
    ["sk", "dobr\u00e1 polhodina, po rovine", 0.5],
    ["it", "Un'oretta abbondante andata e ritorno.", 1],
    // Uhrzeit-Kurzform und polnischer Genitiv, beide drei Durchgaenge lang unsichtbar.
    ["fr", "1,9 km, environ 1h30, 219 m\u00e8tres.", 1.5],
    ["pl", "1,9 km, oko\u0142o godziny, 219 metr\u00f3w.", 1],
    // Auslassung: die zweite Zahl steht ohne Einheitswort da. Deutsch konnte das laengst,
    // die anderen Sprachen nicht, und der Pruefer meldete vier richtige Uebersetzungen.
    ["fr", "En boucle compl\u00e8te, une bonne heure et demie.", 1.5],
    ["hu", "Nagyj\u00e1b\u00f3l egy \u00f3ra, fot\u00f3sz\u00fcnetekkel ink\u00e1bb m\u00e1sf\u00e9l.", 1.5],
    ["pl", "Jaka\u015b godzina, z postojami raczej p\u00f3\u0142torej.", 1.5],
    ["nl", "Ongeveer een uur, met fotostops eerder anderhalf.", 1.5],
    ["zh", "\u4ece\u4e0a\u7ad9\u8d70\u4e00\u5708\u4e00\u4e2a\u591a\u5c0f\u65f6\u3002", 1],
    ["zh", "\u7ed5\u6e56\u4e00\u5708\u534a\u4e2a\u591a\u5c0f\u65f6\u3002", 0.5],
    // Koreanisch: „열세" (13) darf nicht als „세" (3) gelesen werden.
    ["ko", "왕복 열세 시간, 아주 긴 산행입니다.", 13],
    ["ko", "위에서 두 시간 걷습니다.", 2],
  ];
  for (const [lang, satz, wert] of F) {
    const werte = hoursInText(satz, lang);
    const treffer = werte.some((w) => Math.abs(w - wert) < 0.01);
    if (treffer) ok(`${lang} ${wert} in "${satz.slice(0, 42)}…"`);
    else bad(`${lang} findet ${wert} nicht`, `"${satz}" -> ${JSON.stringify(werte)}`);
  }

  // Gegenprobe: Eine kurze Fundstelle INNERHALB einer langen darf nicht mitzaehlen. In
  // „half an hour" steckt „an hour", in „un'ora e mezza" steckt „un'ora". Zaehlte die kurze
  // mit, haette der Text eine Stunde, die niemand geschrieben hat, und ein echter
  // Widerspruch koennte sich dahinter verstecken.
  {
    const paare: [string, string, number[]][] = [
      ["en", "It takes half an hour there and back.", [0.5]],
      ["it", "Un'ora e mezza per l'anello.", [1.5]],
      ["zh", "\u5f80\u8fd4\u5341\u4e09\u4e2a\u534a\u5c0f\u65f6\u3002", [13.5]],
    ];
    for (const [lang, satz, want] of paare) {
      const got = hoursInText(satz, lang).map((x) => Math.round(x * 60));
      const soll = want.map((x) => Math.round(x * 60));
      const gleich = got.length > 0 && got.every((x) => soll.includes(x));
      if (gleich) ok(`${lang} nur ${soll.join("/")} min in "${satz.slice(0, 30)}\u2026"`);
      else bad(`${lang} liest zu viel`, `"${satz}" -> ${JSON.stringify(got)} statt ${JSON.stringify(soll)}`);
    }
  }

  // Gegenprobe: „열세 시간" darf NICHT zusätzlich als 3 gelesen werden, sonst passt am Ende
  // irgendein Wert immer und die Prüfung wird blind.
  if (!hoursInText("왕복 열세 시간입니다.", "ko").includes(3)) ok("ko liest 열세 nicht als 세");
  else bad("ko liest 열세 als 세", "Wortgrenze nach links fehlt");

  // Feldwert lesen: „1,5 Std" wurde einmal als 5 Stunden gelesen (Regex ohne Dezimalstelle).
  const felder: [string, number][] = [
    ["1,5 Std", 1.5],
    ["7 Std", 7],
    ["4,5 Std", 4.5],
    ["45 min", 0.75],
    ["1 Std 30 min", 1.5],
  ];
  for (const [f, want] of felder) {
    const got = fieldHours(f);
    if (got !== null && Math.abs(got - want) < 0.01) ok(`Feld "${f}" -> ${got}`);
    else bad(`Feld "${f}"`, `erwartet ${want}, bekommen ${got}`);
  }
}


console.log("\n8. Schwierigkeit im Fliesstext (facts-in-text.ts)");
{
  // Die Einstufung eroeffnet ihren Satz. Alles andere ist eine Aussage ueber das Gelaende,
  // und die darf NICHT als Einstufung zaehlen. Jede Zeile hier stand so in der Datenbank.
  const JA: [string, string, string[]][] = [
    ["de", "Mittelschwer: markiert und ohne technische Stellen.", ["mittel"]],
    ["de", "Schwer, technisch harmlos, aber die Kondition musst du mitbringen.", ["schwer"]],
    ["de", "Leicht bis mittel: Kondition brauchst du kaum.", ["leicht", "mittel"]],
    ["en", "Hard, technically harmless.", ["schwer"]],
    ["it", "Difficolt\u00e0 alta: alcuni tratti ripidi.", ["schwer"]],
    ["fr", "Facile \u00e0 moyen : il ne faut presque pas de condition.", ["leicht", "mittel"]],
    ["es", "Dificultad alta: algunos tramos empinados.", ["schwer"]],
    ["nl", "Makkelijk tot middelzwaar, de klim is gematigd.", ["leicht", "mittel"]],
    ["pl", "\u0141atwa do \u015bredniej: kondycji prawie nie potrzebujesz.", ["leicht", "mittel"]],
    ["pl", "\u015arednio trudna: oznakowana.", ["mittel"]],
    ["cs", "T\u011b\u017ek\u00e9: p\u00e1r strm\u00fdch pas\u00e1\u017e\u00ed.", ["schwer"]],
    ["ko", "\uc26c\uc6c0\uc5d0\uc11c \ubcf4\ud1b5 \uc0ac\uc774\uc785\ub2c8\ub2e4.", ["leicht", "mittel"]],
    ["zh", "\u96be\u5ea6\u5927\uff1a\u867d\u7136\u6709\u6807\u8bb0\u3002", ["schwer"]],
  ];
  for (const [lang, satz, want] of JA) {
    const got = difficultyInText(satz, lang).sort();
    if (JSON.stringify(got) === JSON.stringify([...want].sort())) ok(`${lang} ${got.join("+")} in "${satz.slice(0, 34)}\u2026"`);
    else bad(`${lang} "${satz.slice(0, 40)}"`, `erwartet ${JSON.stringify(want)}, bekommen ${JSON.stringify(got)}`);
  }

  // Und die Gegenprobe: Gelaende-Aussagen, Halbstunden und Verneinungen sind KEINE Stufe.
  const NEIN: [string, string][] = [
    ["en", "Hardly anyone goes down to the crypt."],
    ["en", "In the first minute it gets steep."],
    ["nl", "Het pad is anderhalve kilometer lang."],
    ["en", "There is nothing strenuous about it."],
    ["en", "Technically easy, but alpine terrain: basic fitness."],
    ["es", "Media hora basta para la nave."],
    ["it", "Il sentiero in s\u00e9 \u00e8 tecnicamente facile e ben segnato."],
    ["fr", "Le chemin lui-m\u00eame est techniquement facile et bien balis\u00e9."],
    ["hu", "Maga az \u00fat technikailag k\u00f6nny\u0171 \u00e9s j\u00f3l jelzett."],
    ["ko", "\uc2ac\ub85c\ud504\ub294 \ub300\uccb4\ub85c \uc911\uae09\uc774\uace0 \uace0\uc0b0 \uc9c0\ub300\uc785\ub2c8\ub2e4."],
  ];
  for (const [lang, satz] of NEIN) {
    const got = difficultyInText(satz, lang);
    if (!got.length) ok(`${lang} keine Stufe in "${satz.slice(0, 34)}\u2026"`);
    else bad(`${lang} liest eine Stufe, wo keine steht`, `"${satz}" -> ${JSON.stringify(got)}`);
  }
}


console.log("\n9. Wie die Dauer angezeigt wird (facts-i18n.ts)");
{
  // Die Zahl im Faktenkasten muss in derselben Schreibweise stehen wie die Kilometer im
  // Höhenprofil daneben. Neun der dreizehn Sprachen schreiben mit Komma; vorher lief alles
  // ausser Deutsch pauschal auf den Punkt, und die polnische Seite zeigte „5.5 h" über
  // „12,8 kilometra".
  for (const l of LOCALES) {
    const erwartet = new Intl.NumberFormat(l.bcp47).format(5.5);
    const got = factDuration("5,5 Std", l.code) ?? "";
    const einheit = l.code === "de" ? "Std" : "h";
    if (got === `${erwartet} ${einheit}`) ok(`${l.code} 5,5 Std -> ${got}`);
    else bad(`${l.code} Dauer-Schreibweise`, `erwartet "${erwartet} ${einheit}", bekommen "${got}"`);
  }
  // Ganze Minuten haben keine Nachkommastelle und dürfen sich nicht verändern.
  for (const l of LOCALES) {
    const got = factDuration("35 min", l.code);
    if (got === "35 min") ok(`${l.code} 35 min unverändert`);
    else bad(`${l.code} Minutenangabe`, `bekommen "${got}"`);
  }
}


console.log("\n10. Riegel gegen zurückgeschriebene Korrekturen (fix-text-claims.ts)");
{
  // Am 17.08.2026 hat ein Eintrag in fix-text-claims.ts einen ganzen Absatz zurückgeschrieben,
  // der noch die alte Gehzeit trug, und damit eine frisch korrigierte Zahl überschrieben.
  // Aufgefallen ist es nur, weil der Audit danach lief. Seitdem prüft das Skript jeden Text
  // vor dem Schreiben gegen die Felder des Spots. Diese Prüfung prüft den Riegel.
  const spot = { duration: "9 Std", difficulty: "schwer", route_geojson: {} };
  const faelle: [string, string, boolean][] = [
    [
      "alte Dauer im Absatz",
      "Hin und zurück sind das dreizehneinhalb Stunden, also ein sehr langer Bergtag.",
      true,
    ],
    ["aktuelle Dauer", "Hin und zurück sind das neun Stunden, also ein sehr langer Bergtag.", false],
    ["alte Stufe", "Neun Stunden für hin und zurück. Mittelschwer, technisch harmlos.", true],
    ["aktuelle Stufe", "Neun Stunden für hin und zurück. Schwer, technisch harmlos.", false],
    ["gar keine Angabe", "Am Gipfel steht die Gamskarkogelhütte.", false],
    [
      "Teilzeit darunter ist erlaubt",
      "Neun Stunden für hin und zurück. Auf der Hütte reicht eine halbe Stunde.",
      false,
    ],
  ];
  for (const [name, text, sollGreifen] of faelle) {
    const k = widersprichtDenFeldern(text, spot);
    if (Boolean(k) === sollGreifen) ok(`${name}: ${k ? "abgefangen" : "durchgelassen"}`);
    else bad(`Riegel bei "${name}"`, sollGreifen ? "hätte greifen müssen" : `greift fälschlich: ${k}`);
  }
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
