// Vergleichsform für Freitext: alles weg, was zwei Schreibweisen desselben Wortes trennt.
//
// EINE Quelle für zwei Aufgaben, damit sie GLEICH falten:
//   - die Admin-Spot-Suche (components/admin/AdminSpotList.tsx)
//   - der Quick-Fact-Abgleich (facts-i18n.ts, normalizeFact)
// Faltet die Suche anders als der Wert, findet die eine nicht, was die andere ablegt.
//
// Bewusst ohne Abhängigkeiten (kein server-only, kein JSON), damit es auch in einer
// "use client"-Komponente landen darf, ohne Ballast ins Browser-Bundle zu ziehen.
export function normalizeText(s: string): string {
  return (
    s
      .normalize("NFC")
      .toLowerCase()
      // Umlaut-Umschrift VOR dem Akzent-Abbau. Sonst würde "Grödig" zu "grodig" und träfe die
      // verbreitete Tippweise "Groedig" nie. Der umgekehrte Weg (oe -> o) wäre falsch: der
      // zerlegte deutsche Wörter wie "Feuer" oder "Neukirchen".
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // restliche Akzente: "Café" = "Cafe"
      .replace(/\bsankt\b/g, "st") // "Sankt Gilgen" = "St. Gilgen"
      .replace(/[\u2010-\u2015]/g, "-") // –, —, ‒ = -
      .replace(/\s*&\s*/g, " und ") // "See & Baden" = "See und Baden"
      .replace(/[^\p{L}\p{N}]+/gu, " ") // Satzzeichen -> Trenner
      .trim()
      .replace(/\s+/g, " ")
  );
}
