// Korrigiert Quick-Facts, die dem eigenen Fliesstext widersprechen oder leer geblieben
// sind. Aufruf:
//   npm run wp:facts          zeigt, was passieren würde
//   npm run wp:facts -- --go  schreibt
//
// GEFUNDEN MIT `npm run wp:consistency`. Das Skript dort stellt Feld und Text nebeneinander
// und urteilt nicht; hier steht das Urteil, je Zeile mit dem Satz aus dem Text, der es
// trägt. Wer später eine dieser Zeilen anzweifelt, findet die Begründung daneben und muss
// nicht suchen.
//
// WARUM DAS ÜBERHAUPT NÖTIG IST: Die Felder kommen aus den Quick-Facts der alten Seite, die
// Texte sind neu geschrieben. Wo die alte Seite danebenlag, steht es jetzt doppelt da: eine
// Wanderung, die als „mittel" ausgezeichnet ist und deren Text „kaum Höhenmeter" sagt,
// widerspricht sich auf derselben Bildschirmseite.
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

type Fix = { slug: string; field: string; value: string; warum: string };

/** Das Feld sagt etwas anderes als der Text daneben. */
const WIDERSPRUCH: Fix[] = [
  {
    slug: "asitz",
    field: "difficulty",
    value: "leicht",
    warum: 'Text: „2,6 Kilometer und kaum Höhenmeter" — eine flache Stunde ab der Bergstation',
  },
  {
    slug: "burglstein",
    field: "difficulty",
    value: "leicht",
    warum: 'Text: „700 Meter und 20 Höhenmeter … sonst ist es harmlos"',
  },
  {
    slug: "gaisberg",
    field: "access",
    value: "beides",
    warum: 'Text: „Der Bus 151 fährt direkt rauf" — das Feld sagte „nur Auto"',
  },
  {
    slug: "prinzensee",
    field: "access",
    value: "beides",
    warum: 'Text: „der Skibus der Region fährt auch hin"',
  },
  {
    slug: "schafberg",
    field: "access",
    value: "beides",
    warum: 'Text: „mit dem Bus kommst du auch hin"',
  },
  {
    // Kein Widerspruch im Inhalt, aber im Format: überall sonst steht „1 Std", hier stand
    // die rohe Schreibweise der alten Seite.
    slug: "festung-hohensalzburg",
    field: "duration",
    value: "1 Std",
    warum: 'alte Rohform „1h gesamt", alle anderen Felder heissen „1 Std"',
  },
];

/** Das Feld ist leer, der Text sagt es klar. Nichts wird dazuerfunden: Jede Zeile zitiert
 *  den Satz, der sie trägt. Wo der Text nichts hergibt, bleibt das Feld leer. */
