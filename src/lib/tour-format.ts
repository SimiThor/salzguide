// Zahlen einer Runde, einmal formatiert. Die Distanz stand an drei Stellen als
// `${km} km` im Code, und das ist auf Deutsch falsch: 8.3 km liest sich dort als
// "achtunddreissig", das Dezimaltrennzeichen ist das Komma. Intl mit ausdrücklicher
// Sprache ist auf Server und Browser dasselbe Ergebnis, die Zahl übersteht die
// Hydration also unverändert (anders als formatRange, siehe docs/02).
export function kmLabel(km: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(km)} km`;
}
