// Geo-Helfer (client-safe). Koordinaten sind [lng, lat].

// Ein gesetzter Karten-Punkt (Wasserstelle / Hütte): Koordinaten + optionaler Name +
// optionaler Untertyp-Code. name ist absichtlich frei und einsprachig (DE-Basis, wie
// route_waypoints) — es sind Eigennamen ("Stögeralm") oder kurze Orte, keine UI-Texte.
// subtype ist ein sprachneutraler Code (z.B. "fountain") aus src/lib/poi.ts; das
// dargestellte Label wird daraus lokalisiert.
export type MapPoi = { lng: number; lat: number; name?: string; subtype?: string };

// Robust aus jsonb ODER aus dem Formular-Array lesen. Wird bewusst auf BEIDEN Seiten
// benutzt (DB-Lesen und Speichern-Säubern), damit nie Halbgares in die DB oder auf die
// Karte kommt: nur echte Zahlen, Name/Untertyp getrimmt, leere fallen weg, kaputte
// Punkte werden verworfen. Akzeptiert auch die Tupel-Form [lng,lat] (defensiv).
export function parsePois(v: unknown): MapPoi[] {
  if (!Array.isArray(v)) return [];
  const out: MapPoi[] = [];
  for (const item of v) {
    let lng: unknown, lat: unknown, name: unknown, subtype: unknown;
    if (Array.isArray(item)) {
      [lng, lat] = item;
    } else if (item && typeof item === "object") {
      ({ lng, lat, name, subtype } = item as Record<string, unknown>);
    } else {
      continue;
    }
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanSub = typeof subtype === "string" ? subtype.trim() : "";
    const poi: MapPoi = { lng, lat };
    if (cleanName) poi.name = cleanName;
    if (cleanSub) poi.subtype = cleanSub;
    out.push(poi);
  }
  return out;
}

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Kompasspeilung a->b in Grad (0 = Nord, im Uhrzeigersinn). War bis jetzt eine private
// Kopie in intro-camera.ts (Kamerafahrt fürs Intro-Video); die Live-Navigation (S-Bike)
// braucht dieselbe Formel für den Kurs zum nächsten Wegpunkt, deshalb EINE Quelle hier.
export function bearingBetween(a: [number, number], b: [number, number]): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const toDeg = (x: number) => (x * 180) / Math.PI;
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Winkel entpacken, damit eine Glättung/EMA den kurzen Weg nimmt (359°->1° = +2°, nicht
// -358°). Ebenfalls aus intro-camera.ts herausgezogen — dieselbe Formel, derselbe Zweck
// (dort die Kamera-Drehung glätten, hier die Fahrtrichtung des Nutzers).
export function unwrapDegrees(prev: number, next: number): number {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return prev + d;
}

// Gesamtlänge einer Route in Kilometern (Haversine-Summe). Fallback für die Distanz, wenn
// kein Höhenprofil vorliegt (dort steckt sonst elevation.distanceKm). Route ist [lng,lat].
export function routeLengthKm(route: [number, number][] | null | undefined): number {
  if (!route || route.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < route.length; i++) m += haversineMeters(route[i - 1], route[i]);
  return m / 1000;
}

// --- Realistische Tour-Dauer (SAC-Gehzeit + gedeckelte Pause) --------------------------
// Ziel: eine Zahl, die ein normaler Wanderer wirklich braucht — nicht knapp, aber auch nicht
// so lang, dass sie neben jedem Wegweiser und jedem Tourenportal falsch aussieht.
//
// Reine Gehzeit nach den SAC-Werten (Schweizer Alpen-Club, Marschzeitberechnung):
//   - 4 km/h in der Ebene (Wander-, kein Marschtempo)
//   - 400 Höhenmeter/Stunde im Aufstieg
//   - 800 Höhenmeter/Stunde im Abstieg
//   - Horizontal- und Vertikalzeit überlagern sich nur teilweise: die GRÖSSERE der beiden
//     zählt voll, die kleinere nur zur Hälfte.
//
// WARUM NICHT MEHR DAV/DIN 33466 (300 auf, 500 ab): Das ist die konservative Fassung, und
// mit dem alten Pausen-Puffer obendrauf lag die App 50 bis 70 Prozent über allem, was der
// Gast sonst liest — Schafberg 10 Std statt 6, Gamskarkogel 13,5 statt 8. Ein Gast hat genau
// das gemeldet. Mit den SAC-Werten treffen UNSERE gemessenen Routen die veröffentlichten
// Zeiten fast punktgenau; nachgerechnet wird das bei jedem Lauf von `npm run hiking:check`,
// dort stehen auch die Referenztouren mit Quelle.
//
// PAUSEN: Zehn Prozent, aber höchstens eine halbe Stunde. Der Zuschlag ist der Unterschied
// zwischen „durchgehen" und „ankommen": kurz stehen bleiben, fotografieren, Jause. Er ist
// GEDECKELT, weil er sonst linear mitwächst und der langen Tour zwei Stunden reine Pause
// aufschlägt — genau der Fehler, der die 13 Stunden erzeugt hat. Wer oben eine Stunde sitzt,
// plant das selbst dazu; wir versprechen keine Rast, sondern eine Gehzeit mit Luft.
//
// Hin & zurück und Rundwege sind automatisch abgedeckt, weil die VOLLE Route eingegeben wird
// (mit Auf- UND Abstieg): der Rückweg bringt seine eigenen Höhen-/Streckenmeter mit.
export const HIKE_SPEED_KMH = 4;
export const HIKE_ASCENT_MH = 400;
export const HIKE_DESCENT_MH = 800;
export const HIKE_BREAK_SHARE = 0.1; // Pausen-Zuschlag auf die reine Gehzeit
export const HIKE_BREAK_MAX_MIN = 30; // ... aber nie mehr als das

/** Reine Gehzeit in Minuten, ohne jede Pause. Basis für alles andere. */
export function walkingTimeMinutes(
  distanceKm: number,
  ascentM: number,
  descentM: number,
): number {
  const km = Math.max(0, distanceKm || 0);
  const up = Math.max(0, ascentM || 0);
  const down = Math.max(0, descentM || 0);
  const tHoriz = km / HIKE_SPEED_KMH; // Stunden
  const tVert = up / HIKE_ASCENT_MH + down / HIKE_DESCENT_MH; // Stunden
  return (Math.max(tHoriz, tVert) + 0.5 * Math.min(tHoriz, tVert)) * 60;
}

export function hikingTimeMinutes(
  distanceKm: number,
  ascentM: number,
  descentM: number,
): number {
  const walking = walkingTimeMinutes(distanceKm, ascentM, descentM);
  return Math.round(walking + Math.min(HIKE_BREAK_MAX_MIN, walking * HIKE_BREAK_SHARE));
}

/**
 * Auf- und Abstieg aus einer Höhenreihe. Zacken unter 3 m werden verschluckt, sonst
 * summiert sich das Rauschen der Höhendaten zu Höhenmetern, die niemand geht.
 *
 * EINE Quelle für beide Seiten: Der Admin snappt über `snapRoute`, die Import-Skripte über
 * `route-math.ts`. Vorher nahm der Admin die rohen ORS-Summen und der Import diese Funktion
 * — dieselbe Route ergab je nach Weg andere Höhenmeter und damit eine andere Dauer.
 */
export function ascentDescent(el: number[]): { ascent: number; descent: number } {
  if (!el || el.length < 2) return { ascent: 0, descent: 0 };
  let ascent = 0;
  let descent = 0;
  let ref = el[0];
  for (const e of el.slice(1)) {
    const d = e - ref;
    if (Math.abs(d) < 3) continue;
    if (d > 0) ascent += d;
    else descent -= d;
    ref = e;
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) };
}

