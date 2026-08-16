// Rechnet Dauer und Schwierigkeit aller Spots mit Route neu. Aufruf:
//   npm run wp:hiking-times          zeigt, was passieren würde
//   npm run wp:hiking-times -- --go  schreibt
//
// WARUM ES DAS BRAUCHT: `duration` ist ein eingefrorener String in der Datenbank. Ändert
// sich die Formel in `src/lib/geo.ts`, ändert sich davon kein einziger gespeicherter Wert —
// der Admin müsste jeden Spot einzeln neu snappen. Genau deshalb hat die App nach der
// Formel-Korrektur (DIN 33466 -> SAC, siehe geo.ts) weiter die alten, viel zu langen Zeiten
// gezeigt. Dieses Skript ist die Nachrechnung für den Bestand.
//
// ES SNAPPT NICHT NEU. Linie und Höhenprofil bleiben unangetastet; gerechnet wird aus dem,
// was gespeichert ist (distanceKm, ascent, descent). Neue ORS-Anfragen würden die Linien
// verschieben und wären ein zweites Risiko im selben Schritt.
//
// SCHWIERIGKEIT NUR VERSCHÄRFEN: Der Vorschlag aus `suggestDifficulty` kennt nur Länge und
// Höhenmeter. Ausgesetztheit, Klettersteig, Trittsicherheit stehen nirgends im System. Eine
// von Hand höher gesetzte Einstufung darf ein Skript deshalb nicht wegnehmen; solche Fälle
// werden nur aufgelistet, damit ein Mensch entscheidet.
//
// CACHE: Das Skript schreibt an der App vorbei, kann also kein `updateTag(SPOTS_TAG)`
// rufen. Der Katalog fängt sich über das Fünf-Minuten-Netz in `src/lib/spots.ts` von selbst.
import { createClient } from "@supabase/supabase-js";
import {
  hikingTimeMinutes,
  formatHikingDuration,
  suggestDifficulty,
  routeLengthKm,
} from "../../src/lib/geo.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** Reihenfolge, damit „nur verschärfen" eine Frage von grösser/kleiner ist. */
const STUFEN = ["leicht", "mittel", "schwer"];
const stufe = (s: string | null) => STUFEN.indexOf((s ?? "").trim().toLowerCase());

type Profil = { ascent: number; descent: number; distanceKm: number } | null;

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots, error } = await db
    .from("spots")
    .select("id, slug, duration, difficulty, route_geojson, elevation_profile")
    .order("slug");
  if (error) throw error;

  let geaendert = 0;
  let stufeGesetzt = 0;
  const ohneProfil: string[] = [];
  const zuPruefen: string[] = [];

  for (const s of spots!) {
    const geo = s.route_geojson as { coordinates?: [number, number][] } | null;
    const coords = (geo?.coordinates ?? []) as [number, number][];
    const ep = s.elevation_profile as Profil;
    // Ohne Route ist die Dauer eine kuratierte Besuchsdauer (npm run wp:visit-time).
    // Die gehört nicht dieser Formel und wird nicht angefasst.
    if (!coords.length && !ep) continue;
    if (!ep) {
      ohneProfil.push(s.slug);
      continue;
    }

    const km = ep.distanceKm || routeLengthKm(coords);
    const dauer = formatHikingDuration(hikingTimeMinutes(km, ep.ascent, ep.descent));
    const vorschlag = suggestDifficulty(km, ep.ascent);
    const alt = (s.difficulty as string | null) ?? "";

    // Leeres Feld füllen oder verschärfen. Eine kuratierte höhere Stufe bleibt.
    const haerter = stufe(vorschlag) > stufe(alt);
    const neueStufe = haerter ? vorschlag : null;
    if (!haerter && alt && stufe(vorschlag) < stufe(alt)) {
      zuPruefen.push(`${s.slug.padEnd(30)} steht auf ${alt}, gerechnet wäre ${vorschlag}`);
    }

    const dauerNeu = dauer !== (s.duration ?? "");
    if (!dauerNeu && !neueStufe) continue;

    console.log(
      [
        `  ${go ? "ok   " : "würde"}`,
        s.slug.padEnd(30),
        `${km.toFixed(1)} km ↑${ep.ascent}`.padStart(16),
        dauerNeu ? `${String(s.duration ?? "—").padEnd(14)} -> ${dauer}` : `${dauer} (unverändert)`,
        neueStufe ? `· Stufe ${alt || "—"} -> ${neueStufe}` : "",
      ].join(" "),
    );

    if (dauerNeu) geaendert++;
    if (neueStufe) stufeGesetzt++;

    if (go) {
      const patch: Record<string, string> = {};
      if (dauerNeu) patch.duration = dauer;
      if (neueStufe) patch.difficulty = neueStufe;
      const { error: e2 } = await db.from("spots").update(patch).eq("id", s.id);
      if (e2) throw e2;
    }
  }

  if (ohneProfil.length) {
    console.log(`\nRoute ohne Höhenprofil, übersprungen: ${ohneProfil.join(", ")}`);
    console.log("  (im Admin einmal Route anpassen drücken, dann liegt ein Profil vor)");
  }
  if (zuPruefen.length) {
    console.log(`\nStrenger eingestuft als die Zahlen hergeben (bleibt so, bitte anschauen):`);
    for (const z of zuPruefen) console.log(`  ${z}`);
  }

  console.log(
    `\n${geaendert} Dauer-Werte${go ? " geschrieben" : ""}, ${stufeGesetzt} Schwierigkeiten${go ? " gesetzt" : ""}.`,
  );
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:hiking-times -- --go");
    return;
  }
  console.log("Danach: npm run wp:audit  (zeigt jetzt die Texte, die der neuen Zahl widersprechen)");
}

main();
