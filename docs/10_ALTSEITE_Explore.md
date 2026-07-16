# Alt-Code-Analyse #1 — Explore-Seite (Datenbank + Karussells + Karte + Pro-Card)

Quelle: `Salzburg_Datenbank+Karte+Karussells_v17_ohne_Beschriftungen.html` (WordPress/PHP-Shortcodes, ~1181 Zeilen).
Stand: 2026-06-21.

Die Datei enthält **4 Bausteine**: (1) zentrale Spot-Datenbank, (2) Karussell-Shortcode, (3) Mapbox-Karten-Shortcode, (4) Pro-Promo-Card.

---

## 1. Datenmodell — "Single Source of Truth" (`sg_get_global_spots()`)

Aktuell **76 Spots** (36 Free, 40 Pro; davon 12 Food-Spots, alle Free). Ein PHP-Array, manuell gepflegt, gruppiert nach Kategorie-Kommentaren, **innerhalb der Gruppe nach Analytics-Leistung sortiert** (stärkster oben, schwache/Pro unten).

**Felder pro Spot:**
| Feld | Typ | Bedeutung |
|---|---|---|
| `lat`, `lng` | float | Geo-Koordinaten (Marker auf Karte) |
| `isPro` | bool | Pro-Spot (gesperrt für Free-User) |
| `emoji` | string | Marker-Emoji (💧🌊🥾📸🏰🌳🌸⛴️☕️🍽️🍕🌭🍜🍣🚗) |
| `image` | URL | Vorschaubild (.webp, von wp-content/uploads) |
| `title_de`, `title_en` | string | Titel je Sprache |
| `desc_de`, `desc_en` | string | Kurzbeschreibung je Sprache (1 Zeile, "Apple/SalzGuide-DNA") |
| `link_de`, `link_en` | URL-Pfad | Link zur Unterseite je Sprache |
| `cats` | array | Kategorie-Kürzel → steuert in welchen Karussells/Filtern der Spot erscheint |
| `loc` | enum | KI-Guide-Tag: `stadt` \| `seen` \| `berge` (leer = nicht im KI-Guide) |
| `kids` | bool | kinderfreundlich (KI-Guide) |
| `bus` | bool | öffi-tauglich (KI-Guide) |
| `vibes` | array | Subset von `['wandern','wasser','sightseeing']` (KI-Guide) |

**Wichtig:** Ein Spot kann in **mehreren** `cats` sein (z.B. `['lakes','hike-hard']`). Die Karussell-Zuordnung läuft NUR über `cats`, nicht über den Gruppen-Kommentar.

### Kategorien (Karussell-Titel de/en)
- `favs` → Favoriten unserer Community ❤️ / Community Favorites ❤️
- `hike-ez` → Wanderungen – Leicht & Mittel / Hikes – Easy & Medium
- `lakes` → Seen & Stege / Lakes & Piers
- `food` → Food Spots / Food Spots
- `hills` → City & Nearby Hills (de+en gleich)
- `gorges` → Klammen & Wasserfälle / Gorges & Waterfalls
- `roads` → Panoramastraßen / Scenic Roads
- `hike-hard` → Wanderungen – Anspruchsvoll / Hikes – Challenging
- `som` → **versteckte** Kategorie "Sound of Music" (nur via `custom_title`-Trick, nicht im Standard-Set)

> Mechanik der versteckten Kategorie: Shortcode `[salzguide_collections cats="som" custom_title="Sound of Music"]` überschreibt das Kategorien-Set für diesen einen Aufruf. → Im Neubau sauber lösbar über echte Collections/Tags in der DB.

---

## 2. Karussells (`[salzguide_collections]`)

- Pro Kategorie ein horizontales Scroll-Karussell. Mobile: Karten `76vw` (max 320px); Desktop: 280–320px feste Breite mit Pfeil-Buttons.
- Karte = Bild (4:3, `padding-bottom:75%`), Titel (h3), Kurzbeschreibung (p). Bild `border-radius:16px`.
- **Desktop Drag-to-Scroll** (Pointer-Events, Click-Suppression nach Drag), Touch nutzt natives Scrolling. Scroll-Snap.
- **Pro-Gating (rein clientseitig!):**
  - `body.logged-in` Klasse steuert Sichtbarkeit.
  - Pro-Spot + ausgeloggt → Badge "🤫 Geheimtipp/Secret Spot", **Titel mit CSS-Blur** maskiert, Link → Membership-Join-Seite statt Spot-Unterseite.
  - Bild zusätzlich leicht geblurrt + abgedunkelt.