/**
 * Die EINE Schreibweise für eine Tour-Dauer. „5 Std 47 min" wäre falsche Genauigkeit: Die
 * Formel ist eine Schätzung, keine Messung. Unter einer Stunde in 5-Minuten-Schritten, ab
 * einer Stunde in halben Stunden.
 *
 * Vorher gab es zwei Fassungen (`durationFromMin` im Formular, `formatDuration` im Import),
 * und beide Formen stehen bis heute in der Datenbank.
 */
export function formatHikingDuration(min: number): string {
  const min5 = Math.max(5, Math.round(min / 5) * 5);
  if (min5 < 60) return `${min5} min`;
  const h = Math.round(min / 30) / 2; // auf halbe Stunden
  return `${String(h).replace(".", ",")} Std`;
}

/**
 * Vorschlag für die Schwierigkeit aus den gemessenen Zahlen der GANZEN Tour (bei hin/retour
 * also Hin- und Rückweg zusammen). Grenzen an den 48 gemessenen Routen geeicht: „leicht" ist
 * ein Spaziergang, den man in Turnschuhen macht, „schwer" eine Tour, für die man den Tag
 * einplant. Was die Zahlen NICHT wissen (Ausgesetztheit, Klettersteig, Trittsicherheit),
 * kann nur ein Mensch — deshalb ist das ein Vorschlag und keine Wahrheit.
 */
