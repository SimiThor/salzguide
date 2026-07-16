# Alt-Analyse #17 — Audio-Tour „nookmate" (quasi fertig entwickelt)

Quelle: `nookmate_salzburg_v1…freitext.html` (3820 Z., 250 KB). Stand: 2026-06-21.

---

## 0. ⚠️ Branding-Vorgabe (Anton)
- **„nookmate" ist nur der interne Arbeitstitel** des Prototyps — **NICHT** als Logo, Schriftzug oder Name verwenden. Das Feature läuft komplett unter **SalzGuide**-Branding.
- **Farben aus dem Code NICHT übernehmen** — die nookmate-Demo nutzt eigene Farben/Branding. Im Neubau alles in den **SalzGuide-Farben** (Rot `#cc2924`, Creme-BG, Design-System der Plattform).
- Gilt analog für alle übernommenen Prototypen: nur Funktion/Logik übernehmen, **Optik = SalzGuide**.

## 1. Was es ist
Eine **KI-kuratierte, selbstgeführte Audio-Walking-Tour** durch Salzburg. User sagt per **Freitext oder Sprache** „was er sehen will" → die KI **baut aus einem Spot-Pool eine personalisierte Route** mit **Audio-Narration an jeder Station**. Mapbox-Karte mit Stops, Audio-Player, Spot-Sheets mit Galerien, Google-Maps-Button, DE/EN-Übersetzung, Guide-Persona (Avatar, „Guide seit 2021").
Subtitle: *„Sag mir, was du sehen willst – ich bau dir die Tour."*

## 2. Datenstruktur (im File)
- **Tour** = `startSpot` + `endSpot` + **`spots`-Pool** („NUR diese sieht die KI") + **`customConnections`** (Routen-Geometrie zwischen bestimmten Stops, z.B. Festungsbahn, mit `duration`).
- **Pro Stop:** `id, lat, lng, emoji, title{de,en}, desc{de,en}, aiTags (z.B. „must-see, fotospot, dom, altstadt"), mustSee, image, audioSrc{de,en} (MP3-URL), audioText{de,en} (Transkript)`.
- **Audio = vorproduzierte MP3** pro Stop pro Sprache (auf salzguide.com gehostet; im Demo teils Platzhalter). `audioText` = Transkript (Basis für TTS/Übersetzung).
- Mapbox v3.3.0, gleiche Map-Optik/Fullscreen wie Explore.

## 3. Bezug zum bestehenden System
- Stops sind faktisch **Spots mit Audio** — viele überschneiden sich mit der Spot-DB (Dom, Mirabellgarten, Ma Makers, Steingasse …).
- KI-Tour-Builder = Verwandter der **KI-Spot-Suche** (Doc 16), nur Output = **geordnete Route mit Audio** statt Karten-Liste. Voice/Freitext wie dort.

## 4. Integration in neue Architektur
1. **Spot-Felder ergänzen:** `audio_url` + `audio_text` **je Sprache**, plus `ai_tags`/`must_see` (oder vorhandene `vibes`/Tags nutzen). → Ein Stop ist ein Spot mit Audio, keine doppelte Datenhaltung.
2. **Tour-Subsystem:** `tours` (start/end, Pool-Referenzen, Metadaten) + `tour_stops` (Pool/Reihenfolge) + `tour_connections` (Routen-Segmente wie Festungsbahn). Schlank halten.
3. **KI-Tour-Builder** = Modus/Tool der vereinten KI „Anton": Tool `build_audio_tour(wish)` → wählt Stops aus Pool, ordnet sie zu einer sinnvollen Geh-Route (ORS `foot-walking`), gibt Stationen + Audio zurück. Reuse: Matching/Anti-Halluzination (Doc 16), Voice (STT), `<SpotMap>` + Routen.
4. **🟢 TTS-Pipeline (Audio erzeugen):** `audio_text` entsteht per **Brand-Voice-KI** (Doc 27, Audioguide-Variante) → **TTS** (z.B. ElevenLabs / OpenAI TTS) → **MP3** in Storage (Medien-Pipeline, Doc 28). Mehrsprachig: Text übersetzen → TTS je Sprache. → Audio-Erstellung wird **easy** (kein manuelles Einsprechen), passt zum „einfach anlegen"-Prinzip.
5. **Audio-Player-Komponente** + Walking-Route-Karte (Reuse `<SpotMap>`).
6. **Monetarisierung:** Audio-Touren als **Pro-Feature** denkbar (weiterer Conversion-Hebel) — oder Gratis-Teaser-Tour + Pro-Vollzugang.

## 5. Architektur-Auswirkung (zusammengefasst)
- Spot-Modell: + `audio_url`, `audio_text` (je Sprache), `must_see`/Tags.
- Neues schlankes **Tour-Subsystem** (tours/tour_stops/connections).
- **TTS** als neuer externer Dienst (ElevenLabs/OpenAI) → Audio-Generierung im Admin, in Medien-Pipeline.
- KI-Tour-Builder = Tool der „Anton"-KI (kein separater Bot).
- **Launch-Status:** quasi fertig, aber eigenständig — Architektur **reserviert Platz**; Rollout-Timing offen (wie Video-Maker).

## 6. Offene Fragen an Anton (Audio-Tour)
- [ ] Mit neuer Plattform **live**, oder später? (Platz wird reserviert.)
- [ ] Audio künftig **per TTS** (KI-Stimme, skaliert auf alle Spots/Sprachen) — oder **selbst eingesprochen** (authentischer, aber aufwändig)? Empfehlung: TTS als Standard, optional selbst.
- [ ] Audio-Tour **Gratis oder Pro** (Conversion)?
- [ ] Nur **Stadt Salzburg** oder mehrere Tour-Regionen?
