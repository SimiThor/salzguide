// Fakten-Prüfung der deutschen Spot-Texte gegen die gemessenen Daten. Aufruf:
//   npm run wp:audit
//
// WAS DAS HIER KANN, UND WAS NICHT: Diese Prüfung kann nur nachrechnen, was im System
// selbst gemessen ist: Länge und Höhenmeter aus dem Höhenprofil, die Dauer aus der
// DAV-Formel, die Quick-Facts aus den Feldern. Ob der Lackenkogel wirklich 2.051 Meter hoch
// ist oder das Café wirklich seit 1950 existiert, steht nirgends im System und kann eine
// Maschine hier nicht wissen. Solche Angaben listet der Lauf am Ende nur AUF, damit sie ein
// Mensch nachschlägt, statt sie stillschweigend für richtig zu halten.
//
// WARUM ES DIESE PRÜFUNG BRAUCHT: `wp:consistency` stellt Feld und Text nebeneinander und
// urteilt nicht. Genau deshalb ist beim Lackenkogel niemandem aufgefallen, dass im
// Fliesstext 740 und in den Fakten 760 Höhenmeter stehen. Zwei Zahlen, die dasselbe messen
// sollten, aber auseinanderlaufen, findet nur ein Vergleich, der rechnet.
import { createClient } from "@supabase/supabase-js";
import { TARGET_LOCALES } from "../../src/i18n/locales.ts";
import { selectAll } from "./select-all.ts";
import { hoursInText, hourMatches, fieldHours } from "./hours-i18n.ts";

/**
 * Die Regel steht in `src/lib/brand-voice.ts`, dort aber als Prosa im Prompt-Text und nicht
 * als Liste. Hier steht nur die maschinell prüfbare Teilmenge: die Wörter, deren blosses
 * Vorkommen schon der Verstoss ist. „Prospekt" ist auch in den Zielsprachen verboten, weil
 * der Vergleich uns datiert, statt uns abzugrenzen.
 */
const VERBOTEN: Record<string, string[]> = {
  de: ["losziehen", "zieh los", "Prospekt", "Broschüre"],
  en: ["brochure"],
  it: ["depliant", "dépliant", "opuscolo"],
  nl: ["brochure", "folder"],
  fr: ["brochure", "dépliant"],
  es: ["folleto"],
  pt: ["brochura", "folheto"],
  zh: ["小册子"],
  ko: ["브로슈어"],
};

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** Deutsche Zahlwörter, wie sie in den Texten vorkommen. Halbe Stunden inbegriffen. */
const WORT: Record<string, number> = {
  eine: 1, einer: 1, ein: 1, anderthalb: 1.5, eineinhalb: 1.5,
  zwei: 2, zweieinhalb: 2.5, drei: 3, dreieinhalb: 3.5, vier: 4, viereinhalb: 4.5,
  fünf: 5, fünfeinhalb: 5.5, sechs: 6, sechseinhalb: 6.5, sieben: 7, siebeneinhalb: 7.5,
  acht: 8, achteinhalb: 8.5, neun: 9, neuneinhalb: 9.5, zehn: 10, elf: 11, zwölf: 12,
  dreizehn: 13, dreizehneinhalb: 13.5, vierzehn: 14, fünfzehn: 15,
};

/** „8,2 Kilometer" -> 8.2 · „1.600 Höhenmeter" -> 1600 */
function zahl(roh: string): number {
  return Number(roh.replace(/\./g, "").replace(",", "."));
}

/** Alle Kilometer-Angaben im Text. */
function kmImText(t: string): number[] {
  return [...t.matchAll(/([\d.,]+)\s*Kilometer/g)].map((m) => zahl(m[1]));
}

/** Alle Höhenmeter-Angaben im Text. */
function hmImText(t: string): number[] {
  return [...t.matchAll(/([\d.,]+)\s*Höhenmeter/g)].map((m) => zahl(m[1]));
}