export function suggestDifficulty(distanceKm: number, ascentM: number): string {
  const km = Math.max(0, distanceKm || 0);
  const up = Math.max(0, ascentM || 0);
  if (up <= 350 && km <= 7) return "leicht";
  if (up <= 800 && km <= 14) return "mittel";
  return "schwer";
}

// Punkt auf der Route bei Bruchteil f ∈ [0..1] der Gesamtlänge (interpoliert).
export function coordAtFraction(
  route: [number, number][],
  f: number | null,
): [number, number] | null {
  if (!route || route.length === 0 || f == null) return null;
  if (route.length === 1) return route[0];
  const clamped = Math.max(0, Math.min(1, f));

  // Segmentlängen + Gesamtlänge
  let total = 0;
  const segs: number[] = [];
  for (let i = 1; i < route.length; i++) {
    const d = haversineMeters(route[i - 1], route[i]);
    segs.push(d);
    total += d;
  }
  if (total === 0) return route[0];

  const target = clamped * total;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (acc + seg >= target) {
      const t = seg === 0 ? 0 : (target - acc) / seg;
      const a = route[i];
      const b = route[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += seg;
  }
  return route[route.length - 1];
}

// ——— Routen-Form: einordnen (EINE Quelle für Karte UND Wander-Animation) ————————————
// Drei Fälle, robust und mit Messtoleranz:
//  - "point-to-point": Start und Ziel weit auseinander (z.B. Gipfel einfach).
//  - "loop":           Start ≈ Ziel, aber der Weg läuft NICHT doppelt (echter Rundweg).
//  - "out-and-back":   Start ≈ Ziel UND die Rückhälfte ist der umgekehrte Hinweg (hin/retour).
// Trägt der Admin hin+zurück ein (damit Länge/Höhe/Dauer stimmen), fallen Start und Ziel
// zusammen: die Karte zeigt dann nur EINEN Pin, und die Story-Animation zeigt bei hin/retour
// nur den Hinweg (Rückweg wäre langweilig), beim Rundweg den ganzen Weg.

// Start/Ziel gelten als "gleiche Stelle", wenn näher als das. Bewusst absolut (kein relativer
// Anteil, der bei langen Punkt-zu-Punkt-Wegen zu locker würde).
const CLOSED_TOL_M = 120;
// hin/retour: mittlerer Abstand der gefalteten Hälften darunter -> deckungsgleich (Toleranz
// gegen Snapping-Jitter). Ein Rundweg (Hälften auf gegenüberliegenden Seiten) liegt weit drüber.
const OUT_AND_BACK_TOL_M = 30;

export type RouteShape = "point-to-point" | "loop" | "out-and-back";

// Liegen Start und Ziel (fast) auf derselben Stelle? (Leichtgewichtig, für die Karten-Pins.)
export function isClosedRoute(route: [number, number][] | null | undefined): boolean {
  const n = route?.length ?? 0;
  if (!route || n < 3) return false;
  return haversineMeters(route[0], route[n - 1]) <= CLOSED_TOL_M;
}

// Kumulierte Streckenlänge je Route-Index (out[0] = 0, out[n-1] = Gesamtlänge). Exportiert,
// weil sowohl classifyRoute (hier) als auch die Live-Navigation (bike-nav-core.ts, "wie weit
// ist der Nutzer entlang der Route") dieselbe Vorrechnung brauchen.
export function routeCumulativeMeters(route: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i++) {
    out.push(out[i - 1] + haversineMeters(route[i - 1], route[i]));
  }
  return out;
}

// [lng,lat] in ein lokales Meter-System um lat0 (klein genug für Wander-Ausdehnungen UND für
// eine Stadtrunde). Exportiert für nearestPointOnRoute unten.
export function toLocalM([lng, lat]: [number, number], lat0: number): [number, number] {
  const mPerDegLat = 110540;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return [lng * mPerDegLng, lat * mPerDegLat];
}

