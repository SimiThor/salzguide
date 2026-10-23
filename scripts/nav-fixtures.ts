// Schreibt die Fixtures für das Swift-Paket SalzNavCore (docs/41, Abschnitt 6.1) aus dem
// ECHTEN TypeScript-Code. Aufruf:
//   npm run nav:fixtures -- --out <ordner>     Fixtures schreiben
//   npm run nav:fixtures -- --check <ordner>   neu erzeugen und mit dem Ordner vergleichen
//                                              (Exit 1 und Liste der abweichenden Dateien)
//
// WARUM ES DIESES SKRIPT GIBT: Gleichheit zwischen Web-Kern und Swift-Kern wird bewiesen,
// nicht behauptet (docs/41 6.1). Die Swift-Seite spielt jede Fixture in XCTest ab und muss
// dasselbe Ergebnis liefern. Die Ergebnisse stammen aus stepNav(), prepareSteps(),
// selectNavVias() usw. in src/lib, nichts ist nachgebaut. Die FÄLLE (Routen, Fix-Folgen,
// Aufrufe) stehen in scripts/lib/nav-cases.ts und scripts/lib/tour-route-cases.ts und
// werden von nav:check bzw. tour-route:check mitbenutzt: eine Quelle, keine Kopie.
//
// WAS DRIN IST
//   manifest.json            Format-Version, Dateiliste, NAV/WALK_NAV, Banner-Schwellen,
//                            Toleranz, Kodierung der Sonderwerte
//   stepnav/case-NN.json     31 Fälle (nav:check 1 bis 32 ohne 21): Fahrten mit Zustand nach
//                            JEDEM Fix, dazu Zustands-Operationen (resetForNewRoute,
//                            settleSpot, atSpot, navTuningFor)
//   nav-steps/case-21.json   turnAngle / isMereCurve / prepareSteps
//   nav-format/format.json   nav-format.ts und die Banner-Stufen (nav-urgency.ts)
//   tour-route/NN-*.json     tour-route-check: tour-route.ts und bike-directions.ts
//
// WANN NEU ERZEUGEN: Jedes Mal, wenn sich der TS-Kern ändert (bike-nav-core, geo,
// nav-steps, nav-format, nav-urgency, tour-route, bike-directions) oder ein Fall in den
// Fall-Dateien. Im App-Repo meldet `--check <ordner>` die Abweichung (CI), danach werden
// die Fixtures kopiert und der Swift-Kern angepasst.
//
// WAS HIER NICHT DRIN IST: die Routen-KETTE des Offline-Pakets (Start -> Stopps -> Wegpunkte
// -> Ziel ab dem Tour-Start, docs/41 6.3). Das Web routet ab der GPS-Position, das Paket ab
// dem Start; dafür braucht die App einen eigenen Test. Ebenfalls nicht dabei: geo.ts als
// eigene Fixture (wirkt nur über stepNav), fetchBikeRoute (Netz).
//
// AUSGABE IST DETERMINISTISCH: Schlüssel sortiert, keine Zeitstempel, keine Pfade, Zahlen
// als JSON-Zahlen (so, wie JavaScript sie druckt). Zweimal laufen lassen gibt gleiche Bytes.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { NAV, WALK_NAV, MIN_MOVE_M, navTuningFor, type NavState } from "../src/lib/bike-nav-core.ts";
import { turnAngle, isMereCurve, prepareSteps, CURVE_MAX_DEG, BUNDLE_MAX_M } from "../src/lib/nav-steps.ts";
import { formatNavDistanceM, maneuverArrowDeg, estimateEtaMin } from "../src/lib/nav-format.ts";
import { URGENCY_M, urgency } from "../src/lib/nav-urgency.ts";
import { MAX_DIRECTIONS_COORDS } from "../src/lib/tour-route.ts";
import {
  navCases,
  run,
  applyOp,
  initialStateOf,
  TURN_ANGLE_CASES,
  TURN_ANGLE_EXTRA_CASES,
  MERE_CURVE_STEPS,
  MERE_CURVE_EXTRA_STEPS,
  PREPARE_STEPS_RAW,
  PREPARE_STEPS_EXTRA,
  FORMAT_DISTANCE_INPUTS,
  ARROW_MODIFIER_INPUTS,
  ETA_INPUTS,
  URGENCY_INPUTS,
  type StateOp,
} from "./lib/nav-cases.ts";
import { tourRouteCalls, evaluate, argsOf } from "./lib/tour-route-cases.ts";

