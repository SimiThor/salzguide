// Korrigiert Tatsachenbehauptungen im deutschen Text. Aufruf:
//   npm run wp:fix-claims          zeigt, was passieren würde
//   npm run wp:fix-claims -- --go  schreibt
//
// GEFUNDEN BEIM NACHSCHLAGEN, nicht beim Nachrechnen. `wp:audit` kann nur prüfen, was im
// System gemessen ist. Ob ein Bus noch dorthin fährt oder eine Burg im Winter offen hat,
// steht nirgends in der Datenbank; das listet der Lauf nur auf, und nachgeschaut hat es ein
// Mensch. Jede Zeile hier trägt deshalb ihre Quelle.
//
// WARUM NUR DEUTSCH: Der deutsche Text ist die Quelle. Ändert er sich, ändert sich der
// Quell-Hash, und alle acht Übersetzungen gelten als veraltet. Genau so soll es sein: Die
// betroffenen Felder werden danach neu übersetzt und über `wp:apply-review` eingespielt.
// Eine Übersetzung hier mitzuschreiben hiesse, sie an einer zweiten Stelle zu pflegen.
//
// WAS BEWUSST NICHT DRINSTEHT: Die Höhe des Schuhflickersees. Der Text sagt rund 2.100
// Meter, die POI-Datenbank der Region 2.042, andere Quellen 2.050. Eine unbelegte Zahl
// gegen eine andere unbelegte zu tauschen ist keine Korrektur, sondern nur eine andere
// Behauptung. Das klärt eine Karte, nicht dieses Skript.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { hashSpotTexts } from "../../src/lib/spot-hash.ts";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) throw new Error("Supabase-Env fehlt (.env.local)");
const db = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

/** Spalte in spot_translations -> Feldname im Entwurf. */
const ENTWURF: Record<string, string> = {
  short_desc: "shortDesc",
  general: "general",
  insider_tip: "insiderTip",
  section_a: "sectionA",
  section_b: "sectionB",
  location_text: "locationText",
};

type Fix = { slug: string; feld: keyof typeof ENTWURF; neu: string; warum: string };