// Abstand Punkt<->Segment in Metern (lokal projiziert).
function pointSegDistM(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Mittlerer nächster Abstand von Stichproben auf A zur Polylinie B (Meter).
function meanNearestDistM(
  a: [number, number][],
  b: [number, number][],
  samples: number,
  lat0: number,
): number {
  if (a.length < 1 || b.length < 2) return Infinity;
  const bl = b.map((p) => toLocalM(p, lat0));
  const step = Math.max(1, Math.floor(a.length / samples));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += step) {
    const pl = toLocalM(a[i], lat0);
    let best = Infinity;
    for (let j = 1; j < bl.length; j++) {
      const d = pointSegDistM(pl, bl[j - 1], bl[j]);
      if (d < best) best = d;
    }
    sum += best;
    count++;
  }
  return count ? sum / count : Infinity;
}

// Die Route einordnen. turnaroundIndex = Wendepunkt (Distanz-Mitte) bei hin/retour, sonst der
// letzte Punkt (= ganze Route).
export function classifyRoute(route: [number, number][] | null | undefined): {
  shape: RouteShape;
  turnaroundIndex: number;
  closed: boolean;
} {
  const n = route?.length ?? 0;
  if (!route || n < 4) {
    return { shape: "point-to-point", turnaroundIndex: Math.max(0, n - 1), closed: false };
  }
  const last = n - 1;
  if (!isClosedRoute(route)) return { shape: "point-to-point", turnaroundIndex: last, closed: false };

  // In der Distanz-Mitte falten: bei exaktem hin/retour ist das der Wendepunkt.
  const cum = routeCumulativeMeters(route);
  const total = cum[last];
  if (total <= 0) return { shape: "loop", turnaroundIndex: last, closed: true };
  const halfDist = total / 2;
  let mid = 1;
  while (mid < last && cum[mid] < halfDist) mid++;
  if (mid < 2 || mid > last - 2) return { shape: "loop", turnaroundIndex: last, closed: true };

  const outbound = route.slice(0, mid + 1);
  const inbound = route.slice(mid).reverse(); // Wendepunkt -> Start, umgedreht wie der Hinweg
  const lat0 = route[0][1];
  const worst = Math.max(
    meanNearestDistM(outbound, inbound, 48, lat0),
    meanNearestDistM(inbound, outbound, 48, lat0),
  );
  if (worst > OUT_AND_BACK_TOL_M) return { shape: "loop", turnaroundIndex: last, closed: true };

  // Wendepunkt EXAKT bestimmen. Die reine Distanz-Mitte trifft ihn bei (durch Snapping) ungleich
  // langen Hälften knapp daneben (dann fehlt Weg oder der Kopf läuft am Ende zurück). "Am
  // weitesten vom Start" ist KEIN guter Wendepunkt: krümmt sich der Weg (z.B. Hochkeil), liegt
  // der echte Wendepunkt näher am Start als ein Punkt weiter vorne -> es fehlte viel Weg.
  //
  // Richtig: an der Faltstelle deckt sich der Rückweg mit dem Hinweg, also route[k+j] ≈ route[k-j]
  // für viele j. Diese lokale Symmetrie ist genau am Wendepunkt minimal (scharfes Minimum) und
  // unterscheidet ihn auch von Kehren/Serpentinen (dort passt die Symmetrie nur ganz kurz). Wir
  // suchen sie in einem Fenster um die Distanz-Mitte (dort liegt der Wendepunkt garantiert nah).
  const loc = route.map((p) => toLocalM(p, lat0));
  const win = Math.max(6, Math.floor(n * 0.25));
  const J = Math.max(4, Math.floor(n * 0.08));
  let bestK = mid;
  let bestErr = Infinity;
  for (let k = Math.max(1, mid - win); k <= Math.min(last - 1, mid + win); k++) {
    const jmax = Math.min(J, k, last - k);
    if (jmax < 2) continue;
    let sum = 0;
    for (let j = 1; j <= jmax; j++) {
      sum += Math.hypot(loc[k + j][0] - loc[k - j][0], loc[k + j][1] - loc[k - j][1]);
    }
    const err = sum / jmax;
    if (err < bestErr) {
      bestErr = err;
      bestK = k;
    }
  }
  return { shape: "out-and-back", turnaroundIndex: bestK, closed: true };
}

// Die zu animierende Route: bei hin/retour nur der Hinweg, sonst die ganze Route
// (Rundweg + Punkt-zu-Punkt). Für die Story-/Intro-Animation.
export function outboundRoute(route: [number, number][]): [number, number][] {
  const { shape, turnaroundIndex } = classifyRoute(route);
  return shape === "out-and-back" ? route.slice(0, turnaroundIndex + 1) : route;
}

