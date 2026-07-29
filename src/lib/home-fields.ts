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
//
// Erklärtexte im Formular gibt es bewusst NICHT (Antons Entscheidung, 07/2026): Das UI
// bleibt still. Was kaputtgehen kann (der {count}-Platzhalter), fängt saveHomeTexts beim
// Speichern ab, und Wissenswertes steht hier als Kommentar bei seiner Gruppe.

export type HomeField = {
  key: string;
  label: string;
  /** Mehrzeiliges Feld (Fliesstext) statt einzeiliger Eingabe. */
  long?: boolean;
};

export type HomeGroup = { title: string; fields: HomeField[] };

export const HOME_GROUPS: readonly HomeGroup[] = [
  {
    title: "Kopfzeile & Hero",
    fields: [
      // Die Überschrift rendert bis 68px, kurz halten. Der Untertitel erklärt Neuen in
      // einem Satz, was SalzGuide ist. Der Kopfzeilen-Knopf erscheint erst beim Scrollen.
      { key: "heroTitle", label: "Überschrift" },
      { key: "heroSubtitle", label: "Untertitel", long: true },
      { key: "heroCta", label: "Knopf" },
      { key: "navCta", label: "Knopf in der Kopfzeile" },
    ],
  },
  {
    title: "Die drei Kacheln",
    fields: [
      { key: "trustLocalsTitle", label: "Kachel 1: Titel" },
      { key: "trustLocalsBody", label: "Kachel 1: Text" },
      // {count} in den Spot-Titeln wird zur Laufzeit durch die echte Zahl ersetzt. Der
      // Hinweis dazu stand mal als Formular-Text; jetzt lehnt saveHomeTexts einen Stand
      // ohne Platzhalter beim Speichern ab, dann kann ihn auch niemand überlesen.
      { key: "trustSpotsTitle", label: "Kachel 2: Titel (ab 10 Spots)" },
      { key: "trustSpotsTitleExact", label: "Kachel 2: Titel (unter 10 Spots)" },
      { key: "trustSpotsBody", label: "Kachel 2: Text" },
      // Gemessen sind 25.000 BESUCHER der alten WordPress-Seite; die 10.000 Trips sind
      // Antons Schätzung, keine Messung. Nicht erhöhen, ohne zu messen.
      { key: "trustVisitorsTitle", label: "Kachel 3: Titel" },
      { key: "trustVisitorsBody", label: "Kachel 3: Text" },
    ],
  },
  {
    title: "Spots von der Karte",
    // Welche Spots hier stehen, wählt der Admin weiter unten unter „Spots auf der
    // Startseite" (bis zu 6). In die kleine Zeile gehört deshalb keine Anzahl.
    fields: [
      { key: "featuredEyebrow", label: "Kleine Zeile darüber" },
      { key: "featuredTitle", label: "Überschrift" },
      { key: "featuredCta", label: "Knopf" },
    ],
  },
  {
    title: "Hidden Gems",
    // Warum die Section so heisst und was vorher hier stand (die ChatGPT-Fuschlsee-Zeile):
    // steht bei der Section selbst, components/landing/Story.tsx. Der Admin braucht die
    // Geschichte nicht.
    fields: [
      { key: "pitchEyebrow", label: "Kleine Zeile darüber" },
      { key: "pitchTitle", label: "Überschrift" },
      { key: "pitchBody", label: "Text", long: true },
    ],
  },
  {
    title: "Die drei Features",
    // Nur behaupten, was die Datenbank flächendeckend hergibt: Öffnungszeiten und Öffi
    // standen hier mal als Features und hingen an je EINEM Spot.
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
    // Preis und Vorteile kommen aus Stripe und proFeatures.ts, nicht von hier. Die
    // kleine Zeile steht neben dem Pro-Abzeichen.
    fields: [
      { key: "proEyebrow", label: "Kleine Zeile darüber" },
      { key: "proTitle", label: "Überschrift" },
      { key: "proCta", label: "Knopf" },
    ],
  },
  {
    title: "Instagram",
    // Die Beiträge kommen automatisch aus Einstellungen -> Instagram-Feed; ohne Beiträge
    // blendet sich die ganze Section aus. Die Überschrift ist der Handle selbst
    // (@salzguide) und kommt aus src/lib/social.ts, damit er beim Umbenennen nur an
    // einer Stelle steht.
    fields: [
      { key: "socialEyebrow", label: "Kleine Zeile darüber" },
      { key: "socialCta", label: "Knopf" },
    ],
  },
  {
    title: "Schluss",
    fields: [{ key: "finalTitle", label: "Überschrift" }],
  },
  {
    title: "Kleinkram",
    fields: [
      // Hier stand ein Feld „Fusszeile" mit dem Hinweis, es stehe im Footer jeder Seite.
      // Das stimmte nie: Der Footer las Legal.tagline aus den Sprachdateien (bis 07/2026,
      // seither ist die ©-Zeile samt Key raus, siehe LegalFooter.tsx). Home.tagline las
      // NIEMAND, in keinem Commit.
      //
      // Entstanden ist es beim Bau dieser Liste: Sie wurde aus dem Home-Namensraum von
      // de.json abgeleitet, dort lag ein Key namens „tagline" (ein Doppelgänger von
      // Meta.description aus der allerersten Fassung), und der bekam ein Etikett samt
      // Erklärung, die jemand für wahr hielt. Ein Feld, das nichts tut, ist schlimmer als
      // ein fehlendes: Man pflegt es, kontrolliert die Seite, sieht nichts, und sucht den
      // Fehler dann überall ausser dort, wo er ist.
      { key: "videoPlay", label: "Video-Knopf (für Screenreader)" },
    ],
  },
] as const;

// Alle pflegbaren Keys, in Seiten-Reihenfolge.
export const HOME_KEYS: readonly string[] = HOME_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

// Beschriftung eines Feldes, für Fehlermeldungen beim Speichern: „Kachel 2: Titel" sagt
// dem Admin mehr als der technische Key.
export function homeFieldLabel(key: string): string {
  for (const g of HOME_GROUPS) for (const f of g.fields) if (f.key === key) return f.label;
  return key;
}

export type HomeTexts = Record<string, string>;

// Nur die gepflegten Felder, in fester Reihenfolge, als Grundlage für den Hash.
// Feste Reihenfolge ist Pflicht: Ein Objekt hat keine, und ein Hash über eine zufällige
// Reihenfolge würde die Übersetzungen bei jedem Speichern für „veraltet" erklären.
export function homeTextParts(texts: HomeTexts): string[] {
  return HOME_KEYS.map((k) => texts[k] ?? "");
}
