// Prüft die Säuberung von Tonis Antworttext (src/lib/ai-markdown.ts). Aufruf: npm run ai-markdown:check
// Läuft ohne Server und ohne KI-Aufruf.
import { stripMarkdownExtras } from "@/lib/ai-markdown";

let failed = 0;
const same = (name: string, input: string, want: string) => {
  const got = stripMarkdownExtras(input);
  if (got === want) console.log(`  ok    ${name}`);
  else {
    console.log(`  FEHLT ${name}\n        erwartet ${JSON.stringify(want)}\n        bekommen ${JSON.stringify(got)}`);
    failed++;
  }
};

console.log("1. Trennlinien");
same("--- zwischen Absätzen", "Erster Absatz.\n\n---\n\nZweiter Absatz.", "Erster Absatz.\n\nZweiter Absatz.");
same("*** und ___", "A\n***\nB\n___\nC", "A\n\nB\n\nC");
same("mit Leerzeichen - - -", "A\n\n- - -\n\nB", "A\n\nB");
same("am Anfang und Ende", "---\nA\n---", "A");
same("Listenpunkt bleibt", "- Gaisberg\n- Kapuzinerberg", "- Gaisberg\n- Kapuzinerberg");
same("zwei Striche bleiben", "A\n--\nB", "A\n--\nB");
same("Strich im Satz bleibt", "Der Weg --- kurz und steil.", "Der Weg --- kurz und steil.");

console.log("2. Überschriften");
same("### wird fett", "### Morgen\nDas Kino.", "**Morgen**\nDas Kino.");
same("# mit schließenden Rauten", "## Abends ##", "**Abends**");
same("schon fett", "### **Event morgen:**", "**Event morgen:**");
same("Link bleibt Link", "## [Gaisberg](/spot/gaisberg)", "**[Gaisberg](/spot/gaisberg)**");
same("Raute ohne Leerzeichen bleibt", "#salzburg ist schön", "#salzburg ist schön");
same("leere Überschrift fällt weg", "A\n\n###\n\nB", "A\n\nB");

console.log("3. Rest bleibt unangetastet");
same("normaler Text", "Kurz und gut.\n\n**Fett** und [Hangar 7](/spot/hangar-7).", "Kurz und gut.\n\n**Fett** und [Hangar 7](/spot/hangar-7).");
same("leer", "", "");
same("Toni-Beispiel aus dem Screenshot",
  "Cool to look at.\n\n---\n\n**Event tomorrow (Friday 13/11):**\n\nThe festival runs all week.\n\n---\n\nHow old are the kids?",
  "Cool to look at.\n\n**Event tomorrow (Friday 13/11):**\n\nThe festival runs all week.\n\nHow old are the kids?");

console.log(failed ? `\n${failed} fehlgeschlagen` : "\nalles ok");
process.exit(failed ? 1 : 0);
