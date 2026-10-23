// Prüft den reinen Entscheidungs-Kern des Audioguides (bike-nav-core.ts, Rad UND zu Fuss)
// gegen synthetische GPS-Fix-Folgen. Aufruf:
//   npm run nav:check
//
// Die Faelle 1 bis 26 fahren mit der Rad-Tabelle (NAV), ab 27 gehen sie mit WALK_NAV: Der
// Kern ist derselbe, nur die Zahlen und das Tempo (1,4 statt 5 m/s) sind andere.
//
// WARUM ES DIESES SKRIPT GIBT: Priorität 1 der Runde ist zuverlässige Navigation (siehe
// docs/40). Ob der Play-Knopf rechtzeitig kommt, ob eine Neuberechnung feuert und ob der
// Fortschritt stimmt, entscheidet direkt darüber, ob ein Radl mitten in der Fahrt in die
// Irre geführt wird. Das lässt sich nicht "beim Testen am Handy mal kurz schauen", weil
// man dafür wirklich fahren müsste. Es importiert den ECHTEN stepNav() aus src/lib, baut
// also nichts nach.
import { turnAngle, isMereCurve, prepareSteps } from "../src/lib/nav-steps.ts";
import {
  NAV,
  WALK_NAV,
  navTuningFor,
  type NavState,
  type SpotPhase,
} from "../src/lib/bike-nav-core.ts";
import {
  run,
  driveSpec,
  applyOp,
  caseOpsOf,
  AT_SPOT_CASES_26,
  TURN_ANGLE_CASES,
  MERE_CURVE_STEPS,
  PREPARE_STEPS_RAW,
} from "./lib/nav-cases.ts";

// Die Fälle selbst (Routen, Fix-Folgen, Simulator) stehen in scripts/lib/nav-cases.ts und
// werden von scripts/nav-fixtures.ts (Swift-Gleichheit, docs/41 6.1) mitbenutzt. Hier stehen
// nur die ERWARTUNGEN.

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  failed++;
  console.log(`  FEHLT ${name}\n        ${detail}`);
};

const countOf = (evts: { type: string }[], t: string) => evts.filter((e) => e.type === t).length;

console.log("1. Saubere Fahrt über die ganze Runde");
{
  const { states, events } = run("01/clean");

  if (countOf(events, "reroute") === 0) ok("keine Neuberechnung auf der sauberen Route");
  else bad("Neuberechnung auf sauberer Route", `${countOf(events, "reroute")} statt 0`);

  if (countOf(events, "finished") === 1) ok("genau ein Ende der Runde");
  else bad("Ende der Runde", `${countOf(events, "finished")} Ereignis(se) statt 1`);

  // Jeder Spot genau einmal angeboten. Der letzte liegt 20 m vor Schluss, er wird also
  // angeboten, aber nicht mehr passiert – das ist richtig so, die Runde endet dort.
  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 3 && new Set(near).size === 3) ok("jeder der drei Spots genau einmal angeboten");
  else bad("Spot-Angebote", `${near.length} Ereignis(se): ${JSON.stringify(near)}`);

  const last = states[states.length - 1];
  if (last.spotPhase[0] === "done" && last.spotPhase[1] === "done") {
    ok("die beiden ersten Spots stehen am Ende auf erledigt");
  } else {
    bad("Spot-Phasen am Ende", JSON.stringify(last.spotPhase));
  }
}

console.log("\n2. Der Play-Knopf kommt mit dem richtigen Vorlauf");
{
  // 30 Sekunden bei 18 km/h sind 150 m (docs/40). Die Prüfung misst, bei welchem Abstand
  // das Angebot wirklich feuert – daran hängt, ob der Gast den Daumen rechtzeitig hebt.
  const { states, events } = run("02/play-lead");
  const idx = events.findIndex((e) => e.type === "spot-near");
  if (idx < 0) {
    bad("Play-Knopf erscheint nie", "kein spot-near-Ereignis");
  } else {
    // Der Zustand beim Feuern: wie weit war der Spot da noch weg?
    const atFire = states.find((s) => s.spotPhase[0] === "near");
    const ahead = atFire ? 500 - atFire.alongM : NaN;
    if (ahead <= NAV.SPOT_NEAR_M && ahead > NAV.SPOT_NEAR_M - 20) {
      ok(`Angebot bei ${ahead.toFixed(0)} m Vorlauf (Sollwert ${NAV.SPOT_NEAR_M} m)`);
    } else {
      bad("Vorlauf des Play-Knopfs", `${ahead.toFixed(0)} m statt rund ${NAV.SPOT_NEAR_M} m`);
    }
  }
}

console.log("\n3. Kein Play-Knopf, während eine Abbiegung ansteht");
{
  // Sicherheitsregel aus docs/40: Wer gleich abbiegt, bekommt nicht im selben Moment eine
  // Geschichte angeboten. Der Spot darf dadurch aber nicht verloren gehen, er kommt nach
  // der Abbiegung dran.
  const { states, events } = run("03/maneuver-quiet");

  const atFire = states.find((s) => s.spotPhase[0] === "near");
  if (!atFire) {
    bad("Spot geht durch die Sperrzone verloren", "kein spot-near-Ereignis");
  } else if (atFire.alongM > 420) {
    ok(`Angebot erst nach der Abbiegung (bei ${atFire.alongM.toFixed(0)} m)`);
  } else {
    bad("Angebot kommt in der Sperrzone", `bei ${atFire.alongM.toFixed(0)} m, Abbiegung liegt bei 420 m`);
  }
  if (countOf(events, "spot-near") === 1) ok("und nur ein einziges Mal");
  else bad("Angebot feuert mehrfach", `${countOf(events, "spot-near")} statt 1`);
}

console.log("\n4. Ein verpasster Spot blockiert die Runde nicht");
{
  // Der Gast drückt nie Play. Der Spot muss trotzdem irgendwann als erledigt gelten,
  // sonst bliebe er für immer "der nächste" und die Anzeige stünde still.
  const { states, events } = run("04/missed-spot");
  const passed = events.filter((e) => e.type === "spot-passed");
  if (passed.length === 1 && passed[0].index === 0) ok("der ungehörte Spot wird verbucht");
  else bad("verpasster Spot", `${passed.length} Ereignis(se): ${JSON.stringify(passed)}`);
  const last = states[states.length - 1];
  if (last.nextSpotIndex === -1) ok("danach steht kein Spot mehr offen");
  else bad("Spot bleibt offen", `nextSpotIndex ${last.nextSpotIndex}`);
}

