# Konzept — Routen super-einfach anlegen (Admin)

Anforderung (Anton): Beim Anlegen eines neuen Spots soll die Wanderroute **ohne GPX-Import** entstehen — Admin setzt nur **Start, Ziel und optionale Zwischenstops**, die Route wird **automatisch entlang echter Wege** berechnet und gespeichert.
Stand: 2026-06-21.

---

## 1. Grundidee
Im Spot-Anlege-Formular liegt eine **interaktive Karte**. Der Admin:
1. Klickt **Start** (🅿️ = Parkplatz/Startpunkt).
2. Klickt **Ziel** (🏁).
3. Optional: klickt **Zwischenstops** (Waypoints) für den gewünschten Weg.
4. System ruft eine **Wander-Routing-API** auf → bekommt **fertige Route entlang Wanderwegen inkl. Höhenprofil** zurück.
5. **Live-Vorschau** auf der Karte; Punkte per Drag verschiebbar → Route rechnet automatisch neu.
6. **Speichern** → `route_geojson` (LineString mit Höhen) wird im Spot gespeichert. **Kein Laufzeit-API-Call** mehr beim Besucher (Route liegt fertig in der DB, genau wie heute).

→ Das ersetzt das manuelle GPX-Workflow vollständig und ist in ~20 Sekunden erledigt.

## 2. Empfohlene Technik: **OpenRouteService (ORS), Profil `foot-hiking`**
Warum ORS `foot-hiking` als Primärlösung:
- **Für Wandern gebaut:** folgt echten Wander-/Bergwegen (OSM-Pfade), nicht nur Gehsteigen.
- **Höhenprofil inklusive:** `elevation=true` liefert `[lng,lat,ele]` — exakt unser bestehendes Format → Höhenprofil-Diagramm direkt möglich.
- **Bis zu 50 Waypoints** pro Route (Start + Ziel + Zwischenstops) — mehr als genug.
- **Großzügiger Free-Tier**, Routen-Erstellung ist admin-selten → effektiv **kostenlos**. ([Restrictions](https://openrouteservice.org/restrictions/), [Services](https://openrouteservice.org/services/))
- Bonus aus der Antwort: **Distanz + Aufstieg (Höhenmeter)** werden mitgeliefert → können Quick-Facts **automatisch vorbefüllen** (Distanz, ↑Hm) und sogar eine **Gehzeit-Schätzung** (DAV/SAC-Formel aus Distanz + Aufstieg) für das „⏳ Dauer"-Fact vorschlagen.

**Alternative:** Mapbox **Directions `walking`** (Mapbox ist eh im Stack). Einfacher zu integrieren, aber: weniger bergtauglich und **keine Höhen** pro Punkt (Elevation müsste separat über Mapbox Tilequery/Terrain geholt werden). → Für Stadt-Spaziergänge okay, für alpine Touren schlechter. Empfehlung daher ORS primär.

## 3. Wichtige Details & Sonderfälle
- **Rundtouren** (Start = Ziel): über Zwischenstops abbildbar (ORS unterstützt round_trip ebenfalls).
- **Off-Trail / kein Weg vorhanden:** Fallback-Modus „direkte Linie zwischen Punkten" (ohne Snapping) + weiterhin **optionaler GPX-Upload** als Notnagel.
- **Manuelle Korrektur:** Drag der Wegpunkte = Re-Routing; zusätzlich „Punkt einfügen" auf der Linie.
- **Punkt-Spots** (kein Weg, z.B. Aussichtspunkt/Food): einfach nur **ein** Marker, keine Route — gleicher Editor, Route optional.
- **2 Koordinaten-Logik bleibt:** Routen-Start dient als `parking_coords` (Auto-Ziel); **Öffi-Zielkoordinate** (`transit_coords`) setzt der Admin als separaten Pin (oft Bahnhof/Haltestelle ≠ Parkplatz).
- **Kosten/Sicherheit:** ORS-Key in Server-ENV, Routing-Call **nur serverseitig** beim Speichern. Ergebnis wird in DB persistiert → Besucher verursachen **keine** Routing-Calls.

## 4. Auto-Berechnete Felder beim Speichern (Automatisierungs-Bonus)
Aus der ORS-Antwort direkt ableitbar und als Vorschlag ins Formular schreiben (Admin kann überschreiben):
- `distance_km`, `ascent_m`, `descent_m`
- `duration_suggest` (Gehzeit-Schätzung) → Vorschlag fürs „⏳ Dauer"-Quick-Fact
- `difficulty_hint` (grob aus Distanz + Aufstieg) → Vorschlag fürs „🥾 Schwierigkeit"-Fact
- `route_geojson` (LineString + Höhen) → Detail-Karte + optionales Höhenprofil

## 5. Datenmodell-Auswirkung
Spot-Felder ergänzen/bestätigen:
`route_geojson` (jsonb), `start_coords`/`parking_coords`, `goal_coords`, `transit_coords`, `waypoints` (jsonb, für spätere Bearbeitung), `distance_km`, `ascent_m`, `descent_m`.

## 6. Entscheidungen (2026-06-21, Anton)
- ✅ **Routing-Anbieter: OpenRouteService `foot-hiking`** (mit Höhenprofil). Mapbox `walking` bleibt optionaler Fallback.
- ✅ **Auto-Vorschlag von Gehzeit & Schwierigkeit** aus Distanz + Höhenmetern — vorbefüllt & überschreibbar. → beim Anlegen aus ORS-Antwort berechnen.

Quellen: [openrouteservice.org/restrictions](https://openrouteservice.org/restrictions/), [openrouteservice.org/services](https://openrouteservice.org/services/), [Elevation/Altitude (ORS Forum)](https://ask.openrouteservice.org/t/how-to-get-the-api-to-return-altitude/3563)
