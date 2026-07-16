# Alt-Code-Analyse #13 — Wassertemperatur-Widget (Seen)

Quelle: `Wassertemperaturen_Widget_New_v6.html` (315 Z.). Stand: 2026-06-21.

---

## 1. Was es ist
Zeigt die **aktuelle Wassertemperatur** eines Sees (für Seen-/Bade-Spots). Shortcodes `[sg_seetemp see="…"]` (DE/EN, Voll-/Nur-Titel-Varianten). Lookup über den **Seenamen** (Spot-Feld `see`/`lake_name`).

## 2. Datenquellen — **kostenlose Open Data, kein API-Key!**
1. **Land Salzburg OGD** — `salzburg.gv.at/ogd/.../Hydrografie Seen.txt` (alle Seen, TXT). Cache **1 h**.
2. **AGES Badegewässer** — JSON-DB aller österr. Badegewässer (Fallback). Cache **12 h**.
- Lookup: erst Land Salzburg (exakter Name) → sonst AGES (Fuzzy-Name-Match, max 400 Tage alt).
- Fehler-Backoff (5–10 min Leer-Cache). → gleiches kosteneffizientes Muster wie Wetter/Places.

## 3. Konsequenzen Neubau
1. **Gratis-Integration** (Behörden-Open-Data) → übernehmen, **null laufende Kosten**.
2. Server-Route lädt beide Quellen, cached (1 h / 12 h), Lookup per Seename.
3. Spot-Feld **`lake_name`** (für Seen-Spots) → triggert das Wassertemp-Modul auf der Detailseite (zusätzlich zum Wetter).
4. Reiht sich ins generische **Caching-Layer** (Wetter, Places, Wassertemp) ein.
5. Block bedingt rendern: nur bei Seen-/Bade-Spots mit `lake_name`.

## 4. 🆕 Eigene Wassertemperatur-KARTE (`Wassertemperaturen_Karte_v2.html`, 983 Z.)
Anton-Wunsch: **eigene Seite** zum Wassertemperaturen-Checken.
- **Mapbox-Karte** mit **~15 Salzburger Seen** (Master-Liste mit `name`, `lat/lng`, `src` = `ls` (Land Salzburg) **oder** `ages`, plus `match`-Name fürs Fuzzy-Matching). Jeder Marker zeigt die **aktuelle Wassertemperatur** + Messdatum im Popup.
- Seed-Liste (übernehmen): Fuschlsee, Wolfgangsee, Wallersee, Mattsee, Obertrumer See, Grabensee, Zeller See, Hintersee Faistenau, Ritzensee, Waldbad Anif, Lieferinger Badesee, Badesee Gastein, Goldegger See, Böndlsee, Prebersee.
- Gleiche Open-Data-Quellen + Caching (1 h / 12 h), `is_recent`-Check (alte Messwerte verwerfen).
- **Neubau:** eigene Seite **„Wassertemperaturen"**, nutzt **`<SpotMap>`** + denselben Wassertemp-Cache-Service. Seen als eigene kleine Tabelle (`lakes`: name, coords, source, match) — pflegeleicht, **null Kosten**.
- **Nav/Einordnung:** eigenständige Utility-Seite, erreichbar aus **Entdecken** (Einstieg/Sektion), kein Haupt-Tab. Im Sommer prominent (Bade-Saison). KI „Anton" kann Temperaturen ebenfalls nennen.