const FIXES: Fix[] = [
  {
    slug: "burg-hohenwerfen",
    feld: "section_b",
    neu:
      "April bis Anfang November, im Winter hat die Burg zu. In der Hauptsaison läuft das " +
      "volle Programm, die Falknerei fliegt die ganze Saison über.",
    warum:
      "Der Text sagte „Ganzjährig geöffnet“. Die Burg ist im Winter geschlossen, offen ist " +
      "sie etwa 1. April bis 2. November (burg-hohenwerfen.at). Wer im Jänner hinfährt, " +
      "steht vor einem zugesperrten Tor.",
  },
  {
    slug: "hintersee-badeplatz",
    feld: "location_text",
    neu:
      "Bei Faistenau im Salzkammergut, knapp fünfunddreißig Minuten von Salzburg durchs " +
      "Wiestal. Parken kostet am Automaten fünf Euro für den Tag. Mit dem Bus nimmst du die " +
      "155 bis Faistenau und steigst dort in die 157 zum See um, zusammen über eine Stunde.",
    warum:
      "Der Text schickte die Leute mit der 155 an den See. Die fährt nur bis Faistenau, den " +
      "Rest übernimmt die 157 (salzburg-verkehr.at, Regionalbus 155/157). Wer sich darauf " +
      "verlässt, sitzt in Faistenau fest.",
  },
  {
    slug: "schlossalmbahn",
    feld: "location_text",
    neu:
      "Talstation mitten in Bad Hofgastein direkt beim Busterminal. Mit dem Auto über die " +
      "A10 und die B167, an der Bahn gibt es ein Parkdeck. Mit dem Zug bis Bad Hofgastein, " +
      "dann mit dem Ortsbus 558 zum Busterminal.",
    warum:
      "Bus 550 hält nicht am Bahnhofsvorplatz. Die Ortslinie 558 fährt Bahnhof - " +
      "Busterminal/Schlossalmbahn (salzburg-verkehr.at).",
  },
  {
    slug: "fuschlsee-steg",
    feld: "insider_tip",
    neu:
      "Ich fahr früh am Morgen hin, dann steht das Wasser still und der Steg gehört dir " +
      "allein. Nimm was zu essen mit und setz dich ans Ende, das ist der beste " +
      "Frühstücksplatz am See. Fürs Parken am Hofer Badestrand rechne vier Euro für den Tag.",
    warum: "Parken kostet vier Euro, nicht „rund fünf“ (Gemeinde Hof).",
  },
  {
    slug: "fuschlsee-steg",
    feld: "location_text",
    neu:
      "Am westlichen Ende des Fuschlsees bei Hof, rund zwanzig Minuten von Salzburg. Geparkt " +
      "wird am Hofer Badestrand, mit dem Bus 150 bis Hof und von dort gut zwanzig Minuten " +
      "zu Fuß.",
    warum:
      "„Ein paar Minuten zu Fuß“ sind in Wahrheit 2,1 Kilometer vom Ort zum Badestrand " +
      "(Gemeinde Hof). Wer mit dem Bus kommt und das liest, plant falsch.",
  },
  {
    slug: "lamprechtshohle",
    feld: "general",
    neu:
      "Die Lamprechtshöhle bei Weißbach ist 60 Kilometer lang und 1.735 Meter tief, damit " +
      "eine der tiefsten Höhlen der Welt. Begehbar sind davon etwa 700 Meter, über Treppen " +
      "und Stege durch mehrere Tunnel bis zu einer großen Plattform. Drinnen ist es das " +
      "ganze Jahr kühl, an einem heißen Sommertag ist das der halbe Grund. Nach starkem " +
      "Regen bleibt sie wegen Hochwasser zu.",
    warum:
      "„Eines der größten Höhlensysteme Europas“ hält nicht: Nach Länge liegt sie in " +
      "Österreich auf Platz fünf. Die Tiefe trägt den Satz allein und stand ohnehin schon " +
      "da. Beide Zahlen bleiben unverändert.",
  },
  {
    slug: "lamprechtshohle",
    feld: "section_b",
    neu:
      "Ganzjährig, im Hochsommer am angenehmsten, weil es drinnen kühl bleibt. Im Winter " +
      "sind die Öffnungszeiten eingeschränkt, schau vorher auf der Seite der Höhle nach.",
    warum:
      "„Von November bis April ist nur am Wochenende offen“ liess sich nicht belegen: Die " +
      "Betreiberseite schreibt „täglich“, eine zweite Quelle Freitag bis Sonntag. Eine " +
      "unbelegte Angabe durch eine andere zu ersetzen wäre keine Korrektur, also sagt der " +
      "Text jetzt, was sicher stimmt, und schickt zum Nachschauen.",
  },
  {
    slug: "hangar-7",
    feld: "insider_tip",
    neu:
      "Im Sommer ist die Outdoor Lounge vor dem Hangar der eigentliche Grund herzukommen: " +
      "draußen sitzen, die Glasarchitektur im Rücken, die Berge davor. Die besten Plätze " +
      "sind die nah am Glasdach, dort siehst du den Sonnenuntergang. Und die Kunstgalerie " +
      "schauen sich die wenigsten an, dabei kostet sie wie alles andere nichts.",
    warum:
      "„Donnerstag, Freitag und Samstag legen DJs auf“ steht weder beim Betreiber noch bei " +
      "salzburg.info noch beim SalzburgerLand. Nicht belegbar, also raus.",
  },
  {
    slug: "early-winter-mountainkart",
    feld: "section_a",
    neu:
      "Rund eine Stunde von der Talstation bis retour: Gondel rauf, kurze Einweisung, " +
      "Abfahrt zur Mittelstation, Gondel zurück. Können brauchst du keins, Bremsen und " +
      "Lenken erklären sie dir oben. Mindestalter sind 14 Jahre.",
    warum:
      "Der Betreiber schreibt: „Das Mindestalter für die Teilnahme beträgt 14 Jahre“ " +
      "(gastein.com). „Können brauchst du keins“ las sich ohne diesen Satz wie eine " +
      "Einladung für die ganze Familie.",
  },
  {
    slug: "gamskarkogel",
    feld: "short_desc",
    neu: "Gilt als höchster Grasberg Europas, über Bad Gastein",
    warum:
      "Geisstein und Hundstein werben mit demselben Titel, und „Grasberg“ ist nicht " +
      "definiert. Als nackte Tatsache nicht haltbar, als verbreitete Zuschreibung schon. " +
      "Der Ortsbezug bleibt: In der ersten Fassung dieser Zeile fiel er weg, und drei " +
      "Sprachen meldeten unabhängig voneinander, dass ihre Fassung ihn noch trägt.",
  },
  {
    slug: "gamskarkogel",
    feld: "general",
    neu:
      "Der Gamskarkogel gilt mit 2.467 Metern als höchster Grasberg Europas, und genau so " +
      "geht er sich auch: kein Fels, kein Klettern, dafür knapp 1.600 Höhenmeter am Stück. " +
      "Los geht es beim Hoteldorf Grüner Baum in Bad Gastein, über die Poserhöhe hinauf. Am " +
      "Gipfel steht die Gamskarkogelhütte, und von dort schaust du einmal rundum über das " +
      "Gasteinertal und die Tauern. Hin und zurück sind das dreizehneinhalb Stunden, also " +
      "ein sehr langer Bergtag.",
    warum: "Dieselbe Zuschreibung wie im Kurztext, aus derselben Begründung entschärft.",
  },
];

