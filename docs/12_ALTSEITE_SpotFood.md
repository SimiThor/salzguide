# Alt-Code-Analyse #3 — Spot-Unterseite "Food" (Beispiel: Karaffu, Café)

Quelle: PDF-Print `Karaffu | SalzGuide.pdf` (6 Seiten) + Volltext von Anton.
Stand: 2026-06-21.

---

## 1. Seitenaufbau (Food-Variante) — Unterschiede zur Aktiv-Variante **fett**

1. **Header / Navigation** — identisch (Logo, Entdecken/KI-Guide/Über uns/Gespeichert, English, Login, Speichern).
2. **Hero-Bild** — identisch.
3. **Quick-Facts-Leiste — 4 Facts für FOOD (andere Kategorien!):**
   - 🍽️ **Coffee Spot** — *Art des Lokals* (z.B. „Österreichisch", „Coffee Spot")
   - 💸 **mittel** — *Preisniveau*
   - 📍 **Stadt Salzburg** — *Standort*
   - ⭐ **Hidden Gem** — *Bekanntheit*
4. **Kategorie-Label** „CAFÉ" + **Titel** „Karaffu".
5. **Allgemeines** — identisch (Text + Bild).
6. **Insider-Tipp** — identisch (Bild + Byline „Anton, Local" + Text).
7. **🔴 KEIN Wetter-Block** — Food-Spots zeigen kein Meteoblue-Wetter.
8. **Karte (Mapbox)** — zeigt **nur einen Punkt** (keine Route). „Karte vergrößern".
9. **Anfahrt — nur EIN Button:** „🚗 Route zum Parkplatz" → Google Maps `dir` (driving). **Kein Öffis-Button** bei Food (anders als Aktiv-Spots mit 2 Buttons).
10. **🆕 Öffnungszeiten-Block** (Google Places) — **steht VOR den 3 Kurztexten**, auf Desktop rechts neben der Karte:
    - Status oben: „**Jetzt geöffnet · bis 18:00**" (grün, dynamisch) bzw. geschlossen.
    - Liste Montag–Sonntag mit Zeiten (z.B. `09:00–18:00`, `Geschlossen`), **heutiger Tag hervorgehoben**.
    - Footer: „**Powered by Google**" (Pflicht-Attribution lt. Google-ToS).
11. **3 Kurztexte (Food-Variante)** — je Emoji + Überschrift + Absatz:
    - 🍽️ **Küche & Stil** (statt „Dauer & Schwierigkeit")
    - 💸 **Preisniveau** (statt „Beste Jahreszeit")
    - 📍 **Lage & Erreichbarkeit** (gleich)
12. **Footer** — identisch.

---

## 2. Aktiv-Spot vs. Food-Spot — Übersicht

| Element | Aktiv (Wanderung/Ort) | Food |
|---|---|---|
| Quick-Fact 1 | ⏳ Zeit/Dauer | 🍽️ Art des Lokals |
| Quick-Fact 2 | 🥾 Schwierigkeit | 💸 Preisniveau |
| Quick-Fact 3 | 🌤️ Beste Jahreszeit | 📍 Standort |
| Quick-Fact 4 | 🚌 Erreichbarkeit | ⭐ Bekanntheit |
| Wetter (Meteoblue) | ✅ ja | ❌ nein |
| Karte | Punkt **oder Route** | nur Punkt |
| Anfahrt-Buttons | 2 (Auto + Öffis) | 1 (Auto/Parkplatz) |
| Öffnungszeiten (Places) | ❌ (außer Spots mit Zeiten) | ✅ ja |
| Kurztext 1 | Dauer & Schwierigkeit | Küche & Stil |
| Kurztext 2 | Beste Jahreszeit | Preisniveau |
| Kurztext 3 | Lage & Erreichbarkeit | Lage & Erreichbarkeit |

> → Im Neubau: **ein** Spot-Datenmodell mit Feld `type` (`activity` | `food`), das die Anzeige steuert. Plus generisches Flag `has_opening_hours` (für Aktiv-Spots mit Öffnungszeiten, z.B. Burgen/Museen/Schifffahrt). „Öffnungszeiten VOR den 3 Kurztexten" gilt typübergreifend, wenn vorhanden.

---

## 3. Konsequenzen Datenmodell (Food-spezifisch)
- Quick-Facts Food: `food_type` (Art), `price_level` (Preisniveau), `area`/`location_label` (Standort), `fame`/`known_level` (Bekanntheit, z.B. „Hidden Gem").
- Kurztexte Food (mehrsprachig): `cuisine_text` (Küche & Stil), `price_text` (Preisniveau), `location_text` (Lage & Erreichbarkeit).
- **Google Places**: `google_place_id` pro Spot → Öffnungszeiten + Live-Status („jetzt geöffnet"). **Caching** (z.B. tägliche Sync der `opening_hours`; Live-Status `open now` clientseitig aus den gecachten Zeiten + aktueller Uhrzeit berechnen → spart Calls). „Powered by Google" anzeigen.
- Anfahrt Food: nur `parking_coords` (1 Button). Aktiv: `parking_coords` + `transit_coords` (2 Buttons).

---

## 4. Wichtige technische Notiz — Google Places kosteneffizient
- **Nicht** bei jedem Seitenaufruf live abfragen (teuer). Stattdessen: `opening_hours` (reguläre Wochenzeiten) **1× täglich** pro Spot cachen (oder bei Spot-Bearbeitung). Den „Jetzt geöffnet/geschlossen bis X"-Status **clientseitig** aus den gecachten Zeiten + lokaler Zeit berechnen. Spart fast alle Place-Details-Calls.
- Achtung Google-ToS: Place-Daten dürfen begrenzt gecached werden (place_id dauerhaft; andere Felder i.d.R. bis 30 Tage). → tägliche Aktualisierung ist konform & günstig.

---

## 5. Offene Fragen an Anton (Food-Spot)
- [ ] Sollen Food-Spots künftig **auch** einen Öffis-Button bekommen (aktuell nur Auto)? Oder bewusst nur Parkplatz?
- [ ] Bekanntheits-Stufen fix definiert? (z.B. „Hidden Gem", „Local Favorite", „Ikone" …) — für konsistente Badges.
- [ ] Preisniveau-Stufen fix? (z.B. günstig/mittel/gehoben) — für Filter/KI-Guide.
