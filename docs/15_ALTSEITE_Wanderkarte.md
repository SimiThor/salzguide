# Alt-Code-Analyse #6 — Detail-Karte mit Wanderroute (Spot-Unterseite)

Quelle: `Wanderkarte` (Standalone-HTML, Mapbox). Stand: 2026-06-21.
Ergänzt `11_ALTSEITE_SpotWanderung.md` (Block „Karte").

---

## 1. Was es ist
Die **eingebettete Karte auf der Aktiv-Spot-Unterseite**, die die **Wanderroute** zeichnet (die rote Linie aus dem Aignerpark-Screenshot). Eigenständige Map-Instanz pro Spot.

## 2. Technik
- **Mapbox GL JS v3.3.0**, Style `mapbox/outdoors-v12`. Start-Zoom 14, `fitBounds` auf die Route.
- **Route als GeoJSON `LineString`**, Koordinaten als Tripel **`[lng, lat, elevation]`** (Höhenmeter sind enthalten!). Im Alt-Code **hartcodiert pro Spot** in der Seite.
- **Linien-Styling (übernehmen):** weiße Outline `#ffffff` (width 6.5) unter roter Linie `#e04848` (width 3.5), `line-join/cap: round`.
- **2 Marker:** Start = `🅿️` (= Parkplatz/Startpunkt), Ziel = `🏁`. Kreis-Marker (`.sg-marker`, grau, weißer Rand, Schatten) — gleicher Stil wie Explore-Karte.
- Controls: Navigation, Geolocate (User-Heading), Custom „Zurück zur Route"-Center-Button.
- **Apple-Style Fullscreen-Toggle** (Blur-Overlay + Spinner) — identisches Muster wie Explore-Karte → **eine** gemeinsame Map-Komponente im Neubau.
- `ResizeObserver` → `map.resize()`; `cooperativeGestures` (zwei Finger / ⌘+Scroll), DE/EN-Button-Labels eingebaut.

## 3. 🔎 Notizen / Konsequenzen fürs Neubau
1. **Route gehört in die DB**, nicht in den Seitencode: Feld `route_geojson` (LineString mit Höhen) pro Spot. Render serverseitig/aus DB. Spots ohne Route → nur Punkt-Marker (wie Food).
2. **Start-Marker = Parkplatz** (🅿️), **End-Marker = Ziel** (🏁). Passt zu den 2 Geo-Koordinaten aus Doc 11 (Auto→Parkplatz). Der **Routen-Start** kann als `parking_coords` dienen, das **Routen-Ende** als `goal`. Öffi-Zielkoordinate bleibt separat.
3. **Höhendaten vorhanden** → ermöglicht als **Nice-to-have** ein Höhenprofil-Diagramm (Aufstieg/Distanz) auf der Detailseite. Notiert für später.
4. **⚠️ Zweiter Mapbox-Token:** Diese Karte nutzt einen **anderen** Public-Token als die Explore-Karte (`pk…cmb8d7tfz…` vs. Explore `pk…cmhn58ys…`). Außerdem `preconnect` zu **MapTiler** (hier ungenutzt — evtl. anderswo für Geocoding/Höhen verwendet → bei Anton nachfragen). Im Neubau: **ein** Token-Setup, domain-restricted, in ENV.
5. **Eine wiederverwendbare `<SpotMap>`-Komponente** für: (a) Explore-Übersicht (viele Marker), (b) Detail mit Route, (c) Detail nur Punkt, (d) „Gespeichert"-Karte. Props: `markers[]`, `route?`, `fullscreenfähig`.

## 4. Offene Frage (ergänzt Doc 11)
- [ ] Wird **MapTiler** woanders aktiv genutzt (Höhenprofil, Geocoding)? Sonst entfernen.
- [ ] Routen-Quelle final: GPX-Export → GeoJSON? (relevant für Anlege-Flow & Migration der bestehenden Routen)
