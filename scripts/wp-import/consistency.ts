// Stellt Feld und Fliesstext nebeneinander, damit Widersprüche auffallen. Aufruf:
//   npm run wp:consistency
//   npm run wp:consistency -- --only dauer
//
// WAS DAS SKRIPT TUT UND WAS NICHT: Es urteilt nicht. Es zieht aus den Texten jede Stelle
// heraus, die eine Zeit, eine Schwierigkeit oder eine Jahreszeit nennt, und stellt sie neben
// das Feld, in dem dieselbe Angabe steht. Die Entscheidung, ob „eine gute Stunde" zu
// „1 Std 10 min" passt, trifft ein Mensch.
//
// WARUM NICHT AUTOMATISCH VERGLEICHEN: Die Texte sagen „knapp vier Stunden", „eine Stunde
// zwanzig", „ein bis zwei Stunden, wenn du dir Zeit lässt". Ein Parser, der daraus Zahlen
// macht, liegt bei jeder dritten Formulierung daneben und meldet dann entweder Fehlalarme,
// die man wegzuschauen lernt, oder er schweigt bei den Fällen, auf die es ankommt. Die
// Extraktion ist mechanisch, das Urteil nicht.
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const TEXT_FIELDS = ["general", "insider_tip", "section_a", "section_b", "location_text"] as const;

/** Zahlwörter, wie sie in den Texten wirklich vorkommen, plus Ziffern. */
const NUM =
  "(?:ein(?:e|er|en)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|dreißig|vierzig|fünfzig|sechzig|" +
  "anderthalb|\\w*einhalb|" + // eineinhalb, zweieinhalb … dreizehneinhalb
  "fünfzehn|fünfundzwanzig|fünfunddreißig|fünfundvierzig|fünfundfünfzig|halbe|\\d+[.,]?\\d*)";

const RE = {
  dauer: new RegExp(
    `(?:[^.!?]*\\b(?:${NUM})\\s*(?:bis\\s*(?:${NUM})\\s*)?(?:Minuten|Minute|min\\b|Stunden|Stunde|Std\\b|Tag|Tage)[^.!?]*)`,
    "gi",
  ),
  schwierigkeit: /[^.!?]*\b(leicht|Leicht|mittelschwer|Mittelschwer|mittel|Mittel|schwer|Schwer|Trittsicherheit|Kondition|steil|anstrengend|exponiert)\b[^.!?]*/g,
  saison: /[^.!?]*\b(ganzjährig|Ganzjährig|Frühling|Frühjahr|Sommer|Herbst|Winter|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b[^.!?]*/g,
  anreise: /[^.!?]*\b(Bus|Buslinie|Zug|Bahn|S-Bahn|Öffis|Auto|Rad|zu Fuß|Postbus|Skibus|Ortsbus)\b[^.!?]*/g,
};

const clip = (s: string, n = 150) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function hits(texts: Record<string, string>, re: RegExp): string[] {
  const out: string[] = [];
  for (const f of TEXT_FIELDS) {
    const v = texts[f] ?? "";
    for (const m of v.matchAll(new RegExp(re.source, re.flags))) {
      const s = m[0].trim();
      if (s) out.push(`${f.replace("_", "")}: ${clip(s)}`);
    }
  }
  return out;
}

async function main() {
  const oi = process.argv.indexOf("--only");
  const only = oi >= 0 ? process.argv[oi + 1] : null;

  const { data: spots } = await db
    .from("spots")
    .select("id, slug, type, duration, difficulty, best_season, access, price_level, route_geojson")
    .order("slug");
  const { data: trs } = await db
    .from("spot_translations")
    .select("spot_id, general, insider_tip, section_a, section_b, location_text");
  if (!spots || !trs) throw new Error("Lesen fehlgeschlagen");
  const byId = new Map(trs.map((t) => [t.spot_id, t as unknown as Record<string, string>]));

  const BLOCKS: { name: string; field: (s: Record<string, unknown>) => string; re: RegExp }[] = [
    { name: "dauer", field: (s) => String(s.duration ?? "—"), re: RE.dauer },
    { name: "schwierigkeit", field: (s) => String(s.difficulty ?? "—"), re: RE.schwierigkeit },
    { name: "saison", field: (s) => String(s.best_season ?? "—"), re: RE.saison },
    { name: "anreise", field: (s) => String(s.access ?? "—"), re: RE.anreise },
  ];

  for (const s of spots) {
    const t = byId.get(s.id);
    if (!t) continue;
    const parts: string[] = [];
    for (const b of BLOCKS) {
      if (only && b.name !== only) continue;
      const found = hits(t, b.re);
      parts.push(`  ${b.name.toUpperCase()}  Feld: ${b.field(s)}`);
      for (const f of found) parts.push(`      ${f}`);
      if (!found.length) parts.push(`      (im Text nicht erwähnt)`);
    }
    console.log(
      `\n=== ${s.slug}${s.route_geojson ? "  [Route]" : ""}${s.type === "food" ? "  [FOOD]" : ""}`,
    );
    console.log(parts.join("\n"));
  }
  console.log(`\n${spots.length} Spots.`);
}

main();