- Farben: Titeltext `#111`, Beschreibung `#6C5B57` (warmes Braun), Akzent/Buttons `#cc2924` (SalzGuide-Rot).

---

## 3. Interaktive Karte (`[salzguide_map]`)

- **Mapbox GL JS v3.3.0**, Style `mapbox/outdoors-v12`, Token im Code (public pk-Token).
- Start-Center ~Pongau, Zoom 9.6; `fitBounds` auf alle Spots; `cooperativeGestures:true`.
- Controls: Navigation, Geolocate (User-Position), Custom "Center/Fit-Bounds"-Button, kompakte Attribution.
- Marker = Kreis mit Emoji. Pro + ausgeloggt → Marker zeigt 🤫.
- **Popups:** Bild + Titel + Beschreibung + CTA-Button.
  - Free/eingeloggt: echter Titel/Beschreibung + "Mehr Infos"-Link zur Unterseite.
  - Pro + ausgeloggt: **rotierende Teaser-Texte** (4 Varianten de/en, fix per Index gewählt) + Join-CTA, Bild geblurrt.
- **Anti-Leak-Trick (ausgeloggt):** ALLE Mapbox-Label-Layer werden ausgeblendet, NUR Ortsnamen (settlement/state/country) bleiben — damit Karten-Labels keine Pro-Spot-Namen (Gipfel, Seen, Wasserfälle) verraten. Eingeloggt: volle Labels.
- **Apple-Style Fullscreen-Toggle:** Blur-Overlay + Spinner beim Vergrößern/Schließen, `position:fixed` Vollbild, `body.sg-map-aktiv{overflow:hidden}`.

---

## 4. Pro-Promo-Card (`.sb-pro`)

Große anklickbare Card (bg-Image + dunkler Gradient-Overlay + "Pro"-Label + Titel/Sub/CTA-Pill mit Pfeil). Scroll-in-Animation via IntersectionObserver, `prefers-reduced-motion` respektiert. Link → Membership-Seite.

---

## 5. Wichtige Erkenntnisse fürs Neubau (Architektur-Konsequenzen)

1. **Datenmodell ist gut durchdacht** → 1:1 in DB-Tabelle `spots` überführen. Alle Felder (inkl. KI-Tags `loc/kids/bus/vibes`) übernehmen. `cats`/`vibes` als Relationen/Arrays.
2. **🔴 Sicherheitsproblem:** Pro-Gating ist rein clientseitig — Pro-Spot-Daten, echte Links & Bilder stehen im HTML/JS und sind nur per CSS-Blur „versteckt". **Im Neubau: Pro-Inhalte serverseitig gaten** — Free-Clients bekommen für Pro-Spots nur Teaser-Daten (kein echter Titel/Link/Detailbild). Der clevere „Anti-Leak"-Map-Trick wird damit überflüssig (bzw. bleibt als netter Bonus).
3. **i18n aktuell nur de/en, hartcodiert** (2 Felder pro Spot). Neubau braucht **skalierbare Mehrsprachigkeit** (eigene Übersetzungs-Tabelle pro Spot+Sprache, KI-generiert) für alle Tourismus-Sprachen.
4. **„Performance-Sortierung" manuell** aus Analytics → im Neubau optional automatisierbar (Sortierwert pro Spot, evtl. aus eigenen Analytics gespeist).
5. **Collections/Kategorien** sauber modellieren (echte Tags statt `custom_title`-Hack), inkl. „versteckter"/kuratierter Reihen wie „Sound of Music".
6. **Mapbox** ist bewährt und gut gestylt → im Neubau weiter Mapbox GL JS (Token domain-restricten, in ENV). Marker/Popup/Fullscreen-UX übernehmen.
7. **Design-Tokens** zum Mitnehmen: Akzent-Rot `#cc2924`, Text `#111`, Sekundärtext `#6C5B57`, Radius 16–22px, Font Inter/SF, viele `backdrop-filter`-Blur-Glas-Effekte (passt zu iOS-2026-Look).
8. **Free/Pro-Verhältnis heute:** 36 Free / 40 Pro (Briefing-Ziel: ~20–30 Free / ~30–40 Pro → grob passend, ggf. Free leicht reduzieren).

---

## 6. Offene Fragen an Anton (Explore)
- [ ] Sollen die **Kategorie-Reihen** im Neubau identisch bleiben (favs, hike-ez, lakes, food, hills, gorges, roads, hike-hard + som)?
- [ ] Automatische **Performance-Sortierung** gewünscht, oder weiter manuell pinnen?
- [ ] Mapbox beibehalten (vs. Alternative)? — Empfehlung: beibehalten.
