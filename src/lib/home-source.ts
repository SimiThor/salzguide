// Was auf der Startseite auf DEUTSCH wirklich steht, und die Versionsmarke dazu.
//
// Die Startseiten-Texte haben zwei Stufen: die gepflegten Texte aus der DB, und darunter
// messages/de.json als Auffangnetz (siehe home-content.ts). „Der deutsche Stand" ist also
// nie die DB-Zeile allein, sondern immer beide zusammen. Diese Datei ist die EINE Stelle,
// die das ausrechnet, und alle vier Stellen fragen hier:
//
//   - die Startseite (home-content.ts)      -> was der Besucher liest
//   - das Admin-Formular (admin.ts)         -> was in den Feldern steht
//   - „In alle Sprachen übersetzen"         -> was übersetzt wird
//   - der Veraltet-Hinweis (source_hash)    -> wogegen verglichen wird
//
// WARUM SIE EXISTIERT: Vorher rechnete jede Stelle für sich. Der Admin hashte Datei + DB,
// das Übersetzen hashte nur die DB. Solange die DB alle Felder hatte, war das dasselbe.
// Dann kamen zwei neue Felder dazu (Instagram: socialEyebrow, socialCta). Sie standen in
// der Datei, aber nie in der DB, weil das Formular sie nur vorbefüllt und ohne Änderung
// nichts zu speichern hat. Ab da unterschieden sich die beiden Hashes IMMER: Der Admin
// meldete „Übersetzungen veraltet", das Übersetzen schrieb seine (andere) Marke, und der
// Hinweis blieb stehen, egal wie oft man drückte. Die zwei Felder wurden nebenbei auch nie
// übersetzt und standen in allen neun Sprachen auf Deutsch.
//
// Zwei Rechnungen für dieselbe Frage sind der Fehler. Deshalb nimmt homeSourceHash() die
// rohe DB-Zeile entgegen und löst sie SELBST auf: Man kann ihr nicht mehr das Falsche geben.
import { hashTexts } from "./spot-hash";
import { homeTextParts, type HomeTexts } from "./home-fields";
import deMessages from "../../messages/de.json";

// Die Datei-Texte als unterste Stufe. Nicht `as HomeTexts`, sondern geprüft: Was in der
// JSON kein String ist, ist kein Text. Bewusst ALLE Home-Keys, nicht nur die aus
// HOME_GROUPS: Ein Key, den die Seite liest, den der Admin aber nicht pflegen darf, soll
// trotzdem sein Auffangnetz haben.
export const HOME_FILE_TEXTS: HomeTexts = Object.fromEntries(
  Object.entries((deMessages as { Home?: Record<string, unknown> }).Home ?? {}).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  ),
);

/**
 * Der deutsche Stand der Startseite: die gepflegten DB-Texte, für alles andere die Datei.
 *
 * Leere Strings zählen NICHT als gepflegt, sonst radiert ein leeres Feld im Admin die
 * Zeile auf der Seite aus, statt auf die Datei zurückzufallen.
 *
 * Idempotent: Ein bereits aufgelöster Stand kommt unverändert wieder heraus. Deshalb ist
 * es egal, ob hier die DB-Zeile oder ein schon aufgelöster Stand ankommt.
 */
export function homeSourceTexts(db: HomeTexts | null | undefined): HomeTexts {
  const out: HomeTexts = { ...HOME_FILE_TEXTS };
  for (const [k, v] of Object.entries(db ?? {})) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

/**
 * Versionsmarke des deutschen Standes. Weicht sie vom gespeicherten `source_hash` ab,
 * sind die Übersetzungen veraltet.
 *
 * Nimmt die ROHE DB-Zeile und löst selbst auf. Gehasht werden nur die pflegbaren Felder
 * (HOME_KEYS, feste Reihenfolge) — die Übersetzungen veralten also nur, wenn sich wirklich
 * ein Text geändert hat.
 */
export function homeSourceHash(db: HomeTexts | null | undefined): string {
  return hashTexts(homeTextParts(homeSourceTexts(db)));
}