console.log("\n5. Zwei Spots 50 m auseinander werden beide angeboten");
{
  // In der Altstadt der Normalfall (Residenzplatz und Domplatz). Im alten Etappen-Modell
  // hing die Runde hier fest, weil die Ankunft nie scharf wurde.
  const { events } = run("05/two-spots-50m");
  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 2 && near[0] === 0 && near[1] === 1) ok("beide Spots angeboten, in der richtigen Reihenfolge");
  else bad("Spots 50 m auseinander", `${JSON.stringify(near)} statt [0,1]`);
}

console.log("\n6. Ungenaue Fixe (>60m) werden gar nicht erst bewertet");
{
  const { states, events } = run("06/inaccurate-fixes");
  if (events.length === 0) ok("keine Ereignisse aus ungenauen Fixen");
  else bad("Ereignisse trotz schlechter Genauigkeit", JSON.stringify(events));
  if (states[states.length - 1].alongM === 0) ok("Zustand bleibt beim Ausgangswert");
  else bad("Zustand wurde verändert", `alongM ${states[states.length - 1].alongM}`);
}

console.log("\n7. Selbstkreuzende Runde: der Fortschritt darf nicht springen");
{
  // Die Altstadt-Form: 300 m hinein, wenden, auf einer nur 4 m versetzten Linie zurück.
  // Auf einer GANZEN Runde ist das keine Ausnahme mehr, sondern die Regel: eine Rundtour
  // endet dort, wo sie beginnt.
  const { states } = run("07/self-crossing");
  let worst = 0;
  for (let i = 1; i < states.length; i++) {
    const drop = states[i - 1].alongM - states[i].alongM;
    if (drop > worst) worst = drop;
  }
  if (worst <= 50) ok(`Fortschritt bleibt monoton (grösster Rückschritt ${worst.toFixed(0)} m)`);
  else bad("Fortschritt springt auf der selbstkreuzenden Runde", `Rückschritt von ${worst.toFixed(0)} m`);
}

console.log("\n8. Ein einzelner Ausreisser darf die Fahrt nicht anhalten");
{
  const { states } = run("08/outlier");
  const atOutlierIdx = driveSpec("08/outlier").meta.atOutlierIdx;
  const atOutlier = states[atOutlierIdx - 1];
  const after = states[states.length - 1];
  if (Math.abs(atOutlier.alongM - 300) < 15) ok("der Ausreisser selbst wird verworfen");
  else bad("Ausreisser wurde übernommen", `alongM ${atOutlier.alongM.toFixed(0)} m statt ~300 m`);
  if (Math.abs(after.alongM - 400) < 15) ok("danach läuft die Auswertung sofort weiter");
  else bad("Auswertung bleibt hängen", `alongM ${after.alongM.toFixed(0)} m statt ~400 m`);
}

console.log("\n9. An der roten Ampel darf sich die Karte nicht drehen");
{
  const { states } = run("09/red-light");
  let swing = 0;
  for (let i = 7; i <= 17 && i < states.length; i++) {
    const d = Math.abs(states[i].bearingDeg - states[i - 1].bearingDeg);
    const wrapped = Math.min(d, 360 - d);
    if (wrapped > swing) swing = wrapped;
  }
  if (swing <= 10) ok(`Richtung bleibt im Stand ruhig (grösster Sprung ${swing.toFixed(1)} Grad)`);
  else bad("Karte dreht sich im Stand", `Sprung von ${swing.toFixed(1)} Grad`);
}

console.log("\n10. Falschabbiegung: genau eine Neuberechnung, und zwar zügig");
{
  const { states, events } = run("10/wrong-turn");
  if (countOf(events, "reroute") === 1) ok("genau eine Neuberechnung nach der Falschabbiegung");
  else bad("Neuberechnung nach Falschabbiegung", `${countOf(events, "reroute")} statt 1`);

  const firstOff = states.findIndex((s) => s.crossTrackM > NAV.OFF_ROUTE_M);
  if (firstOff >= 0 && states.length - firstOff <= 5) {
    ok(`Neuberechnung ${states.length - firstOff} Fixe nach dem Verlassen der Route`);
  } else if (firstOff < 0) {
    bad("Off-Route wurde gar nicht erkannt", "crossTrackM blieb unter der Schwelle");
  } else {
    bad("Neuberechnung kommt zu spät", `erst ${states.length - firstOff} Fixe danach`);
  }
}

console.log("\n11. Nach einer Neuberechnung bleiben gehörte Spots gehört");
{
  // Der wichtigste Unterschied zum alten Etappen-Modell: Ein Umweg darf die halbe Runde
  // nicht noch einmal anbieten. useBikeNavigation fragt die neue Route ohne die
  // erledigten Spots an und übergibt hier die Phasen der übrigen.
  const [reset] = caseOpsOf("11");
  const kept: SpotPhase[] = ["near", "open"]; // die beiden erledigten fallen weg
  const next = applyOp(reset) as NavState;

  if (next.alongM === 0) ok("der Fortschritt beginnt auf der neuen Route bei null");
  else bad("Fortschritt nicht zurückgesetzt", `alongM ${next.alongM}`);
  if (JSON.stringify(next.spotPhase) === JSON.stringify(kept)) ok("die Phasen der übrigen Spots bleiben");
  else bad("Spot-Phasen verloren", JSON.stringify(next.spotPhase));
  if (next.nextSpotIndex === 0) ok("der angefangene Spot bleibt der nächste");
  else bad("nächster Spot falsch", `${next.nextSpotIndex} statt 0`);
  if (next.bearingDeg === 123) ok("die Fahrtrichtung bleibt (Kamera springt nicht)");
  else bad("Fahrtrichtung zurückgesetzt", `${next.bearingDeg}`);
}


