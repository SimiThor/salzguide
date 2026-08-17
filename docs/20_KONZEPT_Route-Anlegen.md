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
- Bonus aus der Antwort: **Distanz + Höhenreihe** werden mitgeliefert → Quick-Facts **automatisch vorbefüllen** (Distanz, ↑Hm) und eine **Gehzeit-Schätzung** für das „⏳ Dauer"-Fact vorschlagen. Die Formel dafür steht in Abschnitt 7; ORS' eigene `duration` wird bewusst NICHT benutzt, sie rechnet Berge zu schwach ein.

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

## 7. Die Gehzeit-Formel (2026-08-17, nach Gast-Rückmeldung korrigiert)

Ein Gast hat gemeldet, dass die Zeiten unrealistisch lang sind: Gamskarkogel 13,5 Stunden,
Schafberg über 10. Er war selbst am Schafberg und hat mit langer Gipfelpause knapp unter 6
Stunden gebraucht. Nachgemessen: Die App lag auf **allen 48 Routen-Spots** 50 bis 70 Prozent
über den veröffentlichten Tourenzeiten.

**Die Rohdaten waren nicht schuld.** Schafberg gemessen 15,6 km / 1253 hm gegen 16 km /
1220 hm in der Referenz. Es war die Formel.

Was falsch war, in der Reihenfolge des Gewichts:

1. **DIN 33466 / DAV** (300 Hm/h auf, 500 Hm/h ab) ist die konservative Fassung. Die
   österreichischen Portale und die Wegweiser entsprechen den **SAC-Werten**.
2. **Pausen-Puffer von 10 min je Stunde, ungedeckelt.** Er wuchs linear mit und schlug der
   13-Stunden-Tour fast zwei Stunden reine Pause auf.
3. **Zwei Quellen für die Höhenmeter**: Der Admin nahm die rohen ORS-Summen
   (`props.ascent`), die Import-Skripte die 3-m-gefilterte `ascentDescent`. Dieselbe Route,
   zwei Ergebnisse.

**Jetzt gilt** (`hikingTimeMinutes` in `src/lib/geo.ts`, die EINE Quelle):

- 4 km/h eben, **400 Hm/h im Aufstieg, 800 Hm/h im Abstieg** (SAC)
- Überlagerung: die grössere Teilzeit voll, die kleinere zur Hälfte
- darauf **10 % Pause, höchstens 30 Minuten** — gedeckelt, damit der Fehler von oben nicht
  in anderer Form zurückkommt
- Höhenmeter immer über `ascentDescent` (3-m-Schwelle gegen Höhen-Rauschen), im Admin wie im Import

Ergebnis gegen die veröffentlichten Zeiten: Schafberg 7 statt 10 Std (Referenz ~6–6,5),
Gamskarkogel 9 statt 13,5 (Referenz 8). Wir liegen bewusst 10 bis 20 Prozent über den
Portalen — das ist der Unterschied zwischen „durchgehen" und „mit Pausen ankommen".

**Nachgeprüft wird das maschinell**, nicht durch Hinschauen:

| Befehl | prüft |
|---|---|
| `npm run hiking:check` | Formel gegen fünf veröffentlichte Referenztouren (Quellen stehen im Skript, Toleranz 25 %) **und** den Sprach-Parser gegen 90 echte Sätze aus dem Bestand |
| `npm run wp:hiking-times` | rechnet den Bestand nach (Dauer + Schwierigkeit), trocken; `-- --go` schreibt |
| `npm run wp:audit` | Dauer UND Schwierigkeit in den Fliesstexten gegen das Feld, in **allen 13 Sprachen** (`facts-in-text.ts`) |
| `npm run wp:fix-hiking-texts` | zieht die Sätze nach, wenn sich Dauer oder Stufe ändert |

**Die Regel, auf der der Dauer-Abgleich steht:** Bei einer Tour **ab einer Stunde** ist das
Feld die Dauer der GANZEN Tour, und dann kann kein Teilstück länger sein als das Ganze. Jede
Zeit über dem Feld ist dort ein Fund, auch wenn woanders im Text eine passende Zahl steht.

