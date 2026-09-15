// Prüft den Wächter der Sprechfassung. Aufruf: npm run spoken:check
//
// WARUM: Die Sprechfassung schreibt ein Sprachmodell, und was an ElevenLabs geht, hört
// niemand vorher gegen. Der Wächter (src/lib/spoken-rules.ts) ist die einzige Kontrolle,
// dass dabei nur Zahlen zu Wörtern werden und kein Satz verschwindet. Diese Prüfung hält
// fest, was er durchlässt und was nicht, in mehreren Schriften.
import {
  needsSpokenForm,
  spokenTextAcceptable,
  spokenSourceHash,
  letterSkeleton,
  wordSkeleton,
  isSubsequence,
} from "@/lib/spoken-rules";

let failed = 0;
const ok = (name: string) => console.log(`  ok    ${name}`);
const bad = (name: string, detail: string) => {
  console.log(`  FEHLT ${name}\n        ${detail}`);
  failed++;
};
const accept = (name: string, original: string, spoken: string) => {
  const v = spokenTextAcceptable(original, spoken);
  if (v.ok) ok(name);
  else bad(name, `abgelehnt: ${v.reason}`);
};
const reject = (name: string, original: string, spoken: string, reason: string) => {
  const v = spokenTextAcceptable(original, spoken);
  if (!v.ok && v.reason === reason) ok(name);
  else bad(name, v.ok ? "durchgelassen" : `Grund ${v.reason} statt ${reason}`);
};

console.log("1. Wann eine Sprechfassung noetig ist");
{
  if (needsSpokenForm("Feingold starb 2019, mit 106 Jahren.")) ok("Ziffern -> ja");
  else bad("Ziffern -> ja", "nein");
  if (!needsSpokenForm("Schau dir das Geländer an.")) ok("ohne Ziffern -> nein (kein Aufruf)");
  else bad("ohne Ziffern -> nein", "ja");
  if (needsSpokenForm("이천십구년에 15,000개")) ok("arabische Ziffern in koreanischem Text -> ja");
  else bad("koreanisch mit Ziffern", "nein");
}

console.log("\n2. Der Waechter laesst durch, was nur Zahlen zu Woertern macht");
{
  const de = "Bis Mai 2021 hieß sie Makartsteg. Er wurde im April 1945 befreit. Feingold starb 2019, mit 106 Jahren. Im März 2024 waren es rund 15.000 Stück, am 15. Mai.";
  const deSpoken = "Bis Mai zweitausendeinundzwanzig hieß sie Makartsteg. Er wurde im April neunzehnhundertfünfundvierzig befreit. Feingold starb zweitausendneunzehn, mit hundertsechs Jahren. Im März zweitausendvierundzwanzig waren es rund fünfzehntausend Stück, am fünfzehnten Mai.";
  accept("Deutsch: Jahre, Mengen, Ordnungszahl", de, deSpoken);
  accept("Englisch", "Until May 2021 it was the Makartsteg. He died in 2019, aged 106.", "Until May twenty twenty-one it was the Makartsteg. He died in twenty nineteen, aged one hundred and six.");
  accept("Polnisch mit gebeugter Ordnungszahl", "Zmarł w 2019 roku, w wieku 106 lat.", "Zmarł w dwa tysiące dziewiętnastym roku, w wieku stu sześciu lat.");
  accept("Koreanisch, Jahr ziffernweise", "파인골드는 2019년에 106세로 세상을 떠났습니다.", "파인골드는 이천십구년에 백육 세로 세상을 떠났습니다.");
  accept("Chinesisch", "他于2019年去世，享年106岁。", "他于二零一九年去世，享年一百零六岁。");
  accept("Abkuerzungen ausgeschrieben", "Das kostet z. B. 3 Euro, ca. 2 km weiter, Nr. 5.", "Das kostet zum Beispiel drei Euro, circa zwei Kilometer weiter, Nummer fünf.");
  accept("roemische Zahl im Namen", "Ludwig XIV. ließ 1682 bauen.", "Ludwig der Vierzehnte ließ sechzehnhundertzweiundachtzig bauen.");
  accept("Einheiten und Prozent", "Rund 40 % der 9,05 km sind Radweg, 33 Höhenmeter.", "Rund vierzig Prozent der neun Komma null fünf Kilometer sind Radweg, dreiunddreißig Höhenmeter.");
  accept("Uhrzeit", "Um 10:30 Uhr geht es los.", "Um halb elf Uhr geht es los.");
  accept("Gedankenstrich weg ist erlaubt (Satzzeichen zaehlen nicht)", "Es waren 3 Tage, dann Ruhe.", "Es waren drei Tage, dann Ruhe.");
  accept("kurzes Wort am Satzende bleibt und stimmt", "Es gibt 3 Dinge zu tun.", "Es gibt drei Dinge zu tun.");
  accept("usw. am Satzende ausgeschrieben", "Bänke, Lampen, 3 Brunnen usw.", "Bänke, Lampen, drei Brunnen und so weiter.");
  accept("zwei Woerter reichen fuer den Wort-Modus", "Seit 1945.", "Seit neunzehnhundertfünfundvierzig.");
}