// ——— Nächster Punkt auf einer Route (Live-Navigation) ——————————————————————————
// Wo auf der Route steht der Nutzer gerade? Liefert den nächstgelegenen Punkt AUF der
// Linie (nicht nur den nächsten Stützpunkt), den seitlichen Abstand dazu (crossTrackM –
// "wie weit neben der Route") und die Entfernung entlang der Route vom Start bis dorthin
// (alongM – Basis für "Distanz bis zur nächsten Abbiegung/zum Stopp"). Lokale Projektion
// (toLocalM) statt Haversine je Segment: bei den kurzen Segmenten einer Stadtroute ist der
// Unterschied nicht messbar, aber die lokale Projektion liefert den Lotfusspunkt gleich mit.
// Suchfenster für die Live-Navigation. OHNE dieses Fenster gewinnt schlicht das global
// nächstgelegene Segment, und das ist auf jeder Runde falsch, die dieselbe Gasse zweimal
// benutzt (Getreidegasse hinein und wieder heraus, Sackgasse, Schleife um einen Block):
// Hin- und Rückweg liegen dort wenige Meter auseinander, ein bisschen GPS-Rauschen
// entscheidet, welcher gewinnt, und der Fortschritt springt um die halbe Etappe. Gemessen
// mit `npm run nav:check` (Prüfung 7): 541 m Rückschritt auf einer 600-m-Etappe.
//
// `backM` klein, `fwdM` grosszügig: Zurückfallen tut man kaum, aber im Browser drosselt
// Safari die Ortung, sobald der Bildschirm sperrt. Nach so einer Lücke taucht der Gast
// weit vorne wieder auf, und ein enges Fenster hielte ihn fälschlich für abgekommen.
export type NearestOnRouteOpts = {
  nearAlongM: number;
  backM?: number;
  fwdM?: number;
  // Harter Boden für das Fenster, unabhängig von `nearAlongM`. Gebraucht bei
  // STICHWEGEN: Wo die Route sich selbst überlagert (hinauf und auf demselben Weg
  // zurück), liegen Hin- und Rückweg exakt übereinander. Die Suche unten nimmt bei
  // gleichem Abstand das zuerst indizierte Segment, also den HINWEG, und meldet damit
  // einen kleineren Fortschritt. Weil das Fenster dann um diesen kleineren Wert neu
  // zentriert wird, rutscht es beim nächsten Fix noch weiter zurück: Der Gast fährt
  // vorwärts, der Zähler läuft rückwärts. Gemessen auf der echten Runde A am 25.08.2026,
  // bei 3690 gefahrenen Metern meldete der Kern 2127 m.
  //
  // Der Boden allein reicht NICHT: Sobald der Fortschritt weit genug danebenliegt, ist die
  // Korrektur nach vorn grösser als der Stetigkeits-Riegel erlaubt, und der Fortschritt
  // friert fest. Gemessen: 460 statt 1000 m, dauerhaft.
  minAlongM?: number;
  // Deshalb der eigentliche Unterscheider: die FAHRTRICHTUNG. Auf einem Stichweg zeigt
  // der Hinweg nach Norden und der Rückweg nach Süden, physisch derselbe Ort. Wer weiss,
  // wohin der Gast schaut, weiss auch, auf welchem der beiden er ist. Ein Segment, das
  // seiner Richtung entgegenläuft, bekommt einen Aufschlag und gewinnt nur noch, wenn es
  // deutlich näher liegt.
  //
  // Fehlt der Wert (Safari liefert beim Stehen keine Richtung, und beim Stehen ist sie
  // ohnehin bedeutungslos), bleibt alles wie bisher.
  headingDeg?: number;
};

// Aufschlag auf ein Segment, das der Fahrtrichtung entgegenläuft. Gross genug, um bei
// deckungsgleichen Linien zu entscheiden, klein genug, dass ein wirklich näher liegendes
// Segment trotzdem gewinnt.
const WRONG_WAY_PENALTY_M = 25;

