// Pro-Vorteile als EINZIGE Quelle (Key -> i18n „Pro"-Namespace, Icon = Emoji-Chip).
// Genutzt von /pro (ProLanding) UND der /profil-Karte (ProUpgrade) -> immer identisch.
// Die Reihenfolge ist die Reihenfolge der Kaufgründe, nicht die des Funktionsumfangs:
// zuerst das, was gesperrt ist und wofür jemand zahlt (Spots mit Insider-Tipp), dann die
// Wanderungen, die wir selbst gegangen sind, dann die Audio-Touren, dann Toni.
//
// „Einmal zahlen, kein Abo" stand hier als fünfte Zeile und ist weg: Der Satz steht auf
// jeder dieser Flächen ohnehin direkt am Preis. Zweimal auf einem Bildschirm ist keine
// Betonung, sondern eine Wiederholung, und sie kostete den Platz, den die Wanderungen
// brauchen.
export const PRO_FEATURES = [
  { key: "feat1", icon: "🤫" },
  { key: "feat2", icon: "🥾" },
  { key: "feat3", icon: "🎧" },
  { key: "feat4", icon: "💬" },
] as const;