console.log("\n3. Der Waechter lehnt ab, was mehr aendert");
{
  reject("Ziffer uebrig", "Er starb 2019.", "Er starb 2019.", "digits");
  reject("Satz weggelassen", "Er starb 2019. Die Stadt ehrte ihn.", "Er starb zweitausendneunzehn.", "words_changed");
  reject("Wort umformuliert", "Er starb 2019 in Salzburg.", "Er verstarb zweitausendneunzehn in Salzburg.", "words_changed");
  reject("Wort im Inneren erweitert", "Die Stadt hat 3 Brücken.", "Die Altstadt hat drei Brücken.", "words_changed");
  reject("Wort ergaenzt zwischen Woertern ohne Zahl: erlaubt waere es, aber Umformulierung nicht", "Er starb 2019.", "Er ist zweitausendneunzehn gestorben.", "words_changed");
  reject("Chinesisch: Zeichen weggelassen", "他于2019年去世，享年106岁。", "他于二零一九年去世。", "words_changed");
  reject("kurzes Wort am Satzende weggelassen", "Es gibt 3 Dinge zu tun.", "Es gibt drei Dinge.", "words_changed");
  reject("Praeposition vor der Zahl weggelassen", "Wir treffen uns am 15. Mai.", "Wir treffen uns fünfzehnten Mai.", "words_changed");
  reject("Monat nach der Zahl weggelassen", "Wir treffen uns am 15. Mai.", "Wir treffen uns am fünfzehnten.", "words_changed");
  reject("Reihenfolge vertauscht", "Erst 1945, dann Salzburg.", "Dann Salzburg, erst neunzehnhundertfünfundvierzig.", "words_changed");
  reject("Eigenname veraendert", "Marko Feingold starb 2019.", "Marco Feingold starb zweitausendneunzehn.", "words_changed");
  reject("leer", "Er starb 2019.", "   ", "empty");
  reject("aufgeblaeht", "Es waren 3.", "drei ".repeat(40) + "Es waren drei.", "length");
}

console.log("\n4. Bausteine");
{
  if (isSubsequence([..."abc"], [..."xaxbxc"])) ok("Teilfolge: Luecken erlaubt");
  else bad("Teilfolge", "nein");
  if (!isSubsequence([..."abc"], [..."acb"])) ok("Teilfolge: Reihenfolge zaehlt");
  else bad("Teilfolge Reihenfolge", "durchgelassen");
  const skel = letterSkeleton("Am 15. Mai 1945, Nr. 3", true).join("");
  if (skel === "ammainr") ok(`Buchstaben-Skelett ohne Zahl-Token: ${skel}`);
  else bad("Buchstaben-Skelett", skel);
  const words = wordSkeleton("Rund 40 % der 9,05 km, z. B. am 15. Mai (Nr. 3), Ludwig XIV. um 10:30 Uhr.", true).join(" ");
  if (words === "rund der am mai ludwig um") ok(`Wort-Skelett: ${words}`);
  else bad("Wort-Skelett", words);
  const a = spokenSourceHash("Text 1945");
  if (a === spokenSourceHash("  Text 1945 ") && a !== spokenSourceHash("Text 1946")) ok("Marke haengt am Text (getrimmt)");
  else bad("Marke", "instabil");
}

console.log(failed ? `\n${failed} Prüfung(en) FEHLGESCHLAGEN` : "\nAlles in Ordnung.");
process.exit(failed ? 1 : 0);