// ═══════════════════════════════════════════════════════════════════════════════════
//  RUNDTOUREN
//
//  Alle Pruefungen oben fahren offene Strecken ab, meist gerade. Eine Rundtour ist aber
//  der Normalfall des Produkts, und sie hat eine Eigenschaft, die alles aendert: Ihr ENDE
//  liegt am ANFANG. Jeder falsche Schnappschuss in Startnaehe sieht deshalb aus wie ein
//  Zieleinlauf, und weil die Linie sich selbst nahe kommt, kann der Fortschritt an vielen
//  Stellen auf den falschen Ast springen.
// ═══════════════════════════════════════════════════════════════════════════════════

console.log("\n12. Rundtour: ein Ausreisser in Startnaehe beendet die Runde NICHT");
{
  // Der Gast faehrt 200 m, dann sperrt sich der Bildschirm (Safari drosselt die Ortung,
  // docs/40). Nach drei Minuten kommt ein Fix mit maessiger Genauigkeit 25 m neben dem
  // Startpunkt. Weil dort auch das ENDE der Runde liegt, sah das bisher wie ein
  // Zieleinlauf aus: alongM sprang auf fast die volle Rundenlaenge, alle Spots wurden
  // auf einen Schlag verbucht und "Runde geschafft" stand auf dem Schirm, 200 m nach dem
  // Start und ohne Weg zurueck.
  const { states, events } = run("12/loop-outlier-near-start");
  const last = states[states.length - 1];
  if (!last.finished) ok("kein Zieleinlauf aus einem Ausreisser in Startnaehe");
  else bad("Runde faelschlich beendet", `remainingM ${last.remainingM.toFixed(0)}, alongM ${last.alongM.toFixed(0)}`);

  const passed = events.filter((e) => e.type === "spot-passed").length;
  if (passed === 0) ok("kein Spot wird dabei faelschlich verbucht");
  else bad("Spot-Lawine durch den Ausreisser", `${passed} spot-passed-Ereignisse`);
}

console.log("\n13. Am Start stehen und seitlich abdriften beendet die Runde NICHT");
{
  // Der Gast schiebt sein Rad ueber den Platz zur Ampel, bevor er losfaehrt. Die Ortung
  // streut dabei bis 50 m. Direkt neben ihm liegt der Rueckweg der Runde, also die
  // Stelle mit dem groessten alongM.
  const { states } = run("13/loop-drift-at-start");
  const route = driveSpec("13/loop-drift-at-start").route;
  const last = states[states.length - 1];
  if (!last.finished) ok("kein Zieleinlauf vor dem ersten gefahrenen Meter");
  else bad("Runde beendet, bevor sie begann", `alongM ${last.alongM.toFixed(0)} von ${route.totalM}`);
  if (last.spotPhase.every((p) => p !== "done")) ok("alle Spots bleiben offen");
  else bad("Spots verbucht, obwohl nicht gefahren", JSON.stringify(last.spotPhase));
}

console.log("\n14. Falschabbiegung auf der Rundtour springt nicht auf den Rueckweg");
{
  // Die Runde benutzt dieselbe Gasse hin und zurueck (8 m versetzt). Der Gast biegt kurz
  // nach dem Start falsch ab und faehrt 90 m seitlich weg. Der Rueckweg liegt dann naeher
  // an ihm als sein eigener Streckenabschnitt, und genau dorthin sprang der Fortschritt.
  const { states, events } = run("14/loop-wrong-turn");
  const last = states[states.length - 1];
  if (!last.finished) ok("kein Zieleinlauf durch die Falschabbiegung");
  else bad("Runde durch Falschabbiegung beendet", `alongM ${last.alongM.toFixed(0)}`);
  if (countOf(events, "spot-passed") === 0) ok("kein Spot wird verbucht, der noch vor dem Gast liegt");
  else bad("Spots faelschlich verbucht", `${countOf(events, "spot-passed")} Ereignis(se)`);
  if (countOf(events, "reroute") === 1) ok("genau eine Neuberechnung");
  else bad("Neuberechnung", `${countOf(events, "reroute")} statt 1`);
}

console.log("\n15. Ein falsches \"fertig\" ist umkehrbar");
{
  // Selbst wenn der Zustand einmal auf fertig faellt, darf er nicht kleben: Wer sich
  // wieder deutlich vom Ziel entfernt, faehrt weiter. Ohne das ist jeder Fehlalarm ein
  // Totalausfall mitten auf dem Rad.
  const { states } = run("15/reversible-finish");
  const amEnde = states.find((s) => s.finished);
  const last = states[states.length - 1];
  if (amEnde) ok("am echten Ende wird die Runde als gefahren gemeldet");
  else bad("Ende wird gar nicht erkannt", "kein finished auf der ganzen Fahrt");
  if (!last.finished) ok("und wieder aufgehoben, sobald der Gast weiterfaehrt");
  else bad("fertig klebt", `remainingM ${last.remainingM.toFixed(0)}`);
}


console.log("\n16. Eine Kette von Abbiegungen verschluckt keinen Spot");
{
  // docs/40 sagt zu: "Der Knopf kommt danach, der Spot geht dadurch nicht verloren."
  // Das stimmte nur, solange zwischen zwei Abbiegungen mehr als MANEUVER_QUIET_M lagen.
  // In der Altstadt folgen sie enger, das Fenster des Spots liegt dann durchgehend in
  // einer Sperrzone und er lief stumm von "offen" auf "erledigt".
  const { events } = run("16/maneuver-chain");
  if (countOf(events, "spot-near") === 1) ok("der Spot wird trotz Dauer-Sperrzone angeboten");
  else bad("Spot in der Abbiegungs-Kette verschluckt", `${countOf(events, "spot-near")} Angebote statt 1`);
}

console.log("\n17. Der LETZTE Spot einer Runde wird angeboten");
{
  // bike-directions.ts setzt den letzten Spot per Definition auf die Routenlaenge und
  // schiebt einen "arrive"-Step ans Ende. Der deckte damit die letzten 140 m JEDER Route
  // zu: Der letzte Spot wurde nie angeboten. Ankommen ist aber keine Abbiegung, in die
  // man einfaehrt.
  const { events } = run("17/last-spot");
  if (countOf(events, "spot-near") === 1) ok("der letzte Spot wird angeboten");
  else bad("letzter Spot nie angeboten", `${countOf(events, "spot-near")} Angebote statt 1`);
}

