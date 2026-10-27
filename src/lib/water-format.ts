// Wassertemperatur immer in ganzen Grad ("14", nie "13,7"): Eine Nachkommastelle sieht
// unruhig aus und hilft beim Baden niemandem. Eigene Datei ohne "server-only", weil
// Server-Karte (SpotWaterTemp), Seen-Karte (WaterExplore) und Toni-Chips (AiWaterChips)
// dieselbe Regel brauchen; water-temp.ts darf der Client nicht importieren.
// Math.round rundet kaufmännisch (13,5 -> 14), genau wie WaterDegrees in der iOS-App.
// "+ 0" macht aus -0 eine 0: Ein Messwert von genau -0.0 würde sonst als "-0" erscheinen.
export const formatWaterTemp = (v: number, loc: string) =>
  (Math.round(v) + 0).toLocaleString(loc, { maximumFractionDigits: 0 });
