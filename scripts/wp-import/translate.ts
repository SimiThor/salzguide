// Übersetzungen der 95 Spot-Texte in die zwölf Zielsprachen: ausgeben, prüfen, einspielen.
//
//   npm run wp:translate                  Stand: welche Spots fehlen noch
//   npm run wp:translate -- --todo 3      die nächsten 3 offenen Spots mit deutschem Text
//   npm run wp:translate -- --check       alle abgelegten Dateien prüfen, nichts schreiben
//   npm run wp:translate -- --go          geprüfte Dateien in die Datenbank schreiben
//
// WARUM KEIN API-AUFRUF: Der Admin-Knopf „In alle Sprachen übersetzen" schickt jeden Spot
// einzeln an die Anthropic-API und kostet je Aufruf. 95 Spots mal zwölf Sprachen wären 1.140
// bezahlte Aufrufe. Hier übersetzt stattdessen die KI in der Sitzung (Abo) und legt das
// Ergebnis als Datei ab; dieses Skript ist nur Prüfung und Schreiber. Der Prompt-Kern in
// admin-actions.ts bleibt unangetastet — er ist weiter der Weg für einzelne, spätere Spots.
//
// ABLAGE: .wp-cache/i18n/<slug>.json, je Datei ein Objekt mit den zwölf Sprachcodes und
// darunter denselben sieben Feldern wie in .wp-cache/drafts/. .wp-cache/ ist ausgenommen
// (das Repo ist öffentlich), die Texte gehören nur in die Datenbank.
//
// GEPRÜFT WIRD MASCHINELL, nicht durch Lesen: Zahlen, Gedankenstrich, Feld-Parität,
// Vollständigkeit. Eine Übersetzung, in der aus 1.042 Metern 1.024 werden, sieht beim
// Überfliegen richtig aus — genau deshalb liest das hier eine Maschine nach.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { stripEmDashFields } from "../../src/lib/em-dash.ts";
import { hashSpotTexts, type SpotTextFields } from "../../src/lib/spot-hash.ts";
import { TARGET_LOCALES, localeMeta } from "../../src/i18n/locales.ts";
import { selectAll } from "./select-all.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const DIR = join(".wp-cache", "i18n");

/** Feldnamen wie in den Entwürfen (camelCase) -> Spalten in spot_translations. */
const FIELDS = {
  title: "title",
  shortDesc: "short_desc",
  general: "general",
  insiderTip: "insider_tip",
  sectionA: "section_a",
  sectionB: "section_b",
  locationText: "location_text",
} as const;
type Field = keyof typeof FIELDS;
const FIELD_LIST = Object.keys(FIELDS) as Field[];

type Texts = Record<Field, string>;
type Datei = Record<string, Partial<Texts>>;

function leer(): Texts {
  return Object.fromEntries(FIELD_LIST.map((f) => [f, ""])) as Texts;
}

/**
 * Zahlen aus einem Text, unabhängig von der Schreibweise der Sprache: „1.042" (deutsch),
 * „1,042" (englisch) und „1 042" (französisch) werden alle zu 1042. Verglichen wird also
 * die Ziffernfolge, nicht die Zeichenkette — sonst meldete jede korrekte Übersetzung
 * einen Fehler, nur weil sie den Tausenderpunkt anders setzt.
 */
