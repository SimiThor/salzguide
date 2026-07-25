// Planer für den Intro-Render-Workflow.
//
// Beantwortet die eine Frage, die vor dem Rendern zu klären ist: Welche Spots sind
// überhaupt dran? Ohne den würde ein "alle rendern"-Knopf auch die sechs Videos neu
// bauen, die längst aktuell sind - eine halbe Stunde Rechenzeit für nichts.
//
// Gibt die Liste als JSON auf STDOUT, damit der Workflow sie in eine Matrix füttern kann
// (ein Runner pro Spot, parallel). Alles Menschenlesbare geht nach STDERR, sonst landet es
// in der Matrix.
//
// Aufruf:
//   node --experimental-strip-types scripts/intro-render-plan.ts            # nur schauen
//   node --experimental-strip-types scripts/intro-render-plan.ts nockstein  # nur dieser eine
//   node --experimental-strip-types scripts/intro-render-plan.ts --commit   # + Status setzen
//
// OHNE --commit fasst der Planer nichts an. Das ist Absicht: Wer nachschaut, was anstünde,
// darf damit nicht sechs Spots im Admin auf "in Warteschlange" stellen, hinter der dann
// kein Lauf steht.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { introNeedsRender } from "../src/lib/intro-hash.ts";

function loadDotEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}
const ENV = { ...loadDotEnv(), ...process.env } as Record<string, string | undefined>;

const argv = process.argv.slice(2);
const only = argv.find((a) => a && !a.startsWith("--"));
const commit = argv.includes("--commit");

const supaUrl = ENV.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = ENV.SUPABASE_SERVICE_ROLE_KEY;
if (!supaUrl || !supaKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen.");
  process.exit(1);
}
const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

// Dieselbe Auswahl wie die Admin-Liste (getIntroRenderList): veröffentlichte Aktivitäten
// mit echter LineString-Route. Wer keine Route hat, hat auch kein Intro.
//
// Ausnahme beim Einzelauftrag: Dort zählt nur die Route, nicht der Veröffentlichungsstand.
// Das Intro eines Entwurfs fertig zu haben, BEVOR er online geht, ist der Normalfall; die
// Spot-Unterseite bietet den Knopf dort ebenfalls an.
const listQuery = supabase
  .from("spots")
  .select("slug, route_geojson, intro_video_url, intro_source_hash")
  .not("route_geojson", "is", null)
  .order("sort_weight", { ascending: false });

const { data, error } = await (only
  ? listQuery.eq("slug", only)
  : listQuery.eq("type", "activity").eq("status", "published"));

if (error) {
  console.error(`Spots laden fehlgeschlagen: ${error.message}`);
  process.exit(1);
}

type Row = {
  slug: string;
  route_geojson: { type?: string } | null;
  intro_video_url: string | null;
  intro_source_hash: string | null;
};

const rows = ((data ?? []) as Row[]).filter((s) => s.route_geojson?.type === "LineString");

// Dieselbe Funktion, die auch die Admin-Liste befragt (introNeedsRender). Nur so können
// Knopf und Workflow nicht auseinanderlaufen.
const needsRender = (s: Row) =>
  introNeedsRender(s.route_geojson, s.intro_video_url, s.intro_source_hash);

let picked: string[];
if (only) {
  if (!rows.some((s) => s.slug === only)) {
    console.error(`Kein renderbarer Spot mit slug "${only}" (existiert er, hat er eine Route?).`);
    process.exit(1);
  }
  picked = [only]; // Einzelauftrag rendert immer, auch wenn das Video aktuell wäre.
} else {
  picked = rows.filter(needsRender).map((s) => s.slug);
}

console.error(`${rows.length} Spot(s) mit Route, davon ${picked.length} zu rendern:`);
for (const s of rows) {
  const mark = picked.includes(s.slug) ? "->" : "  ";
  console.error(`  ${mark} ${s.slug}${needsRender(s) ? "" : " (aktuell)"}`);
}

// Die ausgewählten sofort auf 'queued' setzen, damit die Admin-Seite die Warteschlange
// zeigt, bevor der erste Runner überhaupt startet. Best-effort wie im Render-Skript.
if (picked.length && commit) {
  const { error: upErr } = await supabase
    .from("spots")
    .update({
      intro_render_status: "queued",
      intro_render_error: null,
      intro_render_started_at: new Date().toISOString(),
    })
    .in("slug", picked);
  if (upErr) console.error(`  (Status 'queued' nicht gesetzt: ${upErr.message})`);
}

process.stdout.write(JSON.stringify(picked));
