// Prüft die deutschen Text-Entwürfe gegen die Regeln aus BRAND_VOICE, bevor sie in die
// Datenbank gehen. Aufruf:  npm run wp:check
//
// WARUM MASCHINELL: Die Regeln sind einzeln banal (keine Gedankenstriche, ca. 50 Wörter,
// kein „malerisch"), aber es sind sechs Felder mal 95 Spots. Von Hand gelesen rutscht genau
// das durch, was man beim zwanzigsten Text nicht mehr sieht. Und ein Text, der einmal in
// der Datenbank steht, wird in zwölf Sprachen übersetzt, bevor jemand ihn nochmal liest.
//
// Der Gedankenstrich-Test importiert `hasEmDash` aus der App, statt die Regel nachzubauen:
// em-dash.ts unterscheidet den verbotenen Gedankenstrich (U+2014) vom erlaubten
// Halbgeviertstrich (U+2013), und ein Nachbau würde genau da danebenliegen.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { hasEmDash } from "../../src/lib/em-dash.ts";

const CACHE_DIR = ".wp-cache";
const SOURCE_DIR = join(CACHE_DIR, "source");
const DRAFT_DIR = join(CACHE_DIR, "drafts");

// Die Ziel-Längen stehen im Prompt von generateSpotTexts (lib/admin-actions.ts). Hier mit
// Toleranz nach beiden Seiten: „ca. 50 Wörter" ist eine Vorgabe für einen Menschen, keine
// Zeichenzahl. Es geht darum, Ausreisser zu finden, nicht um Millimeterarbeit.
const LIMITS: Record<string, { activity: [number, number]; food: [number, number] }> = {
  general: { activity: [55, 90], food: [40, 65] },
  insiderTip: { activity: [35, 62], food: [35, 62] },
  sectionA: { activity: [18, 34], food: [12, 28] },
  sectionB: { activity: [14, 28], food: [14, 28] },
  locationText: { activity: [18, 34], food: [18, 34] },
  shortDesc: { activity: [4, 8], food: [4, 8] },
};

// Wörter, die BRAND_VOICE ausdrücklich verbietet. „Geheimtipp" steht bewusst NICHT hier:
// Es ist der Produktname für einen gesperrten Pro-Spot und in dieser Bedeutung richtig.
// Als Anpreisung im Fliesstext wäre es falsch, aber das kann eine Wortliste nicht
// unterscheiden, und ein Fehlalarm bei jedem Lauf trainiert einem das Wegschauen an.
const FORBIDDEN = [
  "thront", "malerisch", "atemberaubend", "atemberaubende", "magisch", "verzaubert",
  "goldener herbst", "episch", "paradies", "juwel", "perle", "ein muss",
  "prospekt", "broschüre", "reiseführer", "losziehen", "zieh los", "loszieht",
];

// Sätze, die den Leser woanders hinschicken. BRAND_VOICE verbietet sie eigens: Eine
// Spot-Beschreibung erzählt, wie ein Ort IST, sie ist keine To-do-Liste fürs Planen.
const LOOK_IT_UP = /\b(check|checken|checkst|nachschauen|nachsehen|vorher anrufen|googeln|im voraus prüfen|überprüfen, ob)\b/i;

type Draft = Record<string, string>;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function main() {
  if (!existsSync(DRAFT_DIR)) throw new Error(`${DRAFT_DIR} fehlt`);
  const files = readdirSync(DRAFT_DIR).filter((f) => f.endsWith(".json"));
  let problems = 0;

  for (const file of files.sort()) {
    const slug = file.replace(/\.json$/, "");
    const draft = JSON.parse(readFileSync(join(DRAFT_DIR, file), "utf8")) as Draft;

    // Food oder Activity muss aus der QUELLE kommen, nicht aus dem Entwurf: Der Entwurf
    // enthält nur Text, und die Längen-Vorgaben unterscheiden sich je Typ deutlich.
    const srcFile = join(SOURCE_DIR, file);
    const src = existsSync(srcFile)
      ? (JSON.parse(readFileSync(srcFile, "utf8")) as {
          facts: { field: string }[];
          sections: { label: string }[];
        })
      : null;
    const isFood =
      !!src &&
      (src.facts.some((f) => f.field === "cuisine") ||
        src.sections.some((s) => s.label === "Küche & Stil"));
    const kind = isFood ? "food" : "activity";

    const lines: string[] = [];
    for (const [field, ranges] of Object.entries(LIMITS)) {
      const text = draft[field];
      if (!text) {
        lines.push(`  ${field}: fehlt`);
        continue;
      }
      const [lo, hi] = ranges[kind];
      const n = words(text);
      if (n < lo || n > hi) lines.push(`  ${field}: ${n} Wörter (Ziel ${lo}-${hi})`);
    }

    const all = Object.values(draft).join(" ");
    const lower = all.toLowerCase();
    for (const w of FORBIDDEN) if (lower.includes(w)) lines.push(`  verbotenes Wort: „${w}"`);
    if (hasEmDash(all, "de")) lines.push("  Gedankenstrich (U+2014) im Text");
    const lookup = LOOK_IT_UP.exec(all);
    if (lookup) lines.push(`  schickt den Leser zum Nachschauen: „${lookup[0]}"`);
    if (draft.shortDesc?.trim().endsWith(".")) lines.push("  shortDesc endet mit einem Punkt");

    if (lines.length) {
      problems += lines.length;
      console.log(`${slug} (${kind})`);
      for (const l of lines) console.log(l);
      console.log("");
    }
  }

  console.log(
    problems
      ? `${files.length} Entwürfe geprüft, ${problems} Beanstandungen.`
      : `${files.length} Entwürfe geprüft, alles sauber.`,
  );
  if (problems) process.exitCode = 1;
}

main();