const LUECKE: Fix[] = [
  { slug: "alpentherme", field: "difficulty", value: "leicht", warum: '„Kein Weg und keine Höhenmeter"' },
  { slug: "felsentherme", field: "difficulty", value: "leicht", warum: '„Sportlich ist hier nichts"' },
  { slug: "glocknerblick-aussichtsplattform", field: "difficulty", value: "leicht", warum: '„Sehr leicht, aber alpin"' },
  { slug: "stubnerkogel", field: "difficulty", value: "leicht", warum: '„Technisch leicht, aber exponiert"' },
  { slug: "stubnerkogelbahn", field: "difficulty", value: "leicht", warum: '„Die Wege oben sind kurz und leicht"' },
  { slug: "panoramakugel-sportgastein", field: "difficulty", value: "leicht", warum: '„Technisch einfach, aber hochalpin"' },
  { slug: "kaiser-wilhelm-promenade", field: "difficulty", value: "leicht", warum: '„Fast durchgehend eben, ohne steile Stellen"' },
  { slug: "wasserfall-bad-gastein", field: "difficulty", value: "leicht", warum: '„Ein Stadtspaziergang mit ein paar Stufen"' },
  { slug: "early-winter-mountainkart", field: "difficulty", value: "leicht", warum: '„Können brauchst du keins"' },
  { slug: "aussichtsplattform-schlossalmblick", field: "difficulty", value: "leicht", warum: '„flach und präpariert"' },
  { slug: "gipfelbahn-fulseck", field: "difficulty", value: "mittel", warum: '„alpines Gelände: Grundkondition, Trittsicherheit"' },
  { slug: "schlossalmbahn", field: "difficulty", value: "mittel", warum: '„ist als mittel eingestuft"' },
  { slug: "goldbergbahn", field: "difficulty", value: "schwer", warum: '„Pisten meist rot und hochalpin … für Anfänger nur bedingt"' },

  { slug: "alpentherme", field: "best_season", value: "Ganzjährig", warum: '„Ganzjährig geöffnet, am schönsten aber im Winter"' },
  { slug: "felsentherme", field: "best_season", value: "Ganzjährig", warum: '„Ganzjährig offen und im Winter am schönsten"' },
  { slug: "aussichtsplattform-schlossalmblick", field: "best_season", value: "Winter", warum: '„Im Winter, solange die Schlossalmbahn fährt"' },
  { slug: "early-winter-mountainkart", field: "best_season", value: "Winter", warum: '„Früher Winter, wenn die Pisten präpariert sind"' },
  { slug: "gipfelbahn-fulseck", field: "best_season", value: "Winter", warum: '„Winter, solange die Skischaukel läuft"' },
  { slug: "glocknerblick-aussichtsplattform", field: "best_season", value: "Winter", warum: '„Winter, wenn die Stubnerkogelbahn läuft"' },
  { slug: "goldbergbahn", field: "best_season", value: "Winter", warum: '„Winter, und je mehr Schnee liegt, desto besser"' },
  { slug: "kaiser-wilhelm-promenade", field: "best_season", value: "Winter", warum: '„Winter, an einem klaren Tag am Vormittag"' },
  { slug: "panoramakugel-sportgastein", field: "best_season", value: "Winter", warum: '„Winter, und dann an einem klaren, windstillen Tag"' },
  { slug: "schlossalmbahn", field: "best_season", value: "Winter", warum: '„Winter, solange die Bahn fährt"' },
  { slug: "stubnerkogel", field: "best_season", value: "Winter", warum: '„Winter, an einem klaren und windstillen Tag"' },
  { slug: "stubnerkogelbahn", field: "best_season", value: "Winter", warum: '„Winter, solange die Bahn fährt"' },
  { slug: "wasserfall-bad-gastein", field: "best_season", value: "Winter", warum: '„Winter, wenn Eis und Schnee dazukommen"' },
];

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots } = await db
    .from("spots")
    .select("id, slug, difficulty, best_season, access, duration");
  if (!spots) throw new Error("Lesen fehlgeschlagen");
  const bySlug = new Map(spots.map((s) => [s.slug, s as Record<string, unknown>]));

  let done = 0;
  let already = 0;
  for (const [titel, liste] of [
    ["WIDERSPRUCH", WIDERSPRUCH],
    ["LÜCKE", LUECKE],
  ] as const) {
    console.log(`\n── ${titel} ──`);
    for (const fix of liste) {
      const spot = bySlug.get(fix.slug);
      if (!spot) throw new Error(`Spot ${fix.slug} gibt es nicht`);
      const ist = spot[fix.field] ?? null;
      if (ist === fix.value) {
        already++;
        continue;
      }
      // Bei einer Lücke darf nur ein leeres Feld gefüllt werden. Steht dort inzwischen ein
      // Wert, hat ihn jemand von Hand gesetzt, und der gewinnt gegen diese Liste.
      if (titel === "LÜCKE" && ist !== null) {
        console.log(`  ÜBERSPRUNGEN ${fix.slug} ${fix.field}: steht schon auf „${ist}"`);
        continue;
      }
      console.log(
        `  ${go ? "ok   " : "würde"} ${fix.slug.padEnd(34)} ${fix.field.padEnd(12)} ${String(ist ?? "—").padEnd(14)} -> ${fix.value}`,
      );
      console.log(`        ${fix.warum}`);
      if (go) {
        const { error } = await db
          .from("spots")
          .update({ [fix.field]: fix.value })
          .eq("id", spot.id as string);
        if (error) throw error;
      }
      done++;
    }
  }
  console.log(`\n${done} Korrekturen${go ? " geschrieben" : ""}, ${already} sassen schon richtig.`);
  if (!go) console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:facts -- --go");
}

main();
