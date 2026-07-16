# Alt-Code-Analyse #10 — Anfahrt-Buttons (Auto / Öffis)

Quelle: `Anfahrt_v9.html` (259 Zeilen). Stand: 2026-06-21. Ergänzt Doc 11/12.

---

## 1. Was es ist
Der „Anfahrt"-Block der Detailseiten: **2 Kacheln** („Mit dem Auto" / „Mit Öffis") mit verspielter **Animation** (Auto/Bus fährt beim Scroll-in über eine illustrierte Straße herein; CSS-Keyframes, IntersectionObserver, `prefers-reduced-motion` respektiert). Schöner Polish fürs iOS-Gefühl → im Neubau als nette Mikro-Animation übernehmbar.

## 2. Daten- & Link-Logik (bestätigt 2-Koordinaten-Modell)
- `lat`/`lon` = **Spot selbst** → **Öffis-Ziel** (`travelmode=transit`).
- `lat_park`/`lon_park` = **Parkplatz** → **Auto-Ziel** (`travelmode=driving`). Fehlt der Parkplatz → Auto nutzt die Spot-Koordinaten.
- Fallback aus Post-Meta `lat`/`lon`.
- **Google-Maps-Deeplink:** `https://www.google.com/maps/dir/?api=1&destination=LAT,LON&travelmode=driving|transit`.
- Koordinaten-Sanitizing (nur `0-9 . , -`); URL/Host in Fragmenten zusammengesetzt (WAF-Umgehung — im Neubau unnötig).

## 3. Konsequenzen fürs Neubau
1. Bestätigt: Spot-Felder `transit_coords` (Spot/Haltestelle) **und** `parking_coords` (Auto). 1 Button (Food, nur Auto) vs. 2 Buttons (Aktiv) per `type`/Flag steuern.
2. Deeplink-Bau als simple Helper-Funktion (`buildMapsLink(coords, mode)`).
3. Animation als optionale, leichte Komponente — kann auch ohne den ganzen CSS-Aufwand schlicht umgesetzt werden.
4. Sicherheits-/WAF-Fragment-Tricks entfallen (saubere Server/Client-Trennung in Next.js).
