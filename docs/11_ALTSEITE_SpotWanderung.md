# Alt-Code-Analyse #2 — Spot-Unterseite "Aktiv" (Beispiel: Aignerpark, Wanderung)

Quelle: PDF-Print `Aignerpark | SalzGuide.pdf` (8 Seiten) + Volltext von Anton.
Stand: 2026-06-21.

---

## 1. Seitenaufbau (von oben nach unten)

1. **Header / Navigation** (global): Logo „SalzGuide" (rot), Links: Entdecken · KI-Guide · Über uns · Gespeichert · 🇬🇧 English · **Login** (rotes Pill) · **Speichern** (Bookmark-Button, oben rechts im Hero).
2. **Hero-Bild**: vollbreites Spot-Foto.
3. **Quick-Facts-Leiste** (weiße Rounded-Card, überlappt Hero unten) — **4 Facts** für Aktiv-Spots:
   - ⏳ **2 h** (Zeit/Dauer)
   - 🥾 **mittel** (Schwierigkeit)
   - 🌤️ **Frühling – Herbst** (beste Jahreszeit)
   - 🚌 **Öffis & Auto** (Erreichbarkeit)
4. **Kategorie-Label** „WANDERUNG" (klein, uppercase) + **Titel** „Aignerpark" (groß, fett).
5. **Allgemeines**: Überschrift + Fließtext (links) · Foto (rechts), als weiße Card.
6. **Insider-Tipp**: Foto (links) · Überschrift + Byline „Tipp von **Anton, Local**" (mit Avatar) + Text (rechts).
7. **Wetter für diesen Spot**: 7-Tage-Vorschau (Wochentag-Kürzel · Wetter-Emoji · Höchst°/Tiefst° · Regen-%). **Heute** rot umrandet hervorgehoben. → **Meteoblue API**.
8. **Karte (Mapbox)**: zeigt die **Wanderroute als rote Linie** (Routen-Geometrie!) + „Karte vergrößern".
9. **Anfahrt** — **2 Buttons** mit illustriertem Bergpanorama-Hintergrund:
   - „Mit dem Auto · Route öffnen" → Google Maps `dir`, `travelmode=driving`, Ziel = **Parkplatz-Koordinaten**.
   - „Mit Öffis · ÖPNV-Route öffnen" → Google Maps `dir`, `travelmode=transit`, Ziel = **Startpunkt/Station-Koordinaten**.
   - 🔑 Die beiden Buttons nutzen **unterschiedliche Zielkoordinaten** (Auto→Parkplatz, Öffis→Startpunkt). Beispiel: Auto `47.78551,13.08962` vs. Öffis `47.78595,13.08963`.
10. **Dauer & Schwierigkeit** (⏳) · **Beste Jahreszeit** (🌤️) · **Lage & Erreichbarkeit** (📍) — je Emoji-Icon + Überschrift + Absatz.
11. **Footer**: Kooperations-Hinweis (SalzburgerLand Tourismus, Gasteinertal Tourismus), Social (Instagram/TikTok/YouTube), Menü, Rechtliches (Impressum · Datenschutz · AGB · Widerruf), Kontakt (anton@salzguide.com).

---

## 2. Design-Sprache (bestätigt iOS-2026-Look)

- **Hintergrund**: warmes Creme/Off-White (~`#faf6ec`). **Cards**: reinweiß, große Radien (~20px), weiche Schatten.
- Großzügige Weißräume, klare Typo-Hierarchie (fette dunkle Headings `#111`, grauer Fließtext), Emoji als Section-Icons.
- Quick-Facts als „schwebende" Glas/weiße Card über dem Hero — sehr app-artig.
- Akzentfarbe Rot (`#cc2924`) für Logo, Login, Heute-Markierung.

---

## 3. Konsequenzen fürs Datenmodell (zusätzlich zu Explore-Feldern)

Pro Spot brauchen wir über die Explore-Felder hinaus:
- **Quick-Facts (Aktiv):** `duration` (z.B. „2 h"), `difficulty` (leicht/mittel/schwer), `best_season` (Kurzform), `access` (öffis|auto|beides) — teils schon durch `bus` ableitbar, aber eigener Anzeigetext nötig.
- **Kategorie-Label** (z.B. „Wanderung", „Spaziergang") = Spot-Typ/Label fürs Detail.
- **Content-Blöcke** (je 1 kurzer Text, mehrsprachig):
  - `general` (Allgemeines) + Bild
  - `insider_tip` (Insider-Tipp) + Bild + Autor/Byline
  - `duration_text` (Dauer & Schwierigkeit)
  - `season_text` (Beste Jahreszeit)
  - `location_text` (Lage & Erreichbarkeit)
- **Geo:** `parking_coords` (Auto-Ziel) **und** `start_coords`/`transit_coords` (Öffi-Ziel) — **zwei** Koordinatensätze. Plus Map-Marker-Punkt (kann = Startpunkt sein).
- **Routen-Geometrie:** optionale Polyline/GeoJSON für die Wanderroute (rote Linie). Manche Spots = nur Punkt, keine Route.
- **Bilder:** Hero + mehrere Inhaltsbilder (Allgemeines, Insider). → Medien-Tabelle pro Spot.
- **Wetter:** Meteoblue, gecached pro Spot (siehe API-Caching-Konzept in Architektur).

---

## 4. Externe Integrationen (bestätigt)
- **Meteoblue API** — 7-Tage-Vorschau pro Spot-Koordinate, gecached (kosteneffizient: 1× pro Tag/Spot reicht).
- **Google Maps Deeplinks** — `dir`-Links für Auto (driving) & Öffis (transit), getrennte Zielkoordinaten.
- **Mapbox** — Karte mit Punkt ODER Route.

---

## 5. Offene Fragen an Anton (Aktiv-Spot)
- [ ] Routen-Geometrie: woher kommen die roten Linien aktuell (GPX-Import? manuell in Mapbox gezeichnet?) — wichtig für Migration & Anlege-Flow.
- [ ] „Speichern"-Button: aktuell schon funktional (nur eingeloggt?) oder neu?
- [ ] Avatar/Byline beim Insider-Tipp: immer Anton/Simon, oder pro Spot wählbar?