/** Alle Stunden-Angaben im Text, Ziffern und Zahlwörter. Minuten werden mitgezählt. */
function stundenImText(t: string): number[] {
  const out: number[] = [];
  for (const m of t.matchAll(/([\d.,]+)\s*Stunden?/g)) out.push(zahl(m[1]));
  for (const m of t.matchAll(/([A-Za-zÄÖÜäöüß]+)\s+Stunden?/g)) {
    const w = WORT[m[1].toLowerCase()];
    if (w !== undefined) out.push(w);
  }
  if (/halbe\s+Stunde/i.test(t)) out.push(0.5);
  if (/Dreiviertelstunde/i.test(t)) out.push(0.75);
  if (/Viertelstunde/i.test(t)) out.push(0.25);
  // „Eine Stunde zwanzig", „Fünf Stunden dreissig"
  for (const m of t.matchAll(/(\d+|[A-Za-zÄÖÜäöüß]+)\s+Stunden?\s+(\d+)/g)) {
    const h = Number(m[1]) || WORT[m[1].toLowerCase()];
    if (h !== undefined) out.push(h + Number(m[2]) / 60);
  }
  // Auslassung: „Rund eine Stunde …, mit Pause eher anderthalb". Das Wort „Stunden" steht
  // nur beim ersten Mal, die zweite Zahl steht allein da. Ohne diese Zeile meldete die
  // Prüfung die Kaiser-Wilhelm-Promenade als Widerspruch, obwohl Text und Feld
  // übereinstimmen. Nur zulässig, wenn im selben Text ohnehin von Stunden die Rede ist.
  if (/Stunde/.test(t))
    for (const m of t.matchAll(/\b(?:eher|eher so|eher gut|eher knapp)\s+([A-Za-zÄÖÜäöüß]+)/g)) {
      const w = WORT[m[1].toLowerCase()];
      if (w !== undefined) out.push(w);
    }
  return out;
}

// Die Feld-Lesart steht in hours-i18n.ts (`fieldHours`). Die Fassung, die hier stand, las
// „1,5 Std" als 5 Stunden, weil ihr `(\d+)` an der Nachkommastelle ansetzte — die
// Lammerklamm stand deshalb als einziger Widerspruch im Protokoll, und der war keiner.

/** Passt eine der Text-Zahlen zur gemessenen? Toleranz, weil der Text „gut" und „knapp" sagt. */
function trifft(werte: number[], soll: number, relativ: number, absolut: number): boolean {
  return werte.some((w) => Math.abs(w - soll) <= Math.max(absolut, soll * relativ));
}

type Befund = { slug: string; feld: string; was: string };

/**
 * `--dump <lang>` stellt Deutsch und Zielsprache Feld für Feld nebeneinander. Ohne diese
 * Ansicht müsste jeder, der eine Übersetzung nachliest, sich die Gegenüberstellung selbst
 * zusammensuchen, und genau dabei übersieht man den einen Satz, der fehlt.
 */
async function dump(lang: string) {
  const { data: spots } = await db.from("spots").select("id, slug").order("slug");
  // Seitenweise, die Tabelle ist über 1000 Zeilen (siehe select-all.ts).
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    db
      .from("spot_translations")
      .select("spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text")
      .range(from, to),
  );
  const F = [
    ["title", "title"],
    ["shortDesc", "short_desc"],
    ["general", "general"],
    ["insiderTip", "insider_tip"],
    ["sectionA", "section_a"],
    ["sectionB", "section_b"],
    ["locationText", "location_text"],
  ] as const;
  for (const s of spots!) {
    const de = rows!.find((r) => r.spot_id === s.id && r.lang === "de") as Record<string, string> | undefined;
    const tx = rows!.find((r) => r.spot_id === s.id && r.lang === lang) as Record<string, string> | undefined;
    if (!de || !tx) continue;
    console.log(`\n### ${s.slug}`);
    for (const [name, sp] of F) {
      if (!(de[sp] ?? "").trim()) continue;
      console.log(`[${name}]`);
      console.log(`DE: ${de[sp]}`);
      console.log(`${lang.toUpperCase()}: ${tx[sp] ?? ""}`);
    }
  }
}