function zahlen(text: string, roemisch = false): string[] {
  const eng = text.replace(/(\d)[.,  ' ](?=\d)/g, "$1");
  const out: string[] = eng.match(/\d+/g) ?? [];
  // Die romanischen Sprachen schreiben Jahrhunderte römisch: aus „11. Jahrhundert" wird
  // „XI secolo", „XIe siècle", „siglo XI". Ohne diese Umrechnung meldete die Prüfung dort
  // eine richtige Übersetzung als falsch, und eine Prüfung, die man wegklicken muss, prüft
  // nicht mehr lange. Gilt nur für die Übersetzungsseite: Zusätzliche Zahlen sind ohnehin
  // erlaubt, es kann also nichts durchrutschen, was vorher aufgefallen wäre.
  if (roemisch) {
    const W: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    // „XIe siècle": Französisch hängt die Ordnungsendung direkt an, sonst endet das
    // Zahlzeichen nicht an einer Wortgrenze und wird nicht gefunden.
    const ohneEndung = eng.replace(/\b([IVXLCDM]+)(?:ème|er|e)\b/g, "$1 ");
    for (const t of ohneEndung.match(/\b[IVXLCDM]+\b/g) ?? []) {
      let n = 0;
      for (let i = 0; i < t.length; i++) n += W[t[i]] < (W[t[i + 1]] ?? 0) ? -W[t[i]] : W[t[i]];
      if (n > 0) out.push(String(n));
    }
  }
  return out.sort();
}

/** Ein Gedankenstrich verrät KI-Text. Chinesisch ist ausgenommen, dort ist „——" normal. */
function emDash(text: string): boolean {
  return text.includes("—");
}

type Problem = { slug: string; lang: string; was: string };

function pruefe(slug: string, de: Texts, tx: Texts, lang: string): Problem[] {
  const out: Problem[] = [];
  const add = (was: string) => out.push({ slug, lang, was });

  for (const f of FIELD_LIST) {
    const d = de[f].trim();
    const t = (tx[f] ?? "").trim();
    // Feld-Parität: Wo Deutsch etwas sagt, muss die Übersetzung etwas sagen — und wo
    // Deutsch schweigt, darf nichts dazuerfunden werden.
    if (d && !t) add(`Feld ${f} ist leer, Deutsch aber nicht`);
    if (!d && t) add(`Feld ${f} hat Text, Deutsch ist leer`);
    if (!d || !t) continue;

    if (lang !== "zh" && emDash(t)) add(`Feld ${f}: Gedankenstrich`);

    // Jede deutsche Zahl muss vorkommen. Zusätzliche Zahlen in der Übersetzung sind
    // erlaubt (etwa eine Umrechnung), fehlende nicht.
    const dz = zahlen(d);
    const tz = zahlen(t, true);
    const fehlt = dz.filter((z) => {
      const i = tz.indexOf(z);
      if (i < 0) return true;
      tz.splice(i, 1);
      return false;
    });
    if (fehlt.length) add(`Feld ${f}: Zahl${fehlt.length > 1 ? "en" : ""} ${fehlt.join(", ")} fehlt`);
  }

  // Längen-Verhältnis nur als Hinweis: Koreanisch und Chinesisch brauchen deutlich weniger
  // Zeichen als Deutsch, Portugiesisch etwas mehr. Ein Ausreisser heisst meist, dass ein
  // Absatz verlorenging oder einer dazukam.
  const dl = FIELD_LIST.reduce((n, f) => n + de[f].length, 0);
  const tl = FIELD_LIST.reduce((n, f) => n + (tx[f] ?? "").length, 0);
  // Die Grenzen sind an den ersten 19 fertigen Spots GEMESSEN, nicht geschätzt: Chinesisch
  // liegt bei 29 bis 42 Prozent der deutschen Zeichenzahl, Koreanisch bei 46 bis 58, die
  // lateinischen Sprachen bei 91 bis 113. Eine gemeinsame Schwelle für Chinesisch und
  // Koreanisch war zu eng und meldete einen vollständigen chinesischen Text als zu kurz.
  const [unten, oben] =
    lang === "zh" ? [0.22, 0.55] : lang === "ko" ? [0.38, 0.75] : [0.75, 1.35];
  if (dl && (tl / dl < unten || tl / dl > oben))
    add(`Länge auffällig: ${Math.round((tl / dl) * 100)} % vom Deutschen`);

  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const go = argv.includes("--go");
  const check = argv.includes("--check") || go;
  const todoAt = argv.indexOf("--todo");
  const todo = todoAt >= 0 ? Math.max(1, Number(argv[todoAt + 1] ?? 3) || 3) : 0;
  // --only grenzt ALLES auf diese Spots ein (ausgeben, prüfen, schreiben). Damit kann die
  // Arbeit auf mehrere parallel laufende Claude-Instanzen aufgeteilt werden, ohne dass eine
  // die halbfertigen Dateien der anderen als Fehler meldet.
  const onlyAt = argv.indexOf("--only");
  const only =
    onlyAt >= 0
      ? new Set(
          (argv[onlyAt + 1] ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : null;
  if (only && !only.size) throw new Error("--only ohne Spots");

  mkdirSync(DIR, { recursive: true });

  const { data: spots, error: spotErr } = await db.from("spots").select("id, slug").order("slug");
  if (spotErr) throw spotErr;
  // Seitenweise: die Tabelle ist über 1000 Zeilen (siehe select-all.ts). Ohne das fehlten
  // vier der 95 deutschen Zeilen, und dieses Skript meldete für sie „kein deutscher Text
  // in der Datenbank" und übersprang sie stillschweigend.
  const rows = await selectAll<Record<string, unknown>>((from, to) =>
    db
      .from("spot_translations")
      .select("spot_id, lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, source_hash")
      .range(from, to),
  );

  const deBySpot = new Map<string, Texts>();
  for (const r of rows) {
    if (r.lang !== "de") continue;
    const t = leer();
    for (const f of FIELD_LIST) t[f] = ((r as Record<string, string | null>)[FIELDS[f]] ?? "") as string;
    deBySpot.set(r.spot_id as string, t);
  }

  const offen: { slug: string; id: string; de: Texts }[] = [];
  const fertig: string[] = [];
  const probleme: Problem[] = [];
  const zuSchreiben: { id: string; slug: string; de: Texts; datei: Datei }[] = [];

  const gefragt = only ? spots!.filter((s) => only.has(s.slug as string)) : spots!;
  if (only) {
    const unbekannt = [...only].filter((x) => !spots!.some((s) => s.slug === x));
    if (unbekannt.length) throw new Error(`Spot gibt es nicht: ${unbekannt.join(", ")}`);
  }

  for (const s of gefragt) {
    const de = deBySpot.get(s.id as string);
    if (!de || !de.title.trim()) {
      probleme.push({ slug: s.slug as string, lang: "de", was: "kein deutscher Text in der Datenbank" });
      continue;
    }
    const pfad = join(DIR, `${s.slug}.json`);
    if (!existsSync(pfad)) {
      offen.push({ slug: s.slug as string, id: s.id as string, de });
      continue;
    }
    const datei = JSON.parse(readFileSync(pfad, "utf8")) as Datei;
    const fehlend = TARGET_LOCALES.filter((l) => !(datei[l]?.title ?? "").trim());
    if (fehlend.length) {
      probleme.push({ slug: s.slug as string, lang: fehlend.join(","), was: "Sprache fehlt in der Datei" });
      continue;
    }
    const fremd = Object.keys(datei).filter((l) => !TARGET_LOCALES.includes(l));
    if (fremd.length)
      probleme.push({ slug: s.slug as string, lang: fremd.join(","), was: "unbekannter Sprachcode" });

    if (check) {
      for (const l of TARGET_LOCALES) {
        const tx = { ...leer(), ...datei[l] } as Texts;
        probleme.push(...pruefe(s.slug as string, de, tx, l));
      }
    }
    fertig.push(s.slug as string);
    zuSchreiben.push({ id: s.id as string, slug: s.slug as string, de, datei });
  }

  // Dateien ohne zugehörigen Spot fallen sonst nie auf: Sie werden nie geschrieben und
  // sehen im Ordner trotzdem nach getaner Arbeit aus.
  const bekannt = new Set(spots!.map((s) => s.slug as string));
  if (!only) {
    for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
      const slug = f.replace(/\.json$/, "");
      if (!bekannt.has(slug)) probleme.push({ slug, lang: "-", was: "Datei ohne passenden Spot" });
    }
  }

  console.log(`\n${fertig.length} von ${gefragt.length} Spots übersetzt, ${offen.length} offen.`);

  if (todo) {
    console.log(`\n── Nächste ${Math.min(todo, offen.length)} ──`);
    for (const o of offen.slice(0, todo)) {
      console.log(`\n### ${o.slug}`);
      console.log(JSON.stringify(o.de, null, 1));
    }
    if (!offen.length) console.log("(nichts mehr offen)");
    return;
  }

  if (probleme.length) {
    console.log(`\n── ${probleme.length} Beanstandungen ──`);
    for (const p of probleme) console.log(`  ${p.slug.padEnd(34)} ${p.lang.padEnd(6)} ${p.was}`);
  } else if (check) {
    console.log("Prüfung sauber: Zahlen, Gedankenstrich, Feld-Parität, Länge.");
  }

  if (!go) {
    if (!check) console.log("Zum Prüfen: npm run wp:translate -- --check");
    else console.log("\nTROCKENLAUF. Nichts geschrieben. Wirklich schreiben: npm run wp:translate -- --go");
    if (offen.length && !check) console.log("Nächste Portion: npm run wp:translate -- --todo 3");
    return;
  }

  // Geschrieben wird nur, wenn ALLES sauber ist. Eine halb eingespielte Sprache wäre
  // schlimmer als gar keine: Der Spot gilt dann als übersetzt, und niemand schaut nochmal
  // hin (siehe translationsPublishable in spot-hash.ts).
  if (probleme.length) {
    console.log("\nNichts geschrieben, solange oben etwas steht.");
    process.exitCode = 1;
    return;
  }

  let geschrieben = 0;
  for (const { id, slug, de, datei } of zuSchreiben) {
    const deHash = hashSpotTexts(de as SpotTextFields);
    for (const lang of TARGET_LOCALES) {
      const roh = { ...leer(), ...datei[lang] } as Texts;
      // stripEmDashFields ist Pflicht vor dem Speichern (Projektregel), nicht nur Prüfung:
      // Ein Prompt ist eine Bitte, diese Funktion ist der Riegel. Chinesisch behält „——".
      const t = stripEmDashFields(roh, lang) as Texts;
      const { error } = await db.from("spot_translations").upsert(
        {
          spot_id: id,
          lang,
          title: t.title.trim() || de.title,
          short_desc: t.shortDesc.trim() || null,
          general: t.general.trim() || null,
          insider_tip: t.insiderTip.trim() || null,
          section_a: t.sectionA.trim() || null,
          section_b: t.sectionB.trim() || null,
          location_text: t.locationText.trim() || null,
          source_hash: deHash,
        },
        { onConflict: "spot_id,lang" },
      );
      if (error) throw new Error(`${slug}/${lang}: ${error.message}`);
    }
    // Die DE-Zeile trägt die Versionsmarke, gegen die alle Sprachen verglichen werden.
    const { error } = await db
      .from("spot_translations")
      .update({ source_hash: deHash })
      .eq("spot_id", id)
      .eq("lang", "de");
    if (error) throw new Error(`${slug}/de: ${error.message}`);
    geschrieben++;
    console.log(`  ok   ${slug.padEnd(34)} ${TARGET_LOCALES.length} Sprachen`);
  }

  console.log(
    `\n${geschrieben} Spots geschrieben (${TARGET_LOCALES.map((l) => localeMeta(l).code).join(", ")}).`,
  );
  console.log("Der Katalog-Cache hängt daran: npm run dev neu starten oder im Admin einmal speichern.");
}

main();