**Unter einer Stunde gilt sie nicht**, und das ist kein Nachlassen: Dort ist das Feld der
WEG, nicht der Besuch, und die Texte sagen das ausdrücklich dazu („Zehn Minuten braucht der
Weg durch die Gassen, ein bis zwei Stunden brauchst du, wenn du dich treiben lässt"). Die
längere Zahl ist da richtig. Gemeldet wird dort nur, wenn KEINE Zahl im Text zum Feld passt.

**Die Toleranz hängt an der Grössenordnung**, weil die Dauer so geschrieben wird: unter einer
Stunde in Fünf-Minuten-Schritten, darüber in halben Stunden. Vier Minuten unter der Stunde,
fünfzehn darüber. Vorher stand dort pauschal 0,35 Std, und bei einem Feld von 35 Minuten galt
damit alles zwischen 14 und 56 Minuten als richtig.

**Und der Audit fragt zusätzlich, ob jede Sprache die Dauer überhaupt NENNT.** Diese Frage
stellt der Widerspruchs-Teil nicht, denn ein Text darf schweigen. Findet der Parser in einer
Sprache aber gar nichts, meldet er dort auch nie einen Widerspruch, und eine falsche Zahl
kann beliebig lange stehen bleiben. Genau so haben „a good hour", „一个多小时",
„dvadsaťpäť minút", „un'oretta abbondante" und das französische „1h30" drei Durchgänge
überlebt: nicht weil sie richtig waren, sondern weil niemand hinsah.

Zahlen UNTER dem Feld bleiben still, weil man sie nicht von Teilzeiten unterscheiden kann.
Ab 60 Prozent des Feldwerts landen sie unter NACHSCHLAGEN, damit auch die gefährlichere
Richtung sichtbar bleibt.

**Die Schwierigkeit wird am Satzanfang gelesen.** Die Einstufung eröffnet in diesen Texten
immer ihren Satz („Mittelschwer: markiert und ...", „Dificultad alta: ..."). Mitten im Satz
stehen dieselben Wörter in anderer Bedeutung: das spanische „y media" ist die halbe Stunde,
„technisch einfach" beschreibt das Gelände und nicht die Stufe, und „Hardly anyone" fängt nur
zufällig mit „hard" an. Spannen („Leicht bis mittel", „Facile à moyen") werden als beide
Stufen gelesen.

Sechs Fehler, die genau hier schon gesessen haben und die jetzt als Testfälle in
`hiking:check` liegen:

- **Zwei Toleranzen für dieselbe Frage.** Die Widerspruchs-Schwelle hatte einen zusätzlichen
  absoluten Zuschlag, den die Treffer-Prüfung nicht kannte. In dem Band dazwischen sassen
  elf Spots mit ihrer alten Zahl (Feld 1 Std, Text „anderthalb Stunden"), und der Lauf meldete
  null. Ein Prüfer, der nichts findet, ist erst dann ein gutes Zeichen, wenn er beweisbar
  hinschaut.
- **Eine passende Zahl deckt eine falsche zu.** Die Sigmund-Thun-Klamm nannte im ersten Satz
  die alte Gesamtdauer und im zweiten eine Teilzeit. Weil die Teilzeit zum neuen Feld passte,
  galt der Spot als in Ordnung. Deshalb die Tour-Logik oben.
- **Wortgrenzen in Sprachen ohne Leerzeichen.** Eine pauschale CJK-Sperre nach links sollte
  verhindern, dass „열세 시간" (13) als „세 시간" (3) gelesen wird, verschluckte im
  Chinesischen aber jede Angabe, vor der ein Han-Zeichen steht („开车的话一小时"). Geblockt
  wird jetzt nur ein vorangehendes ZAHLZEICHEN derselben Sprache.
- **Ein Wort zwischen Zahl und Einheit.** Französisch („trois bonnes heures"), Deutsch („in
  einer knappen Stunde"), Englisch („a good hour", „a good hour and a half"), Niederländisch
  („een ruim uur") und die Trema-Formen („tweeënhalf") fielen alle durch. Vier französische
  Texte, der englische Nockstein und der Hochkeil-Spiegelsee standen deshalb nie auf der Liste.
- **Ein ganzer Grössenbereich ausgelassen.** Der Dauer-Abgleich begann bei einer Stunde, also
  waren vierzehn Wanderungen darunter nie geprüft. Aufgefallen ist es einem Menschen, der die
  Nonnberggasse aufgemacht hat: oben 35 Minuten, im Absatz darunter fünfzig.
- **Minuten nur als Ziffer.** „Fünfzig Minuten" fand der Parser in keiner Sprache. Selbst ohne
  die Sperre oben hätte er dort nichts gemeldet.

**Die Anzeige selbst gehört dazu.** Die Zahl geht durch `factDuration` in
`src/lib/facts-i18n.ts`, und die hat das Dezimalkomma lange pauschal durch einen Punkt
ersetzt, weil „international" mit „englisch" verwechselt wurde. Neun der dreizehn Sprachen
schreiben mit Komma; auf der polnischen Spot-Seite stand deshalb „5.5 h" im Faktenkasten und
„12,8 kilometra" im Satz darunter. Das Trennzeichen kommt jetzt aus `Intl`, wie im
Höhenprofil daneben. Geprüft wird es in `hiking:check` für alle dreizehn Sprachen.

**Wie die Texte in 13 Sprachen korrigiert wurden.** Nicht durch Zahlentausch: „Sechs Stunden"
wird auf Polnisch zu „Cztery i pół godziny", weil das Zahlwort den Fall des Substantivs
regiert. Je Sprache wurde formuliert und von einem zweiten, unabhängigen Leser Satz für Satz
abgenommen. Drei Stellen brauchten eine Entscheidung statt einer Ersetzung, und die steht auf
Deutsch in `fix-hiking-texts.ts`. Die wichtigste: Wenn die neue Gesamtdauer einen zweiten Satz
im selben Absatz sinnlos macht („ohne den See in einer knappen Stunde", während die ganze
Runde jetzt eine Stunde dauert), kommt dort KEINE geschätzte Zahl hin, sondern gar keine.

Die Dauer steht ausserdem im **Intro-Video** (Titelbild) und deshalb seit dieser Änderung im
`introSourceHash`. Ändert sich die Dauer, meldet der Admin „Intro veraltet".

Quellen: [openrouteservice.org/restrictions](https://openrouteservice.org/restrictions/), [openrouteservice.org/services](https://openrouteservice.org/services/), [Elevation/Altitude (ORS Forum)](https://ask.openrouteservice.org/t/how-to-get-the-api-to-return-altitude/3563), [SAC Marschzeitberechnung](https://www.sac-cas.ch/de/die-alpen/marschzeitberechnung-5310/), [Bergwelten Gamskarkogel](https://www.bergwelten.com/t/w/12754), [bergfex Schafbergspitze](https://www.bergfex.com/sommer/oberoesterreich/touren/wanderung/8804,schafbergspitze-am-wolfgangsee/)
