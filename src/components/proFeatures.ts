// Pro-Vorteile als EINZIGE Quelle (Key -> i18n „Pro"-Namespace, Icon = Emoji-Chip).
// Genutzt von /pro (ProLanding) UND der /profil-Karte (ProUpgrade) -> immer identisch.
// Die Reihenfolge ist die Reihenfolge der Kaufgründe, nicht die des Funktionsumfangs:
// zuerst das, was gesperrt ist und wofür jemand zahlt (Spots mit Insider-Tipp), dann die
// Wanderungen, die wir selbst gegangen sind, dann der Grund, warum die Empfehlung etwas
// wert ist.
//
// Toni steht hier bewusst NICHT und kommt auch nicht zurück (Antons Regel, 07/2026):
// Toni wird nirgends als Pro-Vorteil verkauft – nicht hier, nicht in Meta.proDescription,
// nicht im Chat-Tageslimit (Ai.paywallFree*), nicht in Pro.successBody.
//
// Die Audio-Touren standen hier und sind vorerst raus: Es ist noch keine veröffentlicht
// (07/2026). Eine Zeile, die etwas verspricht, das ein Käufer heute nicht bekommt, ist
// genau die Sorte Satz, die diese Marke nicht machen darf. Sobald die erste Tour live ist,
// gehört sie zurück.
//
// „Einmal zahlen, kein Abo" stand hier als fünfte Zeile und ist weg: Der Satz steht auf
// jeder dieser Flächen ohnehin direkt am Preis. Zweimal auf einem Bildschirm ist keine
// Betonung, sondern eine Wiederholung, und sie kostete den Platz, den die Wanderungen
// brauchen.
export const PRO_FEATURES = [
  { key: "feat1", icon: "🤫" },
  { key: "feat2", icon: "🥾" },
  { key: "feat3", icon: "💛" },
] as const;