const FORMAT_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════════════════════
//  Kodierung und Ausgabe
// ═══════════════════════════════════════════════════════════════════════════════════

// JSON kennt weder NaN/Infinity noch undefined. Beides kommt vor (WALK_NAV.MOVING_MPS ist
// Infinity, die Eingabe von cleanRouteVia darf undefined/NaN sein) und wird als getaggtes
// Objekt geschrieben, damit es nicht mit einem Text verwechselt wird:
//   {"$num":"Infinity"} / {"$num":"-Infinity"} / {"$num":"NaN"}   und   {"$undefined":true}
// Eigenschaften mit dem Wert undefined fehlen einfach (wie bei JSON.stringify).
function encode(v: unknown): unknown {
  if (v === undefined) return { $undefined: true };
  if (typeof v === "number") {
    // -0 würde als 0 geschrieben und der Unterschied still verschwinden: lieber laut scheitern.
    if (Object.is(v, -0)) throw new Error("-0 in den Fixtures: JSON kann es nicht darstellen");
    if (Number.isNaN(v)) return { $num: "NaN" };
    if (v === Infinity) return { $num: "Infinity" };
    if (v === -Infinity) return { $num: "-Infinity" };
    return v;
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) o[k] = encode(x);
    }
    return o;
  }
  return v;
}

