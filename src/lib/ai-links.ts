// Der Riegel für Links in Toni-Antworten: Was der Server nicht selbst verantwortet,
// wird zu Klartext.
//
// WARUM ES DIESE DATEI GIBT, OBWOHL DIE REGEL SCHON IM PROMPT STEHT:
// Genau derselbe Gedanke wie bei em-dash.ts. Der Systemprompt in ai-assistant.ts verbietet
// externe Links mehrfach und sehr deutlich („Verweise NIEMALS auf externe Wetterseiten",
// „Gib die Google-Maps-URL NIEMALS selbst als Text-Link aus"). Ein Prompt ist aber eine
// Bitte. Erst diese Funktion macht daraus einen Zwang.
//
// WAS PASSIEREN KANN, WENN SIE FEHLT (gefunden am 11.08.2026):
// `extractCards()` prüfte nur Spot- und Event-Links. Ein `[Hier klicken](https://fremd.tld)`
// lief ungeprüft durch und wurde in AiMessage.tsx als fetter, rot unterstrichener Link in
// einer SalzGuide-Antwortblase gerendert — er sah aus, als käme er von uns. Das Modell hat
// echte fremde URLs im Kontext (Spot-Websites, Event-Quellen) und könnte eine davon
// durchreichen; Event-Beschreibungen stammen aus der Recherche über fremde Quellen, also
// ist auch eingeschleuster Text denkbar. Kein XSS (der Parser baut React-Knoten, nie HTML),
// aber Phishing im Namen der Marke, und dagegen hilft keine Content-Security-Policy.
//
// WARUM EINE ERLAUBNIS-LISTE UND KEINE VERBOTSLISTE:
// Dieselbe Begründung wie bei der Karten-Beschriftung: Eine Verbotsliste muss jede neue
// fremde Adresse kennen, eine Erlaubnis-Liste kennt nur unsere drei eigenen Ziele und
// fällt bei allem Unbekannten auf die sichere Seite.

/** Ein Markdown-Link, so wie ihn AiMessage.tsx später auch liest. */
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Die einzigen Ziele, die Toni verlinken darf.
 *
 * `/events?e=<id>` steht bewusst NICHT hier: Bekannte Event-Links entfernt `extractCards()`
 * vorher samt Zeile (das Event erscheint als Karte), unbekannte macht es zu Klartext. Was
 * an dieser Stelle noch übrig wäre, ist ein Rest und gehört entschärft.
 */
const VOUCHED_TARGETS = [/^\/spot\/[a-z0-9-]+$/, /^\/wasser$/];

/**
 * Darf dieses Ziel ein klickbarer Link bleiben?
 *
 * Bewusst OHNE `trim()`: AiMessage.tsx prüft denselben rohen Wert aus derselben Klammer
 * noch einmal. Würde hier getrimmt und dort nicht, hielte der Server `[x]( /spot/y )` für
 * in Ordnung und der Renderer machte trotzdem Klartext daraus. Das Ergebnis wäre zwar
 * sicher, aber die beiden Riegel wären sich uneinig — und uneinige Prüfungen sind der
 * Anfang davon, dass eine von beiden „repariert" wird. Gleiches Muster wie bei em-dash.ts
 * und scripts/i18n-check.mjs: dieselbe Regel, wortgleich, an beiden Enden.
 */
export function isVouchedLinkTarget(target: string): boolean {
  return VOUCHED_TARGETS.some((re) => re.test(target));
}

/**
 * Alle nicht verantworteten Links zu Klartext machen. Die Beschriftung bleibt stehen,
 * nur die Klickbarkeit fällt weg — genauso, wie `extractCards()` es mit einem unbekannten
 * Spot schon immer gemacht hat.
 *
 * Läuft als LETZTER Schritt, nachdem Spots und Events geprüft sind: Vorher wäre nicht
 * entscheidbar, ob ein `/spot/…`-Link zu einem echten Spot gehört.
 */
export function stripUnvouchedLinks(text: string): string {
  if (!text.includes("](")) return text;
  return text.replace(MARKDOWN_LINK, (whole, label: string, target: string) =>
    isVouchedLinkTarget(target) ? whole : label,
  );
}
