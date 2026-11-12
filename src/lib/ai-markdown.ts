// Toni darf nur **fett** und Links schreiben, mehr lesen weder AiMessage.tsx (Web) noch
// ToniMarkup (iOS-App). Alles andere landet dort als rohe Zeichen im Chat, am auffälligsten
// Trennlinien ("---") zwischen zwei Absätzen und Überschriften ("### Morgen").
//
// Der Prompt bittet darum, das zu lassen. Diese Funktion macht daraus einen Zwang, an der einen
// Stelle, an der die Antwort den Server verlässt. So gilt es für Web und App zugleich, auch für
// App-Versionen, die schon auf den Geräten sind.

// Eine Zeile nur aus drei oder mehr gleichen Zeichen - * _ (Leerzeichen dazwischen erlaubt)
// ist in Markdown eine Trennlinie. "- Punkt" (Liste) und "--" bleiben stehen.
const RULE_LINE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

// "# Titel" bis "###### Titel", optional mit schließenden Rauten.
const HEADING_LINE = /^[ \t]{0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;

export function stripMarkdownExtras(text: string): string {
  if (!text) return text;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (RULE_LINE.test(line)) {
      out.push("");
      continue;
    }
    const heading = HEADING_LINE.exec(line);
    if (heading) {
      // Fett innen entfernen, sonst entstünde "****Titel****".
      const title = (heading[1] ?? "").replace(/\*\*/g, "").trim();
      out.push(title ? `**${title}**` : "");
      continue;
    }
    out.push(line);
  }
  // Wo eine Trennlinie zwischen zwei Leerzeilen stand, bleiben sonst drei Umbrüche.
  return out
    .join("\n")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
