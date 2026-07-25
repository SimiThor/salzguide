// Das gemeinsame Wörterbuch für die kurzen Fehlercodes der Admin-Server-Actions.
//
// Die Actions geben bewusst CODES zurück („db", „auth", „slug_taken"), keine rohen
// Datenbank-Meldungen: Rohe Postgres-Texte verraten Tabellen-/Constraint-Namen an den
// Browser und sind englisch. Vorher zeigte jedes Formular die Codes wörtlich an –
// eine abgelaufene Session stand als rotes „auth" auf dem Bildschirm.
//
// Echte SÄTZE (mit Leerzeichen) lassen wir durch: Einige Actions formulieren ihre
// Fehler bereits bewusst auf Deutsch („ANTHROPIC_API_KEY fehlt", „KI-Dienst gerade
// nicht erreichbar …"). Unbekannte nackte Codes fallen auf eine generische Meldung
// zurück, statt kryptisch im UI zu landen.
const ADMIN_ERRORS: Record<string, string> = {
  auth: "Nicht angemeldet. Bitte neu einloggen.",
  forbidden: "Keine Admin-Rechte.",
  db: "Speichern fehlgeschlagen. Bitte nochmal versuchen.",
  network: "Gerade nicht erreichbar. Bitte nochmal versuchen.",
  required: "Pflichtfelder fehlen.",
  bad_id: "Ungültige ID.",
  bad_input: "Ungültige Eingabe.",
  not_found: "Nicht gefunden.",
  bad_url: "Nur Dateien aus dem eigenen Storage sind erlaubt.",
  slug_taken: "Dieser Slug ist schon vergeben.",
  key_taken: "Dieser Key ist schon vergeben.",
  start_required: "Bitte einen Start-Zeitpunkt angeben.",
  check_failed: "Prüfung fehlgeschlagen. Bitte nochmal versuchen.",
  translations_persist_failed:
    "Übersetzungen konnten nicht gespeichert werden. Das Event bleibt Entwurf.",
  en_required: "Ist ein deutsches Feld gefüllt, muss das englische dazu gefüllt sein.",
  end_before_start: "Das Ende liegt vor dem Start.",
  place_id_required: "Für Google-Öffnungszeiten fehlt die Place-ID.",
  location_required:
    "Zum Veröffentlichen bitte den Ort auf der Karte setzen (Einzelpunkt oder Wanderung).",
  no_de: "Es gibt noch keine deutschen Texte als Quelle.",
  translations_incomplete:
    "Zum Veröffentlichen müssen alle Sprachen übersetzt und aktuell sein.",
  langs_incomplete: "Zum Veröffentlichen müssen alle Sprachen gefüllt sein.",
  no_published_stops:
    "Zum Veröffentlichen braucht die Tour mindestens einen veröffentlichten Punkt.",
  points_area_mismatch:
    "Mindestens eine Station gehört nicht zum gewählten Gebiet. Bitte Stationen prüfen.",
};

/** Fehlercode einer Admin-Action in einen deutschen Satz übersetzen. */
export function adminErrorText(code?: string | null): string {
  if (!code) return "Fehlgeschlagen. Bitte nochmal versuchen.";
  const known = ADMIN_ERRORS[code];
  if (known) return known;
  if (code.includes(" ")) return code; // bewusst formulierte Server-Meldung
  return "Fehlgeschlagen. Bitte nochmal versuchen.";
}