/** Felder in der spots-Tabelle, die demselben Fehler aufsitzen. */
const FELD_FIXES: { slug: string; spalte: string; neu: string; warum: string }[] = [
  {
    slug: "burg-hohenwerfen",
    spalte: "best_season",
    neu: "Frühling bis Herbst",
    warum: "stand auf „Ganzjährig“, passend zum falschen Satz im Text",
  },
];

const SPALTEN = ["title", "short_desc", "general", "insider_tip", "section_a", "section_b", "location_text"] as const;

async function main() {
  const go = process.argv.includes("--go");
  const { data: spots, error } = await db.from("spots").select("id, slug");
  if (error) throw error;

  const betroffen = new Set<string>();
  for (const fix of FIXES) {
    const spot = spots!.find((s) => s.slug === fix.slug);
    if (!spot) throw new Error(`Spot ${fix.slug} gibt es nicht`);
    const { data: de, error: e2 } = await db
      .from("spot_translations")
      .select(SPALTEN.join(", "))
      .eq("spot_id", spot.id)
      .eq("lang", "de")
      .single();
    if (e2) throw e2;
    const alt = (de as unknown as Record<string, string | null>)[fix.feld] ?? "";
    if (alt === fix.neu) {
      console.log(`  schon gesetzt  ${fix.slug} / ${fix.feld}`);
      continue;
    }
    console.log(`\n=== ${fix.slug} / ${fix.feld}`);
    console.log(`    ALT: ${alt}`);
    console.log(`    NEU: ${fix.neu}`);
    console.log(`    ${fix.warum}`);
    betroffen.add(fix.slug);
    if (!go) continue;

    const { error: e3 } = await db
      .from("spot_translations")
      .update({ [fix.feld]: fix.neu })
      .eq("spot_id", spot.id)
      .eq("lang", "de");
    if (e3) throw e3;

    // Entwurf mitziehen, sonst holt der nächste Import den alten Satz zurück.
    const pfad = join(".wp-cache", "drafts", `${fix.slug}.json`);
    if (existsSync(pfad)) {
      const entwurf = JSON.parse(readFileSync(pfad, "utf8")) as Record<string, string>;
      entwurf[ENTWURF[fix.feld]] = fix.neu;
      writeFileSync(pfad, JSON.stringify(entwurf, null, 1) + "\n");
    }
  }

  for (const f of FELD_FIXES) {
    const spot = spots!.find((s) => s.slug === f.slug)!;
    console.log(`\n=== ${f.slug} / Feld ${f.spalte} -> ${f.neu}`);
    console.log(`    ${f.warum}`);
    if (!go) continue;
    const { error: e4 } = await db.from("spots").update({ [f.spalte]: f.neu }).eq("id", spot.id);
    if (e4) throw e4;
  }

  if (!go) {
    console.log(`\n${FIXES.length} Textstellen, ${FELD_FIXES.length} Feld.`);
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich setzen: npm run wp:fix-claims -- --go");
    return;
  }

  // Neuer Quell-Hash: Die acht Übersetzungen gelten damit als veraltet, und genau das ist
  // gewollt. Sie tragen den alten Satz noch und müssen nachgezogen werden.
  for (const slug of betroffen) {
    const spot = spots!.find((s) => s.slug === slug)!;
    const { data: de } = await db
      .from("spot_translations")
      .select(SPALTEN.join(", "))
      .eq("spot_id", spot.id)
      .eq("lang", "de")
      .single();
    const d = de as unknown as Record<string, string | null>;
    const hash = hashSpotTexts({
      title: d.title ?? "",
      shortDesc: d.short_desc ?? "",
      general: d.general ?? "",
      insiderTip: d.insider_tip ?? "",
      sectionA: d.section_a ?? "",
      sectionB: d.section_b ?? "",
      locationText: d.location_text ?? "",
    });
    const { error: e5 } = await db
      .from("spot_translations")
      .update({ source_hash: hash })
      .eq("spot_id", spot.id)
      .eq("lang", "de");
    if (e5) throw e5;
  }

  console.log(`\n${betroffen.size} Spots geändert. Die acht Übersetzungen stehen jetzt auf „veraltet“.`);
  console.log("Nächster Schritt: die betroffenen Felder neu übersetzen und über wp:apply-review einspielen.");
}

main();