// Bis zu dieser Tiefe steht jedes Element in einer eigenen Zeile (lesbar, gut zu diffen),
// darunter alles in einer Zeile. Liefert bei gleichem Inhalt immer gleiche Bytes.
const EXPAND_DEPTH = 4;
function compact(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(compact).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${compact((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
function pretty(v: unknown, depth: number): string {
  const isContainer = v !== null && typeof v === "object";
  if (!isContainer) return JSON.stringify(v);
  const entries: [string | null, unknown][] = Array.isArray(v)
    ? v.map((x) => [null, x])
    : Object.keys(v as object)
        .sort()
        .map((k) => [k, (v as Record<string, unknown>)[k]]);
  if (entries.length === 0) return Array.isArray(v) ? "[]" : "{}";
  if (depth >= EXPAND_DEPTH) return compact(v);
  const pad = "  ".repeat(depth + 1);
  const body = entries
    .map(([k, x]) => `${pad}${k === null ? "" : `${JSON.stringify(k)}: `}${pretty(x, depth + 1)}`)
    .join(",\n");
  const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  return `${open}\n${body}\n${"  ".repeat(depth)}${close}`;
}
const toText = (v: unknown): string => pretty(encode(v), 0) + "\n";

// ═══════════════════════════════════════════════════════════════════════════════════
//  Die Dateien
// ═══════════════════════════════════════════════════════════════════════════════════

type Files = Map<string, string>;

function stepnavFiles(files: Files) {
  for (const c of navCases()) {
    if (c.id === "21") continue; // eigener Typ: nav-steps/case-21.json
    const drives = c.driveIds.map((id) => {
      const r = run(id);
      const s = r.spec;
      return {
        id: s.id,
        label: s.label,
        mode: s.mode,
        route: s.route,
        // Der Zustand VOR dem ersten Fix, so wie ihn die Fahrt benutzt hat.
        initialState: initialStateOf(s) as NavState,
        fixes: r.fixes,
        // Zustand und Ereignisse NACH jedem Fix, in derselben Reihenfolge wie `fixes`.
        frames: r.frames,
      };
    });
    const ops = c.ops.map((o: StateOp) => ({ op: o.op, input: opInput(o), output: applyOp(o) }));
    files.set(
      `stepnav/case-${c.id}.json`,
      toText({ type: "stepnav", formatVersion: FORMAT_VERSION, case: c.id, title: c.title, drives, ops }),
    );
  }
}

// Eingaben einer Operation ohne das Feld `op` (das steht eine Ebene höher).
function opInput(o: StateOp): Record<string, unknown> {
  const { op: _op, ...rest } = o;
  void _op;
  return rest;
}

function navStepsFile(files: Files) {
  const angle = [...TURN_ANGLE_CASES, ...TURN_ANGLE_EXTRA_CASES].map((c) => ({
    what: c.what,
    input: { before: c.before, after: c.after },
    output: turnAngle(c.before, c.after),
  }));
  const curves = [
    ...Object.entries(MERE_CURVE_STEPS).map(([label, step]) => ({ label, step })),
    ...MERE_CURVE_EXTRA_STEPS,
  ].map((c) => ({ label: c.label, input: c.step, output: isMereCurve(c.step) }));
  const prepare = [{ label: "case-21", steps: PREPARE_STEPS_RAW }, ...PREPARE_STEPS_EXTRA].map((c) => ({
    label: c.label,
    input: c.steps,
    output: prepareSteps(c.steps),
  }));
  files.set(
    "nav-steps/case-21.json",
    toText({
      type: "nav-steps",
      formatVersion: FORMAT_VERSION,
      case: "21",
      constants: { BUNDLE_MAX_M, CURVE_MAX_DEG },
      turnAngle: angle,
      isMereCurve: curves,
      prepareSteps: prepare,
    }),
  );
}

function navFormatFile(files: Files) {
  files.set(
    "nav-format/format.json",
    toText({
      type: "nav-format",
      formatVersion: FORMAT_VERSION,
      formatNavDistanceM: FORMAT_DISTANCE_INPUTS.map((m) => ({ input: m, output: formatNavDistanceM(m) })),
      maneuverArrowDeg: ARROW_MODIFIER_INPUTS.map((m) => ({ input: m, output: maneuverArrowDeg(m) })),
      estimateEtaMin: ETA_INPUTS.map(([remainingM, speedMps, mode]) => ({
        // Fehlt der Modus, wird der dritte Parameter nicht übergeben (Vorgabe: Rad).
        input: mode === undefined ? { remainingM, speedMps } : { remainingM, speedMps, mode },
        output: mode === undefined ? estimateEtaMin(remainingM, speedMps) : estimateEtaMin(remainingM, speedMps, mode),
      })),
      urgency: URGENCY_INPUTS.map(([distanceM, mode]) => ({
        input: { distanceM, mode },
        output: urgency(distanceM, mode),
      })),
    }),
  );
}

const TOUR_ROUTE_SECTIONS: Record<string, string> = {
  "01": "hash",
  "02": "clean-via",
  "03": "reconcile-via",
  "04": "flatten-chain",
  "05": "leg-for-tap",
  "06": "via-helpers",
  "07": "select-nav-vias",
  "08": "along-from-via-waypoints",
};

function tourRouteFiles(files: Files) {
  const bySection = new Map<string, unknown[]>();
  for (const c of tourRouteCalls()) {
    const sec = c.id.slice(0, 2);
    if (!TOUR_ROUTE_SECTIONS[sec]) throw new Error(`Abschnitt ohne Dateinamen: ${c.id}`);
    // Jeder Aufruf frisch ausgewertet: Eingaben sind die, die der Aufruf wirklich bekam.
    const list = bySection.get(sec) ?? [];
    list.push({ id: c.id, fn: c.fn, args: argsOf(c.id), output: evaluate(c.id) });
    bySection.set(sec, list);
  }
  for (const sec of Object.keys(TOUR_ROUTE_SECTIONS)) {
    files.set(
      `tour-route/${sec}-${TOUR_ROUTE_SECTIONS[sec]}.json`,
      toText({
        type: "tour-route",
        formatVersion: FORMAT_VERSION,
        section: sec,
        name: TOUR_ROUTE_SECTIONS[sec],
        calls: bySection.get(sec) ?? [],
      }),
    );
  }
}

function manifestFile(files: Files) {
  const names = [...files.keys()].sort();
  const countOf = (dir: string) => names.filter((n) => n.startsWith(`${dir}/`)).length;
  files.set(
    "manifest.json",
    toText({
      formatVersion: FORMAT_VERSION,
      generator: "scripts/nav-fixtures.ts",
      files: names,
      counts: {
        stepnav: countOf("stepnav"),
        "nav-steps": countOf("nav-steps"),
        "nav-format": countOf("nav-format"),
        "tour-route": countOf("tour-route"),
      },
      // Die Zahlentabellen genau wie in bike-nav-core.ts. WALK_NAV.MOVING_MPS ist Infinity
      // (der Geräte-Kurs wird zu Fuss nie genommen) und steht deshalb als {"$num":"Infinity"}.
      tables: { NAV, WALK_NAV },
      minMoveM: MIN_MOVE_M,
      // navTuningFor(mode) -> Tabelle; die Swift-Seite prüft sie gegen `tables`.
      tuningForMode: { bike: navTuningFor("bike") === NAV ? "NAV" : "?", walk: navTuningFor("walk") === WALK_NAV ? "WALK_NAV" : "?" },
      // Banner-Schwellen (ManeuverBanner.tsx, Quelle src/lib/nav-urgency.ts): "jetzt" bis
      // `now` Meter, "gleich" bis `near` Meter, darüber "far".
      bannerUrgencyM: URGENCY_M,
      navSteps: { BUNDLE_MAX_M, CURVE_MAX_DEG },
      tourRoute: { MAX_DIRECTIONS_COORDS },
      encoding: {
        nonFiniteNumber: '{"$num":"NaN"|"Infinity"|"-Infinity"}',
        undefinedValue: '{"$undefined":true}',
        absentProperty: "Eigenschaften mit dem Wert undefined fehlen im JSON",
        note: "Schlüssel sind sortiert; die Reihenfolge von Arrays ist bedeutsam.",
      },
      // Toleranz fürs Abspielen in Swift. Begründung: Die Zahlen sind Double (IEEE 754) in
      // beiden Sprachen, die Rechenwege dieselben. Abweichungen kommen nur aus sin/cos/atan2
      // und sqrt der jeweiligen libm (wenige ulp, rund 1e-16 relativ). Der Zustand wird je
      // Fix NEU aus der Geometrie gerechnet (kein Aufsummieren über die Fahrt), die
      // Richtungsglättung (EMA 0,25) dämpft Fehler. Eine 1-ulp-Störung der Eingabe gibt
      // höchstens rund 2e-11 relative Abweichung im Ergebnis; 1e-9 liegt darüber, aber weit
      // unter jeder Abweichung einer falsch übertragenen Formel. ENTSCHEIDUNGEN (Ereignisse,
      // Phasen, Flags, Zähler, Indizes) sind exakt: Kippt eine Schwelle durch Rechenrauschen,
      // soll der Test das zeigen, nicht verstecken (Ausnahme: nearThreshold unten).
      tolerance: {
        number: {
          relative: 1e-9,
          absoluteFloor: 1e-12,
          rule: "|a - b| <= max(absoluteFloor, relative * max(|a|, |b|))",
          appliesTo: "alle JSON-Zahlen, die nicht unter `exact` fallen",
        },
        exact: {
          types: ["string", "boolean", "null", "enum-Werte", "Array-Längen", "Schlüsselmengen"],
          integerFields: [
            "events[].index",
            "frames[].state und initialState und ops[].output (State): stepIndex, nextSpotIndex, offRouteStreak, finishStreak, wrongWayStreak",
            "nav-steps: alongM der Schritte, followedBy; turnAngle-Ausgaben sind Doubles (Zahlenregel)",
            "nav-format: estimateEtaMin und maneuverArrowDeg (ganze Zahlen)",
            "tour-route: dropped (reconcileVia), legIndex und insertAt (legForTap), before und pos (selectNavVias, buildBikeChain), Längen und countVia",
          ],
          copiedFields: [
            "frames[].state.lastFixAt, initialState.lastFixAt",
            "frames[].state.lastRerouteAt, initialState.lastRerouteAt",
            "frames[].state.lastFixCoord und moveAnchor",
          ],
          copiedCoordinates:
            "Jede [lng, lat]-Koordinate, die eine KOPIE einer Eingabe ist (lastFixCoord, moveAnchor, Wegpunkt- und Ketten-Koordinaten in tour-route: legs[].coords, flattenChain/chainCoords, selectNavVias[].coord, buildBikeChain.coords), wird bitgleich verglichen, nicht mit Toleranz.",
          stringOutputs:
            "formatNavDistanceM, viaIdOf und tourRouteHash liefern Text und sind exakt gleich zu vergleichen (toFixed-Rundung, siehe notes).",
        },
        // Stellen, die so knapp an einer Schwelle liegen, dass wenige ulp Abweichung der
        // libm das Ereignis kippen. Ein Fehlschlag GENAU hier kann Rechenrauschen sein
        // (zuerst die Zahlen daneben prüfen); alles andere muss exakt stimmen.
        nearThreshold: [
          {
            files: ["stepnav/case-19.json", "stepnav/case-24.json"],
            drive: "noisy",
            frame: 119,
            frameIndexBase: 0,
            event: "spot-near",
            note: "knapp an einer Schwelle: spot-near kippt bei rund 4 ulp Abweichung der libm-Ergebnisse",
          },
        ],
      },
      notes: [
        "Zeit kommt immer als fix.at (ms) herein. Kein Aufruf liest Date.now() oder Math.random().",
        "Kein Locale: formatNavDistanceM druckt mit toFixed(1) und festem Punkt, Dezimaltrennzeichen ist immer '.'.",
        "tourRouteHash: djb2 ueber die UTF-16-Codeeinheiten (charCodeAt), mit h = ((h << 5) + h + c) >>> 0; das << rechnet in Int32. Ausgabe in Basis 36. Davor hashTexts: jedes Token (x ?? '').trim(), dann stripEmDash, dann join(' '). Die Tokens bestehen aus Modus, Typbuchstabe, Stations-ID und Koordinaten; stripEmDash greift nur, wenn eine Stations-ID (aus Fremdeingabe) einen Gedankenstrich enthält, die Fixtures haben keinen. Trim und Leerzeichen als Trenner gelten trotzdem.",
        "formatNavDistanceM, Ties: toFixed(1) rundet exakte Halbwerte AUF (1250 -> '1.3 km', 1750 -> '1.8 km', 2250 -> '2.3 km'); printf und String(format:) runden auf gerade ('1.2', '1.8', '2.2'). Die Swift-Seite muss JS nachbilden. Die Fixtures enthalten 1250, 1750, 2250 samt Nachbarn (x49, x51). 950 liegt unter 1000 und ist ein m-Wert (Math.round, nicht toFixed).",
        "Math.round in nav-format rundet .5 nach oben (auch bei negativen Zahlen), nicht von Null weg.",
        "fix() in den Fall-Dateien macht aus headingDeg null den Wert 90 (??). Die Fixture hält die Fixe, wie sie ankamen.",
      ],
    }),
  );
}

export function buildFixtures(): Files {
  const files: Files = new Map();
  stepnavFiles(files);
  navStepsFile(files);
  navFormatFile(files);
  tourRouteFiles(files);
  manifestFile(files);
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  Schreiben und Vergleichen
// ═══════════════════════════════════════════════════════════════════════════════════

const SUBDIRS = ["stepnav", "nav-steps", "nav-format", "tour-route"];

function listExisting(dir: string): string[] {
  const out: string[] = [];
  if (existsSync(join(dir, "manifest.json"))) out.push("manifest.json");
  for (const sub of SUBDIRS) {
    const p = join(dir, sub);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p)) if (f.endsWith(".json")) out.push(`${sub}/${f}`);
  }
  return out.sort();
}

function writeAll(dir: string, files: Files) {
  // Alte Fixture-Dateien, die es nicht mehr gibt, räumen wir weg (nur in unseren Ordnern).
  for (const old of listExisting(dir)) if (!files.has(old)) rmSync(join(dir, old));
  for (const [name, text] of files) {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}

function checkAll(dir: string, files: Files): string[] {
  const diffs: string[] = [];
  for (const [name, text] of files) {
    const p = join(dir, name);
    if (!existsSync(p)) diffs.push(`${name}  (fehlt im Ordner)`);
    else if (readFileSync(p, "utf8") !== text) diffs.push(`${name}  (Inhalt weicht ab)`);
  }
  for (const old of listExisting(dir)) if (!files.has(old)) diffs.push(`${old}  (gibt es nicht mehr)`);
  return diffs.sort();
}

function main() {
  const args = process.argv.slice(2);
  const iOut = args.indexOf("--out");
  const iCheck = args.indexOf("--check");
  const dir = iOut >= 0 ? args[iOut + 1] : iCheck >= 0 ? args[iCheck + 1] : undefined;
  if ((iOut < 0) === (iCheck < 0) || !dir) {
    console.error("Aufruf: npm run nav:fixtures -- --out <ordner>   oder   -- --check <ordner>");
    process.exit(2);
  }
  const files = buildFixtures();
  if (iOut >= 0) {
    writeAll(dir, files);
    console.log(`${files.size} Dateien geschrieben.`);
    return;
  }
  const diffs = checkAll(dir, files);
  if (diffs.length) {
    console.log("Fixtures weichen vom TS-Kern ab:");
    for (const d of diffs) console.log(`  ${d}`);
    console.log("Neu erzeugen mit: npm run nav:fixtures -- --out <ordner>");
    process.exit(1);
  }
  console.log(`Alle ${files.size} Dateien stimmen überein.`);
}

main();