console.log("\n18. Zwei Spots im selben Schritt: keiner geht verloren");
{
  // Nach einer Sperrzone oder einer Ortungsluecke koennen zwei Spots im selben
  // Rechenschritt in Reichweite kommen. Die Oberflaeche zeigt nur EIN Angebot, das
  // spaetere ueberschrieb also das naehere, und weil der uebergangene Spot danach auf
  // "near" stand, konnte er nie wieder ausloesen.
  const { states, events } = run("18/two-spots-same-step");

  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 2 && near.includes(0) && near.includes(1)) {
    ok("beide Spots werden angeboten");
  } else {
    bad("ein Spot geht verloren", `Angebote: ${JSON.stringify(near)}`);
  }
  // Und zwar NACHEINANDER, nicht beide im selben Schritt: sonst kann die Oberflaeche
  // gar nicht beide zeigen.
  let maxProSchritt = 0;
  let vorher = 0;
  for (const st of states) {
    const jetzt = st.spotPhase.filter((ph) => ph !== "open").length;
    maxProSchritt = Math.max(maxProSchritt, jetzt - vorher);
    vorher = jetzt;
  }
  if (maxProSchritt <= 1) ok("nie zwei Angebote in einem Schritt");
  else bad("zwei Angebote im selben Schritt", `${maxProSchritt} auf einmal`);
}


console.log("\n19. Stichweg: der Fortschritt laeuft nicht rueckwaerts");
{
  // GEMESSEN AN DER ECHTEN RUNDE A (25.08.2026): Zwei ihrer Spots liegen in Sackgassen,
  // Nonnberggasse und Freisaal. Mapbox faehrt hinein, wendet und kommt auf demselben Weg
  // zurueck ("Nach links umkehren"). Auf dem Rueckweg liegt der Gast physisch auf
  // derselben Linie wie auf dem Hinweg, und die Suche nimmt bei gleichem Abstand das
  // FRUEHER indizierte Segment. Ergebnis: Der Fortschritt zaehlt rueckwaerts, waehrend
  // der Gast vorwaerts faehrt. Gemessen auf der echten Route: bei 3690 gefahrenen Metern
  // meldete der Kern 2127 m, und alle vier Spots dahinter blieben stumm.
  const { states, events } = run("19/clean");
  const last = states[states.length - 1];

  // 1. Kommt der Fortschritt ueberhaupt an?
  if (last.alongM >= 900) ok(`Fortschritt erreicht das Ende (${last.alongM.toFixed(0)} m von 1000)`);
  else bad("Fortschritt bleibt im Stichweg haengen", `${last.alongM.toFixed(0)} m von 1000 m`);

  // 2. Laeuft er zwischendurch rueckwaerts? Ein Radl faehrt vorwaerts, der Zaehler auch.
  let groessterRueckschritt = 0;
  for (let i = 1; i < states.length; i++) {
    groessterRueckschritt = Math.max(groessterRueckschritt, states[i - 1].alongM - states[i].alongM);
  }
  if (groessterRueckschritt <= 25) ok("kein nennenswerter Rueckschritt");
  else bad("Fortschritt laeuft rueckwaerts", `bis zu ${groessterRueckschritt.toFixed(0)} m pro Fix zurueck`);

  // 3. Der Spot HINTER dem Stichweg muss angeboten werden.
  const angeboten = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (angeboten.includes(1)) ok("der Spot hinter dem Stichweg wird angeboten");
  else bad("Spot hinter dem Stichweg bleibt stumm", `angeboten wurden: [${angeboten.join(", ")}]`);

  // 4. Dasselbe mit verrauschtem GPS. Die Fahrtrichtung wird aus zwei aufeinander
  //    folgenden Punkten gerechnet, und die liegen bei 18 km/h nur rund 5 m auseinander.
  //    Bei 8 m Rauschen ist der gerechnete Kurs also alles andere als sauber; der
  //    Aufschlag greift trotzdem, weil er erst ab 90 Grad Abweichung zuschlägt.
  const laut = run("19/noisy");
  const lautLetzter = laut.states[laut.states.length - 1];
  if (lautLetzter.alongM >= 850) ok(`auch mit Rauschen kommt der Fortschritt an (${lautLetzter.alongM.toFixed(0)} m)`);
  else bad("mit Rauschen bleibt der Fortschritt haengen", `${lautLetzter.alongM.toFixed(0)} m von 1000 m`);

  // 5. Und ohne jede Geraeterichtung: iOS liefert `heading` in der Geolocation-API oft
  //    gar nicht. Dann muss der Kurs ueber Grund einspringen.
  const blind = run("19/no-heading");
  const blindLetzter = blind.states[blind.states.length - 1];
  if (blindLetzter.alongM >= 900) ok(`auch ohne Geraeterichtung (${blindLetzter.alongM.toFixed(0)} m)`);
  else bad("ohne Geraeterichtung bleibt der Fortschritt haengen", `${blindLetzter.alongM.toFixed(0)} m von 1000 m`);
}


console.log("\n20. Rundtour mit Ziel: die Runde endet am Start, nicht am letzten Spot");
{
  // Eine Rundtour endet dort, wo sie beginnt. Ohne einen eigenen Ziel-Punkt hoerte die
  // Route am LETZTEN SPOT auf: Bei der echten Runde A ist das Muelln, und das liegt
  // 692 m vom Leihrad entfernt (gemessen gegen Mapbox am 25.08.2026). Der Gast bekaeme
  // "Ziel erreicht", waehrend sein Rad noch sieben Minuten weiter steht.
  //
  // bike-directions.ts haengt den Zielpunkt jetzt hinter die Spots. Fuer den Kern heisst
  // das: Der letzte Spot liegt NICHT mehr am Routenende. Diese Pruefung haelt fest, dass
  // beides trotzdem funktioniert, das Angebot am letzten Spot und der Zieleinlauf danach.
  const { states, events } = run("20/round-with-finish");

  const angeboten = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (angeboten.includes(0) && angeboten.includes(1)) ok("beide Spots werden angeboten");
  else bad("ein Spot bleibt stumm", `angeboten: [${angeboten.join(", ")}]`);

  // Am letzten Spot (800 m) darf noch nichts fertig sein, es fehlen 800 m.
  const beiSpot = states.find((st) => st.alongM >= 800 && st.alongM < 850);
  if (beiSpot && !beiSpot.finished) ok("am letzten Spot ist die Runde noch nicht gefahren");
  else bad("Runde gilt schon am letzten Spot als gefahren", `bei ${beiSpot?.alongM.toFixed(0)} m`);

  // Am echten Ende dagegen schon.
  const letzter = states[states.length - 1];
  if (letzter.finished) ok(`am Ziel gilt sie als gefahren (${letzter.alongM.toFixed(0)} m von 1600)`);
  else bad("Zieleinlauf wird nicht gemeldet", `${letzter.alongM.toFixed(0)} m von 1600 m`);
}