export function nearestPointOnRoute(
  route: [number, number][],
  p: [number, number],
  opts?: NearestOnRouteOpts,
): { segIndex: number; point: [number, number]; crossTrackM: number; alongM: number } | null {
  if (!route || route.length < 2) return null;
  const lat0 = p[1];
  const pl = toLocalM(p, lat0);
  const cum = routeCumulativeMeters(route);

  const heading = opts?.headingDeg;
  const search = (from: number, to: number) => {
    let seg = -1;
    let t0 = 0;
    let dist = Infinity;   // bewerteter Abstand (mit Richtungs-Aufschlag)
    let roh = Infinity;    // echter Abstand, der zurückgegeben wird
    for (let i = 1; i < route.length; i++) {
      // Segment ausserhalb des Fensters? Überspringen. `from`/`to` sind Strecken entlang
      // der Route, cum[] hat sie ohnehin schon.
      if (cum[i] < from || cum[i - 1] > to) continue;
      const a = toLocalM(route[i - 1], lat0);
      const b = toLocalM(route[i], lat0);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((pl[0] - a[0]) * dx + (pl[1] - a[1]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pl[0] - (a[0] + t * dx), pl[1] - (a[1] + t * dy));
      // Läuft das Segment der Fahrtrichtung entgegen? Dann Aufschlag. Nur bewerten, wenn
      // das Segment lang genug für eine sinnvolle Richtung ist.
      let bewertet = d;
      if (heading != null && len2 > 1) {
        const segDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
        const ab = Math.abs(((segDeg - heading + 540) % 360) - 180);
        if (ab > 90) bewertet += WRONG_WAY_PENALTY_M;
      }
      if (bewertet < dist) {
        dist = bewertet;
        roh = d;
        seg = i - 1;
        t0 = t;
      }
    }
    return { seg, t: t0, dist: roh };
  };

  let best = search(-Infinity, Infinity);
  if (opts) {
    const windowed = search(
      Math.max(opts.nearAlongM - (opts.backM ?? 50), opts.minAlongM ?? -Infinity),
      opts.nearAlongM + (opts.fwdM ?? 200),
    );
    // Der Treffer im Fenster gewinnt, SOLANGE er plausibel ist. Liegt er weiter weg als
    // die Off-Route-Schwelle (40 m, NAV in bike-nav-core.ts), ist der Gast entweder
    // wirklich abgekommen oder nach einer Ortungslücke woanders aufgetaucht. Dann zählt
    // wieder die globale Suche, und die vorhandene Entprellung entscheidet in Ruhe über
    // eine Neuberechnung. Ohne diesen Rückfall bliebe die Navigation im Fenster kleben.
    if (windowed.seg >= 0 && windowed.dist <= 40) best = windowed;
  }
  if (best.seg < 0) return null;

  const bestSeg = best.seg;
  const bestT = best.t;
  const bestDist = best.dist;

  const a = route[bestSeg];
  const b = route[bestSeg + 1];
  const point: [number, number] = [a[0] + (b[0] - a[0]) * bestT, a[1] + (b[1] - a[1]) * bestT];
  const segLen = cum[bestSeg + 1] - cum[bestSeg];
  const alongM = cum[bestSeg] + bestT * segLen;
  return { segIndex: bestSeg, point, crossTrackM: bestDist, alongM };
}

/**
 * Das Stueck einer Linie zwischen zwei Streckenmarken, in Metern ab Start.
 *
 * Gebraucht fuer die Fahransicht: Rot gezeichnet wird nur die AKTUELLE ETAPPE, von einem
 * Halt zum naechsten, nicht die ganze Runde. Damit verschwindet der doppelt befahrene
 * Uferkorridor aus dem Bild, solange er nicht dran ist, und die Linie kann sich nicht mehr
 * selbst ueberlagern.
 *
 * Die Enden werden auf dem Segment interpoliert, nicht auf den naechsten Stuetzpunkt
 * gerundet: Sonst ruckelte der Anfang der Etappe um bis zu einer Segmentlaenge.
 */
export function sliceAlong(
  route: [number, number][],
  fromM: number,
  toM: number,
): [number, number][] {
  if (!route || route.length < 2) return route ?? [];
  const cum = routeCumulativeMeters(route);
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(total, Math.min(fromM, toM)));
  const b = Math.max(0, Math.min(total, Math.max(fromM, toM)));
  if (b - a < 1) return [];

  const punktBei = (m: number): [number, number] => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < m) i++;
    const spanne = cum[i] - cum[i - 1];
    const t = spanne > 0 ? (m - cum[i - 1]) / spanne : 0;
    const p = route[i - 1];
    const q = route[i];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };

  const out: [number, number][] = [punktBei(a)];
  for (let i = 0; i < route.length; i++) {
    if (cum[i] > a && cum[i] < b) out.push(route[i]);
  }
  out.push(punktBei(b));
  return out;
}
