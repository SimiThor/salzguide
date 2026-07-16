# Alt-Code-Analyse #4 — Wetter-Integration (Meteoblue)

Quelle: `Wetter_Spots_Unterseiten_Neu_Juni_2026_Teil_1_v5.html` (PHP-Shortcodes, 364 Zeilen).
Stand: 2026-06-21.

---

## 1. Was es macht
7-Tage-Vorschau pro Spot (der „Wetter für diesen Spot"-Block auf Aktiv-Unterseiten). Inline-SVG-Wettericons, horizontale Karten-Strip, heutiger Tag hervorgehoben. 4 Shortcode-Varianten: mobile/desktop × de/en.

## 2. API & Datenfluss
- **Meteoblue**, Paket `basic-day`:
  `https://my.meteoblue.com/packages/basic-day?lat=$lat&lon=$lon&apikey=$key&forecast_days=8`
- `forecast_days=8` (Puffer, damit nach Filtern alter Tage immer 7 zukünftige bleiben).
- Genutzte Felder aus `data_day`: `time[]`, `temperature_max[]`, `temperature_min[]`, `precipitation_probability[]`, `pictocode[]`, `cloudcover_total[]`.
- `lat/lon` aus Shortcode-Attribut **oder** Post-Meta `lat`/`lon` des Spots.

## 3. 🟢 Caching-Strategie (genau das „kosteneffizient", das Anton will)
- **24-Stunden-Cache** pro Standort (`set_transient(..., DAY_IN_SECONDS)`).
- **Koordinaten auf 2 Nachkommastellen gerundet** (~1 km Raster) → mehrere nahe Spots **teilen sich einen Cache-Eintrag**. Cache-Key = `md5("$lat,$lon")`.
- **Fehler-Cache 10 Min** (`_err`-Transient): bei API-Fehler/keine Daten nicht bei jedem Pageview neu anfragen.
- → Ergebnis: pro ~1km-Zelle max. 1 API-Call/Tag. Sehr günstig.

## 4. Anzeige-Logik
- Filtert vergangene Tage (`$dt_date < heute` → skip), zählt bis gewünschte Tagesanzahl.
- Wochentag lokalisiert (`Mo/Di…` bzw. `Mon/Tue…`).
- `pictocode` → SVG-Icon-Map (sun/partly/cloud/fog/rain/showers/storm/snow/sleet).
- **Eigene Wetter-Heuristik** überschreibt pictocode: <10% Regen & <30% Wolken → Sonne; <10% Regen & ≥30% Wolken → bewölkt; leichte Regen-Codes mit <15% → bewölkt. (Macht die Icons „optimistischer"/sauberer.)
- Heute = `class="is-today"` (rote Umrandung, vgl. Screenshot).
- Pro Tag: Wochentag · SVG-Icon · `max° min°` · 💧 `precipitation_probability %`.

## 5. 🔴 Konsequenzen / Verbesserungen fürs Neubau
1. **API-Key raus aus dem Code** (`MNcAqmyPi3JrFdD0` steht im Klartext) → in Server-ENV, Calls nur serverseitig.
2. **Caching-Konzept übernehmen** (24h, ~1km-Raster-Key, Fehler-Backoff) — exzellent. In Next.js: Cache in Supabase-Tabelle `weather_cache(grid_key, payload, fetched_at)` **oder** Vercel KV/Edge-Cache. Refresh per Cron (täglich) oder stale-while-revalidate beim Request.
3. **Pictocode-Heuristik** als wiederverwendbare Funktion übernehmen (gleiches Icon-Mapping).
4. Wetter nur bei `type=activity` (Food zeigt keins) — Block bedingt rendern.
5. 4 Shortcode-Varianten → **eine** responsive React-Komponente `<SpotWeather lat lon lang />`, Icons als SVG-Set.

## 6. Bestätigte Design-Details
- Icons sind **Inline-SVG** (kein Icon-Font, kein externes Wetter-Bild) → schnell, gut fürs iOS-Look.
- Mobile: horizontaler Drag-Scroll-Strip der Tageskarten.
