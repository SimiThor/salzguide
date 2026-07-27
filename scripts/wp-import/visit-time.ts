// Trägt die Besuchsdauer für die Spots nach, die keine gerechnete Route haben. Aufruf:
//   npm run wp:visit-time
//   npm run wp:visit-time -- --go
//
// Bei einer Wanderung rechnet `geo.ts` die Dauer aus der Linie. Ein Museum, eine Therme
// oder ein Platz hat keine Linie, und der Import liess das Feld deshalb leer: 24 Spots ohne
// jede Zeitangabe, obwohl fast jeder Text eine nennt.
//
// WOHER DIE ZAHL KOMMT: aus dem eigenen Fliesstext, nicht aus dem Gefühl. Die Regel dafür
// steht unten bei jedem Eintrag als Zitat. Wo der Text eine Spanne nennt, gilt die OBERE
// Zahl — gefragt ist, wie lange man für den Spot braucht, um ihn anzusehen und zu geniessen,
// nicht wie schnell man durchkommt. „Ein halber Tag" zählt dabei nicht als obere Grenze,
// sondern als der Ausnahmefall, den der Text danebenstellt.
//
// DREI SPOTS HATTEN GAR KEINE ZAHL IM TEXT: Almkanal, Böndlsee und der Hintersee-Badeplatz
// sind Badeplätze, und wie lange man dort bleibt, sagt kein Text. Sie bekommen zwei Stunden
// als Planungswert, und der Satz dazu steht in den Entwürfen unter .wp-cache/drafts — dort
// gehört Text hin. Ein Skript, das Sätze anhängt, wird vom nächsten Import überschrieben.
//
// AUSSERDEM VEREINHEITLICHT: Sechs Punkt-Spots trugen die Rohform der alten Seite („2 h",
// „1 h"). Alles heisst jetzt „Std", wie `formatDuration` es schreibt.
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

type Eintrag = { slug: string; dauer: string; beleg: string };

const DAUER: Eintrag[] = [
  // Thermen: der Text nennt zwei bis drei Stunden, gefragt ist die obere.
  { slug: "alpentherme", dauer: "3 Std", beleg: "„Zwei bis drei Stunden gehen leicht drauf“" },
  { slug: "felsentherme", dauer: "3 Std", beleg: "„Zwei bis drei Stunden gehen leicht drauf“" },

  // Ausnahme von der Oberkante-Regel: Beim Hangar-7 hat Anton widersprochen. Die Halle ist
  // in zwei Stunden gesehen, drei wären eine Einladung zum Langweilen.
  { slug: "hangar-7", dauer: "2 Std", beleg: "Anton: zwei Stunden reichen; der Text sagt es doppelt („geht nach zwei Stunden wieder“)" },

  // Stadt und Kultur
  { slug: "mirabellgarten", dauer: "1 Std", beleg: "„Eine Stunde reicht für einen Rundgang“" },
  { slug: "makartplatz", dauer: "1 Std", beleg: "„Eine halbe bis eine Stunde, je nachdem wie lange du fotografierst“" },
  { slug: "wasserfall-bad-gastein", dauer: "1 Std", beleg: "„Dreißig bis sechzig Minuten“" },
  { slug: "kaiser-wilhelm-promenade", dauer: "1 Std 30 min", beleg: "„rund eine Stunde … eher anderthalb“" },
  { slug: "lamprechtshohle", dauer: "1 Std 30 min", beleg: "„Eine bis anderthalb Stunden für den begehbaren Teil“" },
  { slug: "blick-auf-hohenwerfen", dauer: "10 min", beleg: "„Zehn Minuten reichen“" },

  // Wasser und Fahrten
  { slug: "wolfgangsee-schifffahrt", dauer: "45 min", beleg: "„Fünfundvierzig Minuten für die Fahrt in eine Richtung“" },
  { slug: "sommerrodelbahn-abtenau", dauer: "1 Std", beleg: "„für die Bahn insgesamt rechne eine Stunde“" },
  { slug: "postalm", dauer: "2 Std", beleg: "„für den Pitschenberg rechne zwei“" },

  // Winter am Berg
  { slug: "early-winter-mountainkart", dauer: "1 Std", beleg: "„Rund eine Stunde von der Talstation bis retour“" },
  { slug: "panoramakugel-sportgastein", dauer: "20 min", beleg: "„mit Fotos und Pause rund zwanzig Minuten“" },
  { slug: "stubnerkogel", dauer: "45 min", beleg: "„rechne dreißig bis fünfundvierzig Minuten“" },
  { slug: "glocknerblick-aussichtsplattform", dauer: "1 Std 30 min", beleg: "„rechne eine bis anderthalb Stunden“" },
  { slug: "aussichtsplattform-schlossalmblick", dauer: "1 Std 30 min", beleg: "„als ganze Runde über den Panoramaweg gut eineinhalb Stunden“" },
  { slug: "gipfelbahn-fulseck", dauer: "2 Std", beleg: "„der Schneeschuhtrail in rund zwei Stunden“" },
  { slug: "stubnerkogelbahn", dauer: "4 Std", beleg: "„ist ein halber Tag weg“" },
  { slug: "schlossalmbahn", dauer: "6 Std", beleg: "„vier bis sechs Stunden auf der Piste plus Pausen“" },
  { slug: "goldbergbahn", dauer: "6 Std", beleg: "„einen halben bis ganzen Skitag“" },

  // Badeplätze: keine Zahl im Text, deshalb kommt sie dort auch dazu (siehe TEXT_ZUSATZ).
  { slug: "almkanal", dauer: "2 Std", beleg: "Badeplatz, Planungswert für Hinweg und Bleiben" },
  { slug: "bondlsee", dauer: "2 Std", beleg: "Badeplatz, Planungswert" },
  { slug: "hintersee-badeplatz", dauer: "2 Std", beleg: "Badeplatz, Planungswert (die Seerunde allein dauert anderthalb)" },

  // Rohform der alten Seite vereinheitlichen.
  { slug: "grosglockner-hochalpenstrase", dauer: "2 Std", beleg: "war „2 h“, Schreibweise angeglichen" },
  { slug: "seisenbergklamm", dauer: "2 Std", beleg: "war „2 h“, Schreibweise angeglichen" },
  { slug: "rossfeld-panoramastrase", dauer: "1 Std", beleg: "war „1 h“, Schreibweise angeglichen" },
];

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots } = await db.from("spots").select("id, slug, duration, route_geojson");
  if (!spots) throw new Error("Lesen fehlgeschlagen");
  const bySlug = new Map(spots.map((s) => [s.slug, s]));

  let n = 0;
  for (const e of DAUER) {
    const s = bySlug.get(e.slug);
    if (!s) throw new Error(`Spot ${e.slug} gibt es nicht`);
    // Wo eine Route liegt, rechnet der Import die Dauer. Diese Liste darf sie nicht
    // überschreiben, sonst stünde im Feld eine Zahl, die zur Linie nicht passt.
    if (s.route_geojson) throw new Error(`${e.slug} hat eine Route, die Dauer kommt von dort`);
    if (s.duration === e.dauer) continue;
    console.log(`  ${go ? "ok   " : "würde"} ${e.slug.padEnd(34)} ${String(s.duration ?? "—").padEnd(8)} -> ${e.dauer}`);
    console.log(`        ${e.beleg}`);
    if (go) {
      const { error } = await db.from("spots").update({ duration: e.dauer }).eq("id", s.id);
      if (error) throw error;
    }
    n++;
  }

  console.log(`
${n} Dauer-Werte${go ? " geschrieben" : ""}.`);
  if (!go) console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:visit-time -- --go");
}

main();
