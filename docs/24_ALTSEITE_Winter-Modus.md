# Alt-Code-Analyse #14 + Konzept — Winter-Modus (Sommer/Winter-Umschalter)

Quelle: `Gastein_Datenbank+Karte+Karussell_v2.html` (693 Z.) + Antons Wunsch. Stand: 2026-06-21.

---

## 1. Was es aktuell ist
Eine **eigene, komplett duplizierte** Explore-Instanz für **Gastein im Winter**: eigene DB-Funktion `sg_get_gastein_spots()`, eigene Shortcodes `salzguide_gastein_collections` / `salzguide_gastein_map`. Aufbau **identisch** zur Sommer-Explore (Datenbank + Karussells + Mapbox-Karte), nur:
- **19 Spots, alle Free**, 3 **Winter-Kategorien:** `food` (Skihütten/Cafés), `view` (Aussicht & Erholung — Thermen, Aussichtsplattformen, Hängebrücke), `action` (Skigebiets-Bahnen, Mountainkart).
- Winter-Charakter: Ski-Lunch, Hüttenabende mit Fondue, Felsentherme/Alpentherme, Gondelbahnen ins Skigebiet.
- Kleine Feldabweichung: `emojiFree`/`emojiPro` statt `emoji`.

## 2. Antons Ziel
- **Winter-Modus zum Umschalten** mit **eigenen Winter-Spots** — robust, einfach, **nicht zu kompliziert für User**.
- Zukunft: **nicht nur Gastein**, sondern **ganz Salzburg als Winter-Karte** (genau wie der Sommer).

## 3. 🔴 Anti-Pattern erkannt → Neubau macht's anders
Aktuell ist die ganze Explore-Maschinerie **dupliziert** (Sommer-Code + Gastein-Code parallel) → klassischer „gepfuscht/verstreut"-Fall. **Nicht** kopieren im Neubau.

## 4. Konzept Neubau — EIN System mit Saison-Dimension
**Eine** Explore-Engine, die per **Saison** filtert. Kein zweiter Code-Strang.

- **Spot-Feld `seasons`** (Mehrwert-Array): `['summer']`, `['winter']` oder `['summer','winter']`.
  - Ganzjahres-Spots (Thermen, Cafés, Stadt-Spaziergänge) erscheinen in **beiden** Modi — nur einmal angelegt.
- **Kategorien gehören zur Saison:** Sommer = favs/hike-ez/lakes/food/hills/gorges/roads/hike-hard; Winter = food/view/action (erweiterbar). Eine `categories`-Tabelle mit `season`-Zuordnung.
- **Globaler Sommer/Winter-Toggle** (einfach, prominent, iOS-Segmented-Control-Stil) in der Explore-Kopfzeile. Schaltet **Spots, Kategorien-Karussells UND Karte** synchron um.
- **Persistenz:** Auswahl in `localStorage` (Gast) bzw. User-Setting (eingeloggt).
- **Sinnvoller Default:** automatisch nach Datum vorbelegen (z.B. **Dez–März → Winter**, sonst Sommer) — **aber jederzeit manuell überschreibbar**. Hält's einfach, fühlt sich „richtig" an.
- **Region (Gastein) ≠ Saison:** Region ist orthogonal. Jetzt: Saison-Toggle ist der Kern. Später optional Regions-Filter, wenn Winter ganz Salzburg abdeckt — **dasselbe** System, nur mehr Winter-Spots.

## 5. Datenmodell-Auswirkung
- Spot: `seasons text[]` (oder Join-Tabelle `spot_seasons`).
- `categories`: Feld `season` (welche Saison), damit Karussell-Sets sauber getrennt sind.
- Pro/Free, Detailseiten, KI, Action-Tiles etc. funktionieren **unverändert** — Winter-Spots sind normale Spots mit `seasons=['winter']`.
- Emoji vereinheitlichen (`emoji`), Lock-Emoji (🤫) wie gehabt aus Pro-Status.

## 6. Optional/später (nicht MVP, „einfach halten")
- Winter-spezifische Quick-Facts denkbar (z.B. bei Skigebiet: Pisten-km, Lift-Status) — **erst später**, MVP nutzt dasselbe Fact-Schema.
- Live-Schnee/Lift-Status-API — späterer Ausbau.
- Auto-Default-Saison per Datum (siehe oben) — leicht, empfehlenswert für MVP.

## 7. Ergebnis fürs Briefing/Architektur
✅ **Winter-Modus wird Kern-Feature** der neuen Explore: **ein** System, **`seasons`-Dimension**, einfacher Sommer/Winter-Toggle, saison-spezifische Kategorien. Skaliert direkt von „Gastein-Winter" zu „ganz Salzburg-Winter" ohne neuen Code.
