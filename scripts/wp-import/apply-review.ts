// Spielt die Korrekturen der Muttersprachler-Durchgänge in die Übersetzungs-Ablage ein.
//   npm run wp:apply-review          zeigt, was passieren würde
//   npm run wp:apply-review -- --go  schreibt die Dateien
//
// Danach zwingend: `npm run wp:translate -- --check`, dann `-- --go`. Diese Datei schreibt
// NICHT in die Datenbank. Der Weg bleibt derselbe wie beim Übersetzen: Datei, Prüfung,
// dann erst schreiben.
//
// WARUM JE SPRACHE EINE EIGENE PATCH-DATEI: Acht Durchgänge liefen gleichzeitig über
// dieselben 95 Dateien. Hätte jeder direkt in `.wp-cache/i18n/<slug>.json` geschrieben,
// hätte der letzte die Änderungen der anderen sieben überschrieben, ohne dass es jemandem
// aufgefallen wäre. Jeder schreibt deshalb nur `<lang>.json` mit seinen eigenen Feldern,
// und zusammengeführt wird hier, an einer Stelle.
//
// REIHENFOLGE, DIE MAN NICHT VERTAUSCHEN DARF: Die Durchgänge haben den Bestand gelesen,
// BEVOR `wp:fix-numbers` die Höhen am Stubnerkogel und am Zwölferhorn korrigiert hat. Ihre
// Patches tragen also noch die alten Zahlen. Erst diese Datei einspielen, dann
// `wp:fix-numbers` laufen lassen. Umgekehrt holt der Patch die falsche Zahl zurück.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TARGET_LOCALES } from "../../src/i18n/locales.ts";

const DIR = join(".wp-cache", "i18n");
const REVIEW = join(".wp-cache", "review");

const FELDER = [
  "title",
  "shortDesc",
  "general",
  "insiderTip",
  "sectionA",
  "sectionB",
  "locationText",
] as const;
type Feld = (typeof FELDER)[number];

type Patch = Record<string, Partial<Record<Feld, string>>>;

function main() {
  const go = process.argv.includes("--go");
  let felder = 0;
  let spots = 0;
  let schonDa = 0;
  const probleme: string[] = [];
  // Erst alles einsammeln, dann schreiben: Sonst bliebe bei einem Fehler auf halbem Weg
  // ein Teil der Sprachen eingespielt und der Rest nicht.
  const geplant = new Map<string, Record<string, Partial<Record<Feld, string>>>>();

  for (const lang of TARGET_LOCALES) {
    const pfad = join(REVIEW, `${lang}.json`);
    if (!existsSync(pfad)) {
      console.log(`  ${lang}: keine Datei, übersprungen`);
      continue;
    }
    const patch = JSON.parse(readFileSync(pfad, "utf8")) as Patch;
    let n = 0;
    for (const [slug, felderNeu] of Object.entries(patch)) {
      const ziel = join(DIR, `${slug}.json`);
      if (!existsSync(ziel)) {
        probleme.push(`${lang}/${slug}: Spot-Datei gibt es nicht`);
        continue;
      }
      const datei = JSON.parse(readFileSync(ziel, "utf8")) as Record<string, Record<string, string>>;
      for (const [feld, wert] of Object.entries(felderNeu)) {
        if (!(FELDER as readonly string[]).includes(feld)) {
          probleme.push(`${lang}/${slug}: Feld „${feld}" gibt es nicht`);
          continue;
        }
        const alt = datei[lang]?.[feld] ?? "";
        if (!wert.trim()) {
          probleme.push(`${lang}/${slug}/${feld}: leerer Ersatz`);
          continue;
        }
        // Schon eingespielt: überspringen, nicht beanstanden. Der Lauf muss wiederholbar
        // sein, weil die acht Durchgänge nacheinander fertig werden und die späteren sonst
        // nur einspielbar wären, indem man die früheren rückgängig macht.
        if (wert === alt) {
          schonDa++;
          continue;
        }
        // Ein Patch, der nur einen Ausschnitt statt des ganzen Feldes enthält, würde den
        // Rest des Satzes stillschweigend löschen. Die Längenprobe fängt das ab.
        if (alt && (wert.length < alt.length * 0.5 || wert.length > alt.length * 2))
          probleme.push(
            `${lang}/${slug}/${feld}: Länge springt von ${alt.length} auf ${wert.length} Zeichen (Ausschnitt statt ganzem Feld?)`,
          );
        const eintrag = geplant.get(slug) ?? {};
        eintrag[lang] = { ...(eintrag[lang] ?? {}), [feld]: wert };
        geplant.set(slug, eintrag);
        n++;
      }
    }
    console.log(`  ${lang}: ${n} Felder`);
    felder += n;
  }

  if (probleme.length) {
    console.log(`\n── ${probleme.length} Beanstandungen ──`);
    for (const p of probleme) console.log(`  ${p}`);
    console.log("\nNichts geschrieben, solange oben etwas steht.");
    process.exitCode = 1;
    return;
  }

  if (go) {
    for (const [slug, proSprache] of geplant) {
      const ziel = join(DIR, `${slug}.json`);
      const datei = JSON.parse(readFileSync(ziel, "utf8")) as Record<string, Record<string, string>>;
      for (const [lang, felderNeu] of Object.entries(proSprache))
        datei[lang] = { ...datei[lang], ...felderNeu };
      writeFileSync(ziel, JSON.stringify(datei, null, 1) + "\n");
      spots++;
    }
  } else {
    spots = geplant.size;
  }

  console.log(
    `\n${felder} Felder in ${spots} Spots${go ? " eingespielt" : " betroffen"}` +
      (schonDa ? `, ${schonDa} sassen schon.` : "."),
  );
  if (!go) {
    console.log("TROCKENLAUF. Nichts geschrieben. Wirklich einspielen: npm run wp:apply-review -- --go");
    return;
  }
  console.log("Jetzt prüfen: npm run wp:translate -- --check");
  console.log("Dann schreiben: npm run wp:translate -- --go");
  console.log("UND ERST DANACH: npm run wp:fix-numbers -- --go  (sonst holt der Patch die alten Höhen zurück)");
}

main();
