// Welche Texte der Startseite im Admin pflegbar sind, in welcher Reihenfolge und unter
// welchem Namen. EINE Quelle, aus der gleichzeitig folgen:
//   - das Admin-Formular (Gruppen, Beschriftungen, ein- vs. mehrzeilig)
//   - der `source_hash` (nur diese Felder zählen -> Übersetzungen veralten nur, wenn sich
//     wirklich sichtbarer Text geändert hat)
//   - was übersetzt wird
//
// Ohne diese Liste müsste jede der drei Stellen die 40 Keys selbst kennen, und beim
// nächsten neuen Key würde genau eine davon vergessen. Genau so ist die Em-Dash-Regel
// dreimal durchgerutscht.
//
// Die Reihenfolge hier ist die Reihenfolge der Seite. Wer im Admin von oben nach unten
// liest, geht die Startseite von oben nach unten durch.

export type HomeField = {
  key: string;
  label: string;
  /** Mehrzeiliges Feld (Fliesstext) statt einzeiliger Eingabe. */
  long?: boolean;
  /** Erklärung unter dem Feld: Was der Text tut, oder was man nicht kaputtmachen darf. */
  hint?: string;
};

export type HomeGroup = { title: string; note?: string; fields: HomeField[] };

export const HOME_GROUPS: readonly HomeGroup[] = [
  {
    title: "Kopfzeile & Hero",
    fields: [
      { key: "heroTitle", label: "Überschrift", hint: "Rendert bis 68px. Zwei kurze Sätze halten besser als einer langer." },
      { key: "heroSubtitle", label: "Untertitel", long: true, hint: "Macht die Verständnis-Arbeit: Wer noch nie von uns gehört hat, muss HIER erfahren, was das ist." },
      { key: "heroCta", label: "Knopf" },
      { key: "navCta", label: "Knopf in der Kopfzeile", hint: "Erscheint erst beim Scrollen." },
    ],
  },
  {
    title: "Die drei Kacheln",
    fields: [
      { key: "trustLocalsTitle", label: "Kachel 1: Titel" },
      { key: "trustLocalsBody", label: "Kachel 1: Text" },
      { key: "trustSpotsTitle", label: "Kachel 2: Titel (ab 10 Spots)", hint: "{count} wird durch die echte Zahl ersetzt, abgerundet. Die Klammern müssen stehen bleiben." },
      { key: "trustSpotsTitleExact", label: "Kachel 2: Titel (unter 10 Spots)", hint: "Gilt, solange weniger als 10 Spots online sind. {count} ist dann die exakte Zahl." },
      { key: "trustSpotsBody", label: "Kachel 2: Text" },
      { key: "trustVisitorsTitle", label: "Kachel 3: Titel", hint: "ACHTUNG: Gemessen sind 25.000 BESUCHER der alten Seite. Die 10.000 sind Antons Schätzung, keine Messung. Nicht wachsen lassen, ohne sie zu messen." },
      { key: "trustVisitorsBody", label: "Kachel 3: Text" },
    ],
  },
  {
    title: "Spots von der Karte",
    note: "Welche Spots hier stehen, wählst du weiter unten unter „Spots auf der Startseite“.",
    fields: [
      { key: "featuredEyebrow", label: "Kleine Zeile darüber", hint: "Keine Anzahl hineinschreiben: du darfst bis zu 6 Spots auswählen." },
      { key: "featuredTitle", label: "Überschrift" },
      { key: "featuredCta", label: "Knopf" },
    ],
  },
  {
    title: "Der Unterschied",
    fields: [
      { key: "pitchEyebrow", label: "Kleine Zeile darüber" },
      { key: "pitchTitle", label: "Überschrift" },
      { key: "pitchBody", label: "Text", long: true },
    ],
  },
  {
    title: "Die drei Features",
    note: "Nur behaupten, was in der Datenbank wirklich flächendeckend gepflegt ist. Öffnungszeiten und Öffi standen hier mal und hingen an je einem einzigen Spot.",
    fields: [
      { key: "feat1Title", label: "Feature 1: Titel" },
      { key: "feat1Body", label: "Feature 1: Text", long: true },
      { key: "feat2Title", label: "Feature 2: Titel" },
      { key: "feat2Body", label: "Feature 2: Text", long: true },
      { key: "feat3Title", label: "Feature 3: Titel" },
      { key: "feat3Body", label: "Feature 3: Text", long: true },
    ],
  },
  {
    title: "Gründer",
    fields: [
      { key: "foundersEyebrow", label: "Kleine Zeile darüber" },
      { key: "foundersTitle", label: "Überschrift" },
      { key: "foundersBody", label: "Text" },
      { key: "antonName", label: "Anton: Name" },
      { key: "antonBody", label: "Anton: Text", long: true },
      { key: "simonName", label: "Simon: Name" },
      { key: "simonBody", label: "Simon: Text", long: true },
    ],
  },
  {
    title: "Toni",
    fields: [
      { key: "toniEyebrow", label: "Kleine Zeile darüber" },
      { key: "toniTitle", label: "Überschrift" },
      { key: "toniBody", label: "Text", long: true },
      { key: "toniCta", label: "Knopf" },
    ],
  },
  {
    title: "Pro",
    note: "Der Preis und die vier Vorteile kommen aus Stripe und aus proFeatures.ts, nicht von hier.",
    fields: [
      { key: "proEyebrow", label: "Kleine Zeile darüber", hint: "Steht neben dem Pro-Abzeichen." },
      { key: "proTitle", label: "Überschrift" },
      { key: "proCta", label: "Knopf" },
    ],
  },
  {
    title: "Schluss",
    fields: [{ key: "finalTitle", label: "Überschrift" }],
  },
  {
    title: "Kleinkram",
    fields: [
      { key: "tagline", label: "Fusszeile", hint: "Steht im Footer JEDER Seite, nicht nur auf der Startseite." },
      { key: "videoPlay", label: "Video-Knopf (für Screenreader)" },
    ],
  },
] as const;

// Alle pflegbaren Keys, in Seiten-Reihenfolge.
export const HOME_KEYS: readonly string[] = HOME_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

export type HomeTexts = Record<string, string>;

// Nur die gepflegten Felder, in fester Reihenfolge, als Grundlage für den Hash.
// Feste Reihenfolge ist Pflicht: Ein Objekt hat keine, und ein Hash über eine zufällige
// Reihenfolge würde die Übersetzungen bei jedem Speichern für „veraltet" erklären.
export function homeTextParts(texts: HomeTexts): string[] {
  return HOME_KEYS.map((k) => texts[k] ?? "");
}