console.log("\n21. Ein Bogen ist keine Abbiegung, zwei dichte gehoeren zusammen");
{
  // Der Winkel war beim ersten Anlauf INVERTIERT: Eine Gerade ergab 180 Grad statt 0, und
  // damit wurde nie etwas verworfen. Genau deshalb steht er hier als eigene Pruefung.
  let winkelOk = true;
  for (const { before: a, after: b, expected: soll, what: was } of TURN_ANGLE_CASES) {
    const ist = turnAngle(a, b);
    if (ist !== soll) { bad(`Winkel falsch (${was})`, `${a}->${b} ergab ${ist}, erwartet ${soll}`); winkelOk = false; }
  }
  if (winkelOk) ok(`Winkel stimmt in allen ${TURN_ANGLE_CASES.length} Faellen`);

  // Verworfen wird nur, was flach UND harmlos ist.
  const { bogen, knick, ohneWinkel } = MERE_CURVE_STEPS;
  if (isMereCurve(bogen)) ok("flacher Bogen wird verworfen");
  else bad("flacher Bogen bleibt", JSON.stringify(bogen));
  if (!isMereCurve(knick)) ok("Strassenende bleibt, auch flach");
  else bad("Strassenende verworfen", JSON.stringify(knick));
  if (!isMereCurve(ohneWinkel)) ok("ohne Winkel wird nie verworfen");
  else bad("ohne Winkel verworfen", JSON.stringify(ohneWinkel));

  // Buendeln: die zweite bleibt eigener Schritt, haengt aber zusaetzlich an der ersten.
  const roh = PREPARE_STEPS_RAW;
  const fertig = prepareSteps(roh);
  if (fertig.length === 3) ok("keine Abbiegung geht beim Buendeln verloren");
  else bad("Abbiegung verschwunden", `${fertig.length} statt 3`);
  if (fertig[0]?.followedBy?.modifier === "left") ok("die zweite haengt an der ersten");
  else bad("Buendel fehlt", JSON.stringify(fertig[0]));
  if (!fertig[1]?.followedBy) ok("die weit entfernte dritte haengt an keiner");
  else bad("faelschlich gebuendelt", JSON.stringify(fertig[1]));
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  WAS EIN ECHTER GAST TUT (15.09.2026)
//
//  Handy in der Tasche, in die Gegenrichtung fahren, von Hand abhaken. Drei Dinge, die
//  keine der Pruefungen oben abdeckte und die am Rad sofort auffallen.
// ═══════════════════════════════════════════════════════════════════════════════════

console.log("\n22. Ortungsluecke: nach fuenf Minuten und 1,5 km weiter genau eine Neuberechnung");
{
  // Bildschirm gesperrt, Safari drosselt die Ortung (docs/40), der Gast faehrt derweil
  // weiter. Der Stetigkeits-Riegel verwirft den Sprung zu Recht: Wir wissen nicht, wo er
  // war. Aber bis 15.09.2026 kam der Abstand zur Route danach vom GLOBAL naechsten Segment,
  // und das lag direkt unter ihm. crossTrack 0, keine Neuberechnung, Navigation fuer immer
  // eingefroren, mit "Naechster Halt in 100 m" auf dem Schirm, 1,5 km daneben.
  const { states, events } = run("22/gps-gap");
  const nachLuecke = driveSpec("22/gps-gap").meta.afterGapIdx;
  const last = states[states.length - 1];
  const danach = states.length - nachLuecke;
  if (countOf(events, "reroute") === 1) ok(`genau eine Neuberechnung, ${danach} Fixe nach der Luecke`);
  else bad("keine Neuberechnung nach der Ortungsluecke", `${countOf(events, "reroute")} Ereignis(se), Navigation eingefroren`);
  if (danach <= NAV.OFF_ROUTE_FIXES + 1) ok("und zwar zuegig");
  else bad("Neuberechnung kommt zu spaet", `erst ${danach} Fixe nach der Luecke`);
  if (Math.abs(last.alongM - 200) < 15) ok(`der Fortschritt springt nicht (${last.alongM.toFixed(0)} m)`);
  else bad("Fortschritt gesprungen", `${last.alongM.toFixed(0)} m statt ~200 m`);
  if (!last.finished) ok("kein Zieleinlauf");
  else bad("Runde faelschlich beendet", `remainingM ${last.remainingM.toFixed(0)}`);
  if (countOf(events, "spot-passed") === 0) ok("kein Spot wird blind verbucht");
  else bad("Spots blind verbucht", `${countOf(events, "spot-passed")} Ereignis(se)`);
}

console.log("\n23. Gegenrichtung: ein Hinweis zum Umdrehen, keine Neuberechnung");
{
  // Der Gast dreht um und faehrt die Route zurueck. Er liegt dabei AUF der Route, also gab
  // es bis 15.09.2026 nichts, was das bemerkte: Die Entfernung zum naechsten Halt zaehlte
  // hoch, sonst nichts. Jetzt: nach rund 100 m "wrong-way", nach 25 m in der richtigen
  // Richtung "on-track", und dazwischen keine Neuberechnung, denn er ist ja auf der Route.
  const { states, events } = run("23/wrong-way");

  if (countOf(events, "wrong-way") === 1) ok("genau ein Umdreh-Hinweis");
  else bad("Umdreh-Hinweis", `${countOf(events, "wrong-way")} statt 1`);
  const beimHinweis = states.find((s) => s.wrongWay);
  if (beimHinweis && beimHinweis.alongM >= 350) {
    ok(`der Hinweis kommt nach ${(500 - beimHinweis.alongM).toFixed(0)} m Rueckweg`);
  } else if (beimHinweis) {
    bad("Hinweis kommt zu spaet", `erst bei ${beimHinweis.alongM.toFixed(0)} m, 150 m Rueckweg sind die Grenze`);
  }
  if (countOf(events, "on-track") === 1) ok("und genau einmal aufgehoben");
  else bad("Aufhebung", `${countOf(events, "on-track")} statt 1`);
  const wieder = states.findIndex((s, i) => i > 0 && states[i - 1].wrongWay && !s.wrongWay);
  if (wieder > 0 && states[wieder].alongM <= 300 + NAV.WRONG_WAY_CLEAR_M + 20) {
    ok(`aufgehoben bei ${states[wieder].alongM.toFixed(0)} m, kurz nach dem Umdrehen`);
  } else if (wieder > 0) {
    bad("Aufhebung kommt zu spaet", `erst bei ${states[wieder].alongM.toFixed(0)} m`);
  }
  if (countOf(events, "reroute") === 0) ok("keine Neuberechnung, der Gast ist ja auf der Route");
  else bad("Neuberechnung in der Gegenrichtung", `${countOf(events, "reroute")} Ereignis(se)`);
  if (countOf(events, "finished") === 0) ok("kein Zieleinlauf");
  else bad("Zieleinlauf", "Runde galt als gefahren");
  if (events.some((e) => e.type === "spot-near" && e.index === 0)) ok("der Spot danach wird angeboten");
  else bad("Spot nach dem Umdrehen bleibt stumm", JSON.stringify(events.filter((e) => e.type === "spot-near")));
}

console.log("\n24. Stichweg: der Rueckweg aus der Sackgasse ist KEINE Gegenrichtung");
{
  // Nonnberggasse und Freisaal (Runde A): hinein, wenden, auf demselben Weg zurueck. Auf
  // dem Rueckweg liegt der Gast auf der Linie des Hinwegs, und genau hier waere ein
  // Umdreh-Hinweis das Schlimmste, was die Navigation tun kann: Er wuerde ihn zurueck in
  // die Sackgasse schicken. Sauber, verrauscht und ohne Geraeterichtung, wie in Pruefung 19.
  const faelle = [
    ["sauber", run("24/clean")],
    ["verrauscht", run("24/noisy")],
    ["ohne Geraeterichtung", run("24/no-heading")],
  ] as const;
  for (const [name, r] of faelle) {
    if (countOf(r.events, "wrong-way") === 0) ok(`kein Umdreh-Hinweis (${name})`);
    else bad(`falscher Umdreh-Hinweis (${name})`, `${countOf(r.events, "wrong-way")} Ereignis(se)`);
  }
}

console.log("\n25. Rundtour rueckwaerts ab Start: Neuberechnung statt Stillstand");
{
  // Der Gast faehrt am Start in die falsche Richtung los, also den Rueckweg der Runde
  // hinauf. Der liegt direkt unter ihm, der Fortschritt bleibt aber zu Recht bei null
  // (der Sprung ans Ende wird verworfen). Bis 15.09.2026 war damit Schluss: crossTrack 0
  // vom Rueckweg, keine Neuberechnung, kein Hinweis, "Naechster Halt in 100 m" fuer immer.
  // Jetzt zaehlt der Abstand zum geglaubten Stand, und nach drei Fixen kommt die
  // Neuberechnung ab der echten Position, deren erste Anweisung zurueck zum Start fuehrt.
  const { states, events } = run("25/loop-backwards");
  const last = states[states.length - 1];
  if (countOf(events, "reroute") === 1) ok(`genau eine Neuberechnung, nach ${states.length * 5} m`);
  else bad("keine Neuberechnung", "Navigation bleibt am Start stehen");
  if (last.alongM < 60) ok(`der Fortschritt springt nicht ans Ende (${last.alongM.toFixed(0)} m)`);
  else bad("Fortschritt gesprungen", `${last.alongM.toFixed(0)} m`);
  if (!last.finished) ok("kein Zieleinlauf");
  else bad("Runde faelschlich beendet", `remainingM ${last.remainingM.toFixed(0)}`);
  if (countOf(events, "spot-passed") === 0) ok("kein Spot verbucht");
  else bad("Spots verbucht", `${countOf(events, "spot-passed")} Ereignis(se)`);
}

console.log("\n26. Abhaken von Hand: das Ziel rueckt sofort weiter, der naechste Spot kommt trotzdem");
{
  // Play am Ort (BikeNavScreen: gehoert UND dort gewesen) oder das X. Bisher aenderte das
  // nur die Phase, und Leiste wie rote Linie zeigten bis zum naechsten Fix den Halt, der
  // eben abgehakt wurde.
  const erst = run("26/approach");
  const route = driveSpec("26/approach").route;
  const vorher = erst.states[erst.states.length - 1];
  if (vorher.spotPhase[0] === "near" && vorher.nextSpotIndex === 0) ok("Spot 1 ist angeboten und das Ziel");
  else bad("Ausgangslage", JSON.stringify({ phase: vorher.spotPhase, next: vorher.nextSpotIndex }));

  const [settleOp] = caseOpsOf("26");
  const danach = applyOp(settleOp) as NavState;
  if (danach.spotPhase[0] === "done" && danach.nextSpotIndex === 1) ok("nach dem Abhaken ist Spot 2 sofort das Ziel");
  else bad("Ziel rueckt nicht weiter", JSON.stringify({ phase: danach.spotPhase, next: danach.nextSpotIndex }));
  const soll = 600 - vorher.alongM;
  if (danach.distanceToNextSpotM != null && Math.abs(danach.distanceToNextSpotM - soll) < 1) ok("mit der richtigen Entfernung");
  else bad("Entfernung zum neuen Ziel", `${danach.distanceToNextSpotM} statt ${soll.toFixed(0)}`);
  if (applyOp({ op: "settleSpot", state: danach, route, routeIndex: 0 }) === danach) ok("ein zweites Abhaken aendert nichts");
  else bad("doppeltes Abhaken", "erzeugt einen neuen Zustand");

  // Weiterfahren: Spot 2 muss ganz normal angeboten werden, Spot 1 nicht noch einmal.
  const rest = run("26/continue-after-settle");
  if (rest.events.some((e) => e.type === "spot-near" && e.index === 1)) ok("Spot 2 wird danach angeboten");
  else bad("Spot 2 bleibt stumm", JSON.stringify(rest.events));
  if (!rest.events.some((e) => e.index === 0)) ok("Spot 1 taucht in keinem Ereignis mehr auf");
  else bad("Spot 1 noch einmal verbucht", JSON.stringify(rest.events.filter((e) => e.index === 0)));

  // "Dort gewesen": die Phase reicht, sonst die Luftlinie.
  let alleOk = true;
  for (const { phase, airlineM: luft, expected: erwartet, what: was } of AT_SPOT_CASES_26) {
    if (applyOp({ op: "atSpot", phase, airlineM: luft, mode: "bike" }) !== erwartet) {
      bad(`atSpot (${was})`, `${phase}/${luft} ergab ${!erwartet}`);
      alleOk = false;
    }
  }
  if (alleOk) ok(`"dort gewesen" stimmt in allen ${AT_SPOT_CASES_26.length} Faellen`);
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  ZU FUSS (16.09.2026)
//
//  Dieselben Regeln, andere Zahlen (WALK_NAV). Auslegungstempo 1,4 m/s, ein Fix je
//  Sekunde: Die Punkte liegen also nur 1,4 m auseinander, unter der 3-m-Schwelle fuer
//  einen brauchbaren Kurs. Genau daran haengt der Bewegungs-Anker im Kern.
// ═══════════════════════════════════════════════════════════════════════════════════

console.log("\n27. Zu Fuss: Angebot bei rund 60 m, verpasst nach 40 m, Ende am Ziel");
{
  if (navTuningFor("walk") === WALK_NAV && navTuningFor("bike") === NAV) ok("die Fortbewegung waehlt die Tabelle");
  else bad("navTuningFor", "liefert die falsche Tabelle");

  const { states, events } = run("27/walk-basics");

  const atFire = states.find((s) => s.spotPhase[0] === "near");
  const ahead = atFire ? 200 - atFire.alongM : NaN;
  if (ahead <= WALK_NAV.SPOT_NEAR_M && ahead > WALK_NAV.SPOT_NEAR_M - 12) ok(`Angebot bei ${ahead.toFixed(0)} m Vorlauf (Sollwert ${WALK_NAV.SPOT_NEAR_M} m)`);
  else bad("Vorlauf zu Fuss", `${ahead.toFixed(0)} m statt rund ${WALK_NAV.SPOT_NEAR_M} m`);

  const passed = states.find((s) => s.spotPhase[0] === "done");
  const behind = passed ? passed.alongM - 200 : NaN;
  if (behind >= WALK_NAV.SPOT_PASSED_M && behind < WALK_NAV.SPOT_PASSED_M + 12) ok(`ungehoert verbucht ${behind.toFixed(0)} m dahinter (Sollwert ${WALK_NAV.SPOT_PASSED_M} m)`);
  else bad("Verbuchen zu Fuss", `${behind.toFixed(0)} m statt rund ${WALK_NAV.SPOT_PASSED_M} m`);

  const near = events.filter((e) => e.type === "spot-near").map((e) => e.index);
  if (near.length === 2 && new Set(near).size === 2) ok("jeder der beiden Spots genau einmal angeboten");
  else bad("Spot-Angebote zu Fuss", JSON.stringify(near));
  if (countOf(events, "reroute") === 0) ok("keine Neuberechnung mit 3 m Rauschen");
  else bad("Neuberechnung zu Fuss", `${countOf(events, "reroute")} statt 0`);
  if (countOf(events, "finished") === 1 && states[states.length - 1].finished) ok("genau ein Ende der Runde, und es haelt");
  else bad("Ende der Runde zu Fuss", `${countOf(events, "finished")} Ereignis(se)`);
  if (countOf(events, "wrong-way") === 0) ok("kein Umdreh-Hinweis auf dem geraden Weg");
  else bad("falscher Umdreh-Hinweis", `${countOf(events, "wrong-way")} Ereignis(se)`);
}

console.log("\n28. Zu Fuss: Gegenrichtung wird erkannt, obwohl die Fixe nur 1,4 m auseinanderliegen");
{
  // Bis 16.09.2026 gab es zu Fuss nie einen Kurs ueber Grund (zwei Fixe lagen unter 3 m
  // auseinander) und damit nie einen bewegten Fix: Der Umdreh-Hinweis kam nicht, egal wie
  // weit jemand zurueckging. Jetzt sammelt der Anker die Schritte.
  const { states, events } = run("28/walk-1s");

  if (countOf(events, "wrong-way") === 1) ok("genau ein Umdreh-Hinweis");
  else bad("Umdreh-Hinweis zu Fuss", `${countOf(events, "wrong-way")} statt 1`);
  const beim = states.find((s) => s.wrongWay);
  if (beim && 300 - beim.alongM <= 90) ok(`der Hinweis kommt nach ${(300 - beim.alongM).toFixed(0)} m Rueckweg, also unter ${Math.round(90 / 1.4)} Sekunden`);
  else if (beim) bad("Hinweis kommt zu spaet", `erst nach ${(300 - beim.alongM).toFixed(0)} m Rueckweg`);
  if (countOf(events, "on-track") === 1) ok("und genau einmal aufgehoben");
  else bad("Aufhebung zu Fuss", `${countOf(events, "on-track")} statt 1`);
  const wieder = states.findIndex((s, i) => i > 0 && states[i - 1].wrongWay && !s.wrongWay);
  if (wieder > 0 && states[wieder].alongM <= 150 + WALK_NAV.WRONG_WAY_CLEAR_M + 15) ok(`aufgehoben bei ${states[wieder].alongM.toFixed(0)} m, kurz nach dem Umdrehen`);
  else if (wieder > 0) bad("Aufhebung kommt zu spaet", `erst bei ${states[wieder].alongM.toFixed(0)} m`);
  if (countOf(events, "reroute") === 0) ok("keine Neuberechnung, der Gast ist auf dem Weg");
  else bad("Neuberechnung in der Gegenrichtung", `${countOf(events, "reroute")} Ereignis(se)`);
  if (events.some((e) => e.type === "spot-near" && e.index === 0)) ok("der Spot danach wird angeboten");
  else bad("Spot nach dem Umdrehen bleibt stumm", JSON.stringify(events));

  // Dasselbe mit duenneren Fixen: alle drei Sekunden (Safari drosselt), und im Tempo des
  // Geh-Simulators (6 m/s). Beim ersten Anlauf im Browser fror der Fortschritt beim
  // Umdrehen ein und es kam eine Neuberechnung statt des Hinweises: Der Ruecksprung vom
  // Fenster-Boden auf die echte Stelle (rund 35 bis 50 m) war groesser als der Sprung-
  // Deckel bei 1 s (damals 38 m). WALK_NAV.JUMP_SLACK_M erklaert die Zahl.
  const duenn = run("28/walk-3s");
  const schnell = run("28/walk-6mps");
  for (const [name, r] of [["ein Fix alle 3 s", duenn], ["6 m/s", schnell]] as const) {
    if (countOf(r.events, "wrong-way") === 1 && countOf(r.events, "reroute") === 0) ok(`auch mit ${name}: ein Hinweis, keine Neuberechnung`);
    else bad(`Gegenrichtung mit ${name}`, `${countOf(r.events, "wrong-way")} Hinweise, ${countOf(r.events, "reroute")} Neuberechnungen`);
  }
}

console.log("\n29. Zu Fuss: Stehenbleiben mit Rauschen ist weder Gegenrichtung noch Off-Route");
{
  // Man bleibt zu Fuss staendig stehen: schauen, fotografieren, zuhoeren. Dabei streut die
  // Ortung um einige Meter. Das darf weder "Bitte umdrehen" noch eine Neuberechnung
  // ausloesen, und der Halt 250 m weiter bleibt offen.
  const r = run("29/walk-standing");
  const last = r.states[r.states.length - 1];
  if (countOf(r.events, "wrong-way") === 0) ok("kein Umdreh-Hinweis nach zwei Minuten Stehen");
  else bad("Umdreh-Hinweis im Stand", `${countOf(r.events, "wrong-way")} Ereignis(se)`);
  if (countOf(r.events, "reroute") === 0) ok("keine Neuberechnung im Stand");
  else bad("Neuberechnung im Stand", `${countOf(r.events, "reroute")} Ereignis(se)`);
  if (Math.abs(last.alongM - 150) <= 15) ok(`der Fortschritt bleibt stehen (${last.alongM.toFixed(0)} m)`);
  else bad("Fortschritt wandert im Stand", `${last.alongM.toFixed(0)} m statt ~150 m`);
  if (last.spotPhase[0] === "open") ok("der Halt in 250 m bleibt offen");
  else bad("Halt im Stand verbucht oder angeboten", last.spotPhase[0]);
}

console.log("\n30. Zu Fuss: keine Sperrzone, das Angebot kommt auch direkt vor einer Abbiegung");
{
  // Am Rad wartet der Play-Knopf, solange eine Abbiegung bevorsteht (Sicherheitsregel).
  // Zu Fuss bleibt man stehen; in einer Altstadt mit einer Gasse alle 40 m verschluckte
  // die Regel sonst jedes Angebot.
  const { states } = run("30/walk-no-quiet-zone");
  const atFire = states.find((s) => s.spotPhase[0] === "near");
  if (atFire && atFire.alongM < 185) ok(`Angebot bei ${atFire.alongM.toFixed(0)} m, vor der Abbiegung bei 185 m`);
  else bad("Angebot wartet auf die Abbiegung", atFire ? `erst bei ${atFire.alongM.toFixed(0)} m` : "nie");
}

console.log("\n31. Zu Fuss: der Teleport-Filter laesst Stand-Rauschen durch und verwirft echte Spruenge");
{
  // MAX_SPEED_MPS ist zu Fuss 8: Ein Fix, der 7 m weiter liegt als der vorige (Rauschen an
  // der Ampel), zaehlt; einer, der 15 m weiter liegt, ist ein Ausreisser.
  const { states } = run("31/walk-teleport-filter");
  if (Math.abs(states[1].alongM - 107) < 1) ok("7 m in einer Sekunde werden uebernommen");
  else bad("Stand-Rauschen verworfen", `${states[1].alongM.toFixed(0)} m`);
  if (states[2] === states[1]) ok("15 m in einer Sekunde werden verworfen");
  else bad("Ausreisser uebernommen", `${states[2].alongM.toFixed(0)} m`);
  if (Math.abs(states[3].alongM - 113) < 1) ok("und der naechste echte Fix zaehlt wieder (gegen den letzten guten gemessen)");
  else bad("nach dem Ausreisser bleibt es haengen", `${states[3].alongM.toFixed(0)} m`);
}

console.log("\n32. Der Anker aendert am Rad nichts: Stichweg und Gegenrichtung wie vorher");
{
  // Der Bewegungs-Anker (NavState.moveAnchor) ist fuers Gehen da. Am Rad liegen die Fixe
  // 5 m auseinander, der Anker rueckt also bei jedem Fix weiter, und das Ergebnis muss
  // dasselbe sein wie mit dem alten "Kurs aus zwei Fixen". Zwei Stichproben aus 19 und 23.
  const s19 = run("32/spur-bike");
  if (s19.states[s19.states.length - 1].alongM >= 900 && countOf(s19.events, "wrong-way") === 0) ok("Stichweg am Rad: kommt an, kein Umdreh-Hinweis");
  else bad("Stichweg am Rad veraendert", `${s19.states[s19.states.length - 1].alongM.toFixed(0)} m, ${countOf(s19.events, "wrong-way")} Hinweise`);
  const s23 = run("32/wrong-way");
  if (countOf(s23.events, "wrong-way") === 1 && countOf(s23.events, "on-track") === 1) ok("Gegenrichtung am Rad: ein Hinweis, einmal aufgehoben");
  else bad("Gegenrichtung am Rad veraendert", `${countOf(s23.events, "wrong-way")} / ${countOf(s23.events, "on-track")}`);
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : "\nAlles grün.");
process.exitCode = failed ? 1 : 0;