async function main() {
  const dumpAt = process.argv.indexOf("--dump");
  if (dumpAt >= 0) {
    const lang = process.argv[dumpAt + 1];
    if (!TARGET_LOCALES.includes(lang)) throw new Error(`--dump braucht eine Zielsprache: ${TARGET_LOCALES.join(", ")}`);
    await dump(lang);
    return;
  }

  const { data: spots, error } = await db
    .from("spots")
    .select("id, slug, duration, difficulty, best_season, elevation_profile, route_geojson")
    .order("slug");
  if (error) throw error;
  // Seitenweise, die Tabelle ist über 1000 Zeilen (siehe select-all.ts).
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    db
      .from("spot_translations")
      .select("spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text")
      .range(from, to),
  );

  const FELDER = ["title", "short_desc", "general", "insider_tip", "section_a", "section_b", "location_text"] as const;
  const text = (r: Record<string, unknown>) => FELDER.map((f) => (r[f] as string) ?? "").join("\n");
  /** Die Felder, die die Tour selbst beschreiben — ohne Anreise und ohne Nebenwege. */
  const TOUR_FELDER = ["short_desc", "general", "section_a", "section_b"] as const;

  const widerspruch: Befund[] = [];
  const nachschlagen: Befund[] = [];
  const sprache: Befund[] = [];

  for (const s of spots!) {
    const meine = rows!.filter((r) => r.spot_id === s.id);
    const de = meine.find((r) => r.lang === "de");
    if (!de) continue;
    const deText = text(de as Record<string, unknown>);
    const prof = s.elevation_profile as { ascent?: number; distanceKm?: number } | null;

    // ---- 1. Gemessene Route gegen die Zahlen im Text ----
    if (prof?.distanceKm) {
      const km = kmImText(deText);
      if (km.length && !trifft(km, prof.distanceKm, 0.1, 0.3))
        widerspruch.push({
          slug: s.slug as string,
          feld: "Länge",
          was: `Text: ${km.join(" / ")} km · gemessen: ${Math.round(prof.distanceKm * 10) / 10} km`,
        });
    }
    if (prof?.ascent) {
      const hm = hmImText(deText);
      if (hm.length && !trifft(hm, prof.ascent, 0.1, 30))
        widerspruch.push({
          slug: s.slug as string,
          feld: "Höhenmeter",
          was: `Text: ${hm.join(" / ")} hm · gemessen: ${prof.ascent} hm`,
        });
    }

    // ---- 2. Dauer-Feld gegen die Zahlen im Text, in ALLEN Sprachen ----
    // Nur Deutsch zu prüfen hiess: eine richtige Zahl im Feld und zwölf Sprachen, in denen
    // die alte danebensteht. Der Parser je Sprache liegt in hours-i18n.ts.
    //
    // NUR DIE TOUR-FELDER: `location_text` beschreibt die Anreise („eine Stunde von
    // Salzburg"), `insider_tip` Nebenwege („eine halbe Stunde zur Hütte"). Beides sind
    // richtige Zahlen, die nichts mit der Tourdauer zu tun haben.
    //
    // GEMELDET WIRD, WENN DER TEXT MEHR ZEIT VERSPRICHT ALS DAS FELD und keine der Zahlen
    // zum Feld passt. Diese Richtung ist die, in der Texte veralten: Das Feld rechnet neu,
    // der Satz daneben bleibt stehen. Zahlen UNTER dem Feld bleiben still, weil man sie
    // nicht von Teilzeiten unterscheiden kann — „eine halbe Stunde bis zur Scharte" steht
    // in einem Sieben-Stunden-Text genauso richtig da wie in einem Einstündigen. Wer sie
    // trotzdem meldet, produziert achtzig Fehlalarme, und eine Liste mit achtzig
    // Fehlalarmen liest beim zweiten Mal niemand mehr.
    const soll = fieldHours(s.duration as string | null);
    if (soll !== null && soll >= 1) {
      for (const r of meine) {
        const lang = r.lang as string;
        const t = TOUR_FELDER.map((f) => ((r as Record<string, unknown>)[f] as string) ?? "").join("\n");
        // Deutsch zusätzlich mit den hier gewachsenen Sonderfällen (Auslassung, Viertelstunde).
        const std = [...hoursInText(t, lang), ...(lang === "de" ? stundenImText(t) : [])];
        if (!std.length) continue;
        const passt = trifft(std, soll, 0.2, 0.35);
        const zuViel = std.some((w) => w > soll * 1.2 + 0.35);
        if (!passt && zuViel)
          widerspruch.push({
            slug: s.slug as string,
            feld: `Dauer ${lang}`,
            was: `Text: ${hourMatches(t, lang).join(" | ")} · Feld: ${s.duration}`,
          });
      }
    }

    // ---- 3. Dieselbe Grösse zweimal im Text, mit verschiedenen Zahlen ----
    for (const [name, fn] of [
      ["Höhenmeter", hmImText],
      ["Länge", kmImText],
    ] as const) {
      const werte = [...new Set(fn(deText))];
      if (werte.length > 1) {
        const spanne = Math.max(...werte) / Math.min(...werte);
        // Zwei ähnliche Höhenmeter-Zahlen sind bei Hin-und-retour-Wegen der Normalfall und
        // kein Tippfehler: Der Fliesstext nennt den reinen Anstieg hinauf, die Faktenzeile
        // Auf- plus Abstieg der ganzen Runde. Das ist genau dann belegt, wenn die GRÖSSERE
        // Zahl der gemessenen Summe entspricht. Ohne diese Zeile stünden vier richtige
        // Texte auf der Liste, die ein Mensch nachschlagen soll, und eine Liste mit
        // Fehlalarmen schaut sich beim zweiten Mal niemand mehr an.
        const erklaert =
          name === "Höhenmeter" &&
          !!prof?.ascent &&
          Math.abs(Math.max(...werte) - prof.ascent) <= Math.max(30, prof.ascent * 0.1);
        if (spanne < 1.35 && !erklaert)
          nachschlagen.push({
            slug: s.slug as string,
            feld: name,
            was: `zwei nahe Zahlen im selben Text: ${werte.join(" und ")} (Tippfehler oder Hin/Retour?)`,
          });
      }
    }

    // ---- 4. Sprache: verbotene Wörter, Gedankenstrich, in ALLEN Sprachen ----
    for (const r of meine) {
      const t = text(r as Record<string, unknown>);
      if (r.lang !== "zh" && t.includes("—"))
        sprache.push({ slug: s.slug as string, feld: r.lang as string, was: "Gedankenstrich" });
      for (const w of VERBOTEN[r.lang as string] ?? [])
        if (t.toLowerCase().includes(w.toLowerCase()))
          sprache.push({ slug: s.slug as string, feld: r.lang as string, was: `verbotenes Wort „${w}"` });
      // Doppelte Leerzeichen und Leerzeichen vor Satzzeichen fallen beim Lesen nicht auf.
      if (/ {2,}/.test(t)) sprache.push({ slug: s.slug as string, feld: r.lang as string, was: "doppeltes Leerzeichen" });
      if (r.lang !== "fr" && / [,.;!?]/.test(t))
        sprache.push({ slug: s.slug as string, feld: r.lang as string, was: "Leerzeichen vor Satzzeichen" });
    }

    // ---- 5. Behauptungen, die das System nicht kennt ----
    for (const m of deText.matchAll(/\b(?:seit|ab)\s+(\d{4})\b/g))
      nachschlagen.push({ slug: s.slug as string, feld: "Jahreszahl", was: `„seit ${m[1]}"` });
    for (const m of deText.matchAll(/(\d[\d.,]*)\s*(?:Metern?|m)\s+(?:hoch|über)/g))
      nachschlagen.push({ slug: s.slug as string, feld: "Höhe", was: `${m[1]} m` });
    for (const m of deText.matchAll(/\b(?:höchste[rsn]?|grösste[rsn]?|größte[rsn]?|längste[rsn]?|älteste[rsn]?|einzige[rsn]?)\b[^.]{0,60}/gi))
      nachschlagen.push({ slug: s.slug as string, feld: "Superlativ", was: m[0].trim() });
    for (const m of deText.matchAll(/(\d[\d.,]*)\s*(?:Euro|€)/g))
      nachschlagen.push({ slug: s.slug as string, feld: "Preis", was: `${m[1]} Euro` });
    for (const m of deText.matchAll(/\b(?:Bus(?:linie)?|Linie)\s+(\d+)/g))
      nachschlagen.push({ slug: s.slug as string, feld: "Buslinie", was: m[0] });
  }

  const block = (titel: string, liste: Befund[]) => {
    console.log(`\n── ${titel}: ${liste.length} ──`);
    for (const b of liste) console.log(`  ${b.slug.padEnd(34)} ${b.feld.padEnd(14)} ${b.was}`);
  };

  block("WIDERSPRUCH gegen gemessene Daten", widerspruch);
  block("SPRACHLICHE MÄNGEL", sprache);
  console.log(
    `\n── NACHSCHLAGEN (${nachschlagen.length}) ──\n` +
      "Das System kennt diese Angaben nicht, es kann sie also weder bestätigen noch\n" +
      "widerlegen. Sie stehen hier, damit ein Mensch sie prüft.",
  );
  for (const b of nachschlagen) console.log(`  ${b.slug.padEnd(34)} ${b.feld.padEnd(14)} ${b.was}`);

  console.log(
    `\n${spots!.length} Spots, ${TARGET_LOCALES.length + 1} Sprachen. ` +
      `${widerspruch.length} Widersprüche, ${sprache.length} sprachliche Mängel, ${nachschlagen.length} zum Nachschlagen.`,
  );
}

main();
