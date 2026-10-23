# 42 ROUTING: eigene Routen über BRouter

Stand 23.10.2026. **Die eine Quelle für alles, was SalzGuide routet**: Web und iOS-App,
Runden-Editor, eigene Runden, Navigation, Offline-Paket. docs/41 (6.3, 6.4) verweist für das
Routing hierher; docs/40 soll es noch tun.

**Gebaut (Branch `feat/routing-brouter`, Web-Seite):** Modul `src/lib/routing/*`, Migration
`0076_tour_nav_routes.sql`, `GET /api/app/v1/tours/{slug}/package`, `POST /api/app/v1/route`,
`snapTourRoute` im Admin auf BRouter, Prüfung `npm run routing:check`. Noch offen: die
Umstellung der Web-Navigation (Abschnitt 8, Schritt 6), eigene Runden (Schritt 5) und die
Folgearbeiten in Abschnitt 15.

## 0. Entscheidung in drei Sätzen

Mapbox Product Terms 2.10.1 verbieten, Ergebnisse von Directions, Optimization und Map
Matching zu speichern (Notiz `mapbox-routen-nicht-speichern`). Deshalb kommen Linie und
Abbiegeschritte aus **unserem eigenen BRouter** (MIT-Lizenz, OpenStreetMap-Daten) auf
Antons Geo-Server, den SalzGuide mit Kraxelbande teilt, mit eigenem Token je Projekt.
Mapbox bleibt nur für die Kartenanzeige (Web: mapbox-gl, App: Maps SDK mit TileStore).

## 1. Was heute wo routet

| Stelle | Dienst | Gespeichert? | Urteil |
|---|---|---|---|
| `snapTourRoute` (tour-actions.ts), Runden-Editor | Mapbox Directions | ja, `tours.route_geo` | verboten, umstellen |
| `optimizeLoop` (tour-generate.ts), eigene Runden | Mapbox Optimization | ja, `user_tours.route_geo` | verboten, umstellen |
| `fetchBikeRoute` (bike-directions.ts), Web-Navigation | **BRouter** über `POST /api/tours/[slug]/route` (umgestellt 23.10., ein System) | nein | erledigt, Mapbox-Directions-Aufruf entfernt (Abschnitt 8.3) |
| `scripts/seed-runde-a.ts` | Mapbox Directions (Einmalskript) | ja, `route_geo` | **bleibt offen**: schreibt Mapbox-Linien nach `tours.route_geo`; nicht mehr ausführen, bis es auf das Routing-Modul (`snapTourRouteCore`) umgestellt ist |
| `snapRoute` (admin-actions.ts), `wp:routes` | openrouteservice foot-hiking | ja, Spot-Routen | **eigene Frage**, siehe Abschnitt 13 |

Stand der Daten am 23.10.: 2 Runden (beide veröffentlicht, beide Pro) und 5 eigene Runden
tragen eine gespeicherte Mapbox-Linie.

## 2. Architektur

```
Admin-Editor ─┐                         ┌─ Web-Navigation (/api/tours/[slug]/route)
Eigene Runden ┼─ getRoutingProvider() ──┤
Offline-Paket ┘   (server-only)         └─ App-Umrouten (/api/app/v1/route)
                       │
                BrouterProvider ── HTTPS + Bearer ──> Caddy (/routing) ──> BRouter
                LocalRoutingProvider (Testadapter, nie in Produktion)
```

Dateien (`src/lib/routing/`):

| Datei | Inhalt | `server-only` |
|---|---|---|
| `types.ts` | `NormalizedRoute`, `RouteStep`, `RoutingProvider`, `RoutingError` (mit `code`), Grenzen, `toNavSteps()` | **nein**: Web-Client und Swift-Port brauchen `toNavSteps` |
| `normalize.ts` | für jeden Anbieter gleich: Linie säubern, Strecke, Eingabepunkte auf die Linie legen, Kurse, `arrive`, `lineHash` | ja |
| `brouter.ts` | Abruf, Abbildung der BRouter-Hinweise, `parseBrouterGeojson()` (rein, testbar) | ja |
| `local.ts` | Testadapter: gerade Linien, Manöver an jedem Knick | ja |
| `index.ts` | `getRoutingProvider()` | ja |

Regeln:
- **Nur zwei Einstellungen:** `ROUTING_URL` (z. B. `https://<geo-host>/routing`) und
  `ROUTING_TOKEN`. Ohne `ROUTING_URL` gilt der Testadapter, in Produktion
  (`VERCEL_ENV`/`NODE_ENV` = production) gibt es stattdessen `RoutingError("config")`,
  nie still erfundene Linien.
- **Nur der Server fragt den Geo-Server.** Browser und App fragen unseren Server. Kein
  Token im Client, keine CORS-Freigabe am Geo-Server (Caddyfile von Kraxelbande).
- `types.ts` importiert nichts Server-Seitiges (Memory: Typ-Import einer server-only-Datei
  in einer Client-Komponente kippt alle Seiten, tsc bleibt grün).
- Ein Anbieterwechsel ist eine neue Adapter-Datei; Datenmodell, Navigation und App bleiben.
- Die öffentliche Instanz brouter.de ist kein Ziel für den Betrieb (keine Bedingungen,
  protokolliert Koordinaten).

## 3. Profile je Fortbewegung (`tours.mode`)

| `mode` | Profil | Liegt schon auf dem Server? |
|---|---|---|
| `bike` | `trekking` | ja (`segmente-laden.sh` lädt `trekking.brf`) |
| `walk` | `hiking-mountain` | ja (Kraxelbande nutzt es selbst) |

Gemessen am 23.10.2026 mit BRouter 1.7.10, Wegdaten `E10_N45.rd5` vom 23.10., gegen die
gespeicherte Mapbox-Linie (`npm run routing:compare -- --profiles=all --mapbox`).
"Nah" = Anteil der Linie, der höchstens 15 m von der anderen entfernt liegt, in beide
Richtungen.

**Rad (Tour 2, 6 Stopps, 6 Wegpunkte, Kette = gespeicherter `route_hash`):**

| Profil | Länge gegen Mapbox | Hausdorff | Mittel | nah | Hauptstrasse | Treppen |
|---|---|---|---|---|---|---|
| **trekking** | -446 m (-5 %) | 167 m | 17 m | 82 % / 77 % | 617 m (8 %) | 0 |
| fastbike | -401 m (-5 %) | 194 m | 20 m | 81 % / 75 % | 1769 m (22 %) | 0 |
| safety | -75 m (-1 %) | 168 m | 24 m | 72 % / 67 % | 48 m (1 %) | 0 |

`trekking`: am nächsten an der Linie, die Anton abgefahren hat, keine Treppen, 39 %
Radweg, Fussgängerzone nur, wo Rad frei ist (181 m). `fastbike` schickt ein Viertel über
Hauptstrassen. `safety` meidet Hauptstrassen fast ganz, weicht aber auf 2,3 km von der
abgefahrenen Linie ab; Alternative, falls Anton ruhigere Wege will (dann
`safety.brf` in `segmente-laden.sh` ergänzen).

**Zu Fuss (Tour 1, 14 Stopps):** Die gespeicherte Linie stammt aus einem älteren Stand
(`route_hash` passt nicht mehr zur Kette), deshalb zusätzlich gegen Mapbox live.

| Profil | gegen gespeichert | gegen Mapbox live (6,01 km) | Hauptstrasse | Treppen |
|---|---|---|---|---|
| **hiking-mountain** | -322 m, nah 87 % / 80 % | -756 m (-13 %), nah 82 % / 69 % | 0 | 283 m |
| shortest | -402 m, nah 92 % / 87 % | -836 m (-14 %), nah 87 % / 76 % | 206 m | 303 m |

`hiking-mountain`: keine Hauptstrasse, Pfade und Gassen bevorzugt, liegt schon auf dem
Server. `shortest` liegt etwas näher an Mapbox, nimmt dafür Hauptstrassen und fehlt auf dem
Server. Die 756 m Unterschied zu Mapbox live muss Anton auf der Karte ansehen (offene
Frage 1); Treppen sind zu Fuss gewollt (docs/40).

Laufzeit: 220 bis 310 ms je ganzer Runde (lokal, Mac). Die Profile laufen ohne eigene
Parameter; Kraxelbande-artige Zusätze (`profile:...` in der Anfrage) sind möglich, ohne
den Server anzufassen.

## 4. Was gespeichert wird, was nie

**Gespeichert (gehört uns):** `NormalizedRoute`, Version `v: 1`, nur additiv änderbar.

| Feld | Bedeutung |
|---|---|
| `geometry` | `[lng, lat][]`, doppelte Punkte entfernt, höchstens 10 000 Punkte |
| `steps` | `RouteStep[]` (Abschnitt 5), sprachneutral, ohne Text |
| `waypointAlongM` | je Kettenpunkt seine Stelle auf der Linie (Stopps, Wegpunkte, Ziel) |
| `distanceM`, `durationS`, `ascentM` | Länge aus unserer Linie (Haversine wie `geo.ts`); Dauer und Anstieg laut Dienst, nur als Auskunft |
| `lineHash` | SHA-256 über die Geometrie: Schritte und Stellen gelten nur für genau diese Linie |
| `source` | `provider` ("brouter"), `profile`, `engine` ("BRouter-1.7.10"), `data` ("OpenStreetMap (ODbL)"), `attribution`, `computedAt` |

`alongM` (je Punkt) wird mitgerechnet, aber nicht gespeichert; es folgt aus `geometry`.

**Nie gespeichert:** das GeoJSON von BRouter, die Roh-Hinweise (`voicehints`), die
Abschnittsmerkmale (`messages`), `cost`, `times`, Anbieter-Kennungen, und nichts von
Mapbox Directions oder Optimization.

**Ort (Migration `0076_tour_nav_routes.sql`, gebaut):**
- `tours.route_geo` bleibt die Linie (Karte, Vorschau), jetzt aus BRouter (`snapTourRoute`).
- Neue Tabelle `tour_nav_routes` (ersetzt die Fassung aus docs/41 6.3): `id`, `tour_id`
  (Fremdschlüssel, `on delete cascade`), `lang`, `route_hash` (= `tourRouteHash` der Kette,
  wie `tours.route_hash`), `profile`, `source` (jsonb: Anbieter, Profil, Engine, Datenquelle,
  Attribution, Zeitpunkt), `geometry` (jsonb), `steps` (jsonb), `via_along` (jsonb:
  `{ stopAlongM, viaAlongM }`), `length_m`, `created_at`; eindeutig `(tour_id, lang, route_hash)`.
  **`lang` steht immer auf `'und'`:** Die Schritte haben keinen Text mehr, eine Zeile gilt für
  alle 13 Sprachen; die Spalte bleibt im Schlüssel, damit eine Fassung mit Text später keine
  Migration braucht. RLS an, **keine** Richtlinie, Rechte für anon/authenticated entzogen:
  ausgeliefert wird nur über das Paket, mit der Sicht des Betrachters.
- Geschrieben wird **beim ersten Paket-Abruf** (und wieder, wenn sich `route_hash` ändert; die
  alte Zeile wird dann entfernt), nicht beim Speichern der Runde. Die Kette ist dieselbe wie
  in der Editor-Vorschau (`buildTourChain`, ab Tour-Start), die Linie also dieselbe wie
  `tours.route_geo`. Die wöchentlich frischen Wegdaten ändern gespeicherte Routen NICHT still.
  Zeilen des Testadapters werden nie geschrieben und nie gelesen. Vor Migration 0076 rechnet
  der Server bei jedem Abruf neu (Meldung `server_error`, Gruppe `nav-routes-missing`).
- OSM-Daten liegen damit in eigener Tabelle, getrennt von Texten (Kraxelbande docs/13 12.5).

**Dauer und Länge (entschieden, gebaut):** Angezeigt werden die Werte, die der Admin gesetzt hat
(`tours.duration_min`, `tours.distance_km`), auf der Tour-Seite wie in der App
(`tour.durationMin`, `tour.distanceKm`). `snapTourRoute` überschreibt sie nie still: Es füllt ein
LEERES Feld oder eines, das noch den letzten Maschinenwert trägt (`adopt()` im Formular, die
bisherige Regel), und die Meldung nennt die neu berechneten Zahlen ("neu berechnet: X km, Y Min")
und sagt, ob sie übernommen wurden. Die Zahl dafür ist NICHT die BRouter-Zeit (Rad `trekking`
rechnet 23 min für 7,85 km, also gut 20 km/h): Länge durch das Tempo der Navigation
(`FALLBACK_SPEED_MPS` in `nav-format.ts`, die eine Tempotabelle: Rad 12 km/h, zu Fuss 4,5 km/h)
plus Zuschlag je Stopp (zu Fuss 2 min, am Rad 1 min), Code `tourDurationMin()` in
`routing/chain.ts`. `route.durationMin` im Paket und beim Umrouten kommt aus derselben Formel
und dient NUR der Ankunftszeit in der Navigation, nie der Anzeige der Runde.

## 5. Abbiegehinweise: BRouter -> `stepNav`

BRouter liefert mit `timode=2` je Hinweis `[index, befehl, ausfahrt, abstand, winkel]`
(Winkel negativ = links; Befehle aus `btools.router.VoiceHint`, in 1.7.10 gegengelesen).
Abgebildet wird auf **denselben Wortschatz wie bisher**, weil `isMereCurve`,
`prepareSteps`, `maneuverArrowDeg` und `ManeuverBanner` genau diese Wörter lesen:

| BRouter | `type` / `modifier` |
|---|---|
| C (1) geradeaus | `continue` / `straight` (fällt in `isMereCurve` weg) |
| TL (2), TR (5) | `turn` / `left`, `right` |
| TSLL (3), TSLR (6) | unter 35 Grad `fork` / `slight left|right` (halten), sonst `turn` / `slight ...` |
| TSHL (4), TSHR (7) | `turn` / `sharp left|right` |
| KL (8), KR (9) | `fork` / `slight left|right`; unter 10 Grad `continue` / `straight` |
| TLU, TRU, TU (10, 11, 15) | `continue` / `uturn` |
| RNDB, RNLB (13, 14) | `roundabout`, `modifier` aus dem Winkel, `exit` = Ausfahrt |
| EL, ER (17, 18) | `off ramp` / `slight left|right` |
| OFFR (12), BL (16), END (100) | verworfen; BL (Luftlinie) wird als Warnung gemeldet |

Dazu, in dieser Reihenfolge:
1. **Dichte Hinweise zusammenfassen** (`mergeClose`, unter 15 m): rechts 87 Grad und drei
   Meter später links 86 Grad ist eine versetzte Querung, kein Doppelmanöver. Winkel werden
   summiert; bleibt unter 35 Grad übrig, ist es geradeaus. Zwei Abbiegungen in dieselbe
   Richtung werden nie zu "Wenden" (höchstens `sharp`). Kehren und Kreisverkehre bleiben
   einzeln.
2. **Kurse:** `bearingBefore` = Kurs der Linie auf den letzten 12 m vor dem Manöver,
   `bearingAfter` = `bearingBefore + Winkel des Dienstes`. So ergibt `turnAngle()` genau den
   Winkel, den BRouter mit Blick auf die Kreuzung misst.
3. **`alongM`** = Strecke bis zum Manöverpunkt auf UNSERER Linie, gleiche Haversine wie
   `nearestPointOnRoute`. `distanceM` = Strecke bis zum nächsten Schritt.
4. **Am Ende immer `arrive`** bei `alongM = distanceM` (wie Mapbox; `stepNav` und
   `ManeuverBanner` rechnen damit).
5. **Halte und Wegpunkte auf die Linie** (`waypointAlongM`): BRouter liefert keine
   `via_waypoints`. Jeder Punkt kommt an die erste Stelle nach dem vorigen, an der die
   Linie ihm auf 30 m nahekommt (dann das Minimum in den folgenden 150 m). So bleibt eine
   Rundtour (Ende am Start) und ein Stichweg richtig. Das ergibt `spotAlongM` und
   `viaAlongM` für `stepNav` und `selectNavVias`.
6. **`toNavSteps(steps, instructionFor)`** baut `RawStep` (Winkel aus den Kursen) und
   schickt sie durch das unveränderte `prepareSteps`.

**Texte** kommen aus den Sprachdateien, nicht vom Dienst: BRouter kennt keine
Strassennamen. Neue Schlüssel `Tours.maneuver.*` (links, rechts, leicht/scharf links/rechts,
links/rechts halten, geradeaus, wenden, Kreisverkehr mit `{exit}`, Ziel) in allen 13
Sprachen; in der App dieselben Schlüssel über das Strings-Skript. Bis dahin hat
`scripts/routing-drive.ts` deutsche Platzhalter.

**Kehren an Stopps und Wegpunkten:** Liegt ein Punkt neben dem Weg, den das Profil nimmt,
macht die Linie einen Stich hin und zurück (meist 2 bis 33 m, einmal 89 m). Mapbox tat an
denselben Stellen dasselbe (gespeicherte Linien: Wenden bei 1704, 2835, 3132, 3663 m auf
der Radrunde). `finishRoute` meldet jede solche Kehre als Warnung für den Admin ("Kehre an
Punkt 4: Punkt liegt neben dem Weg"); der Admin schiebt den Punkt auf den Weg.

**Fahrt durch den echten `stepNav`** (`npm run routing:drive -- --mapbox`, Kette ab
Tour-Start, Simulator `rideFixes` aus `scripts/lib/nav-cases.ts`, 1 Fix/s, Rad 5 m/s,
Fuss 1,4 m/s, je drei Fahrten: sauber, 6 m und 12 m seitliches Rauschen):

| | BRouter | Mapbox live |
|---|---|---|
| Rad: Ansagen nach `prepareSteps` | 53 auf 7,85 km | 45 auf 8,30 km |
| Rad: Stopps angeboten | 6/6 | 6/6 |
| Rad: Neuberechnung / Bitte umdrehen | 0 / 0 in allen Fahrten | 0 / 0 |
| Fuss: Ansagen | 54 auf 5,25 km | 86 auf 6,01 km |
| Fuss: Stopps angeboten (Vorlauf rund 60 m) | 14/14 | 14/14 |
| Fuss: Neuberechnung / Bitte umdrehen | 0 / 0, bei 12 m Rauschen 2 Fehlalarme "umdrehen" (einer an einer Kehre) | 0 / 0, bei 12 m Rauschen 1 an derselben Stelle (1,8 km) |
| Ziel gemeldet | ja, 17 bis 27 m vor dem Ende | ja |

Ohne Schritt 1 und die 10-Grad-Regel waren es 68 (Rad) und 91 (Fuss) Ansagen. Zwei Stopps
der Radrunde werden später angeboten als mit Mapbox (nach 115 m statt sofort am Start,
-11 statt +157 m), weil Abbiegungen in der Ruhezone (`MANEUVER_QUIET_M`, 140 m) liegen;
`SPOT_GRACE_M` fängt beide auf.

## 6. Fehler, Zeitlimits, Grenzen

| `RoutingError.code` | Auslöser | Admin sieht | Navigation (`BikeLegError`) |
|---|---|---|---|
| `config` | `ROUTING_URL` fehlt in Produktion | "Routendienst nicht eingerichtet" | `no-token` |
| `auth` | 401/403 vom Caddy | "Token prüfen" | `no-token` |
| `timeout`, `unreachable`, `bad-response` | Netz, Frist, Antwort kaputt oder zu gross | "gerade nicht erreichbar" | `network` (Wiederholung wie heute) |
| `no-route` | BRouter 400 (kein Weg, Punkt ausserhalb der Wegdaten) | "kein Weg zwischen diesen Punkten" | `no-route` |
| `invalid` | Grenzen unten | Satz aus der Prüfung | `no-route` |

- Fristen: Server zu BRouter 20 s (Editor, Speichern), 8 s beim Umrouten; Client wie heute
  15 s (`FETCH_TIMEOUT_MS`). Abbruch durch den Aufrufer (AbortSignal) wird nicht umgedeutet.
- Grenzen: 2 bis 25 Punkte (`MAX_ROUTE_POINTS` = `MAX_DIRECTIONS_COORDS`, eine Zahl für
  alle), höchstens 30 km Luftlinie zwischen zwei Punkten, Antwort höchstens 8 MB,
  Linie höchstens 10 000 Punkte. Wegdaten auf dem Server: sechs 5-Grad-Kacheln, 5 bis 20 Grad
  Ost und 45 bis 55 Grad Nord; das Salzburger Land liegt ganz in `E10_N45`.
- Rohe Meldungen von BRouter gehen nur ins Server-Log, nie an Gast oder App. Fehler über
  `logOps("routing_failed", { code })` (Ereignis erst in `OPS_EVENTS` eintragen), **ohne
  Koordinaten**.

## 7. Wie die App Routen bekommt

- **Offline:** `GET /api/app/v1/tours/{slug}/package?lang=` (optional angemeldet, `Cache-Control:
  private, no-store`). Antwort `AppTourPackage` (`app-api-types.ts`): `tour` (exakt die Antwort
  von `/tours/{slug}` für diesen Betrachter), `route` (`AppNavRoute`: Linie, sprachneutrale
  Schritte, `stopAlongM` je Stopp, `viaAlongM`, Länge, Dauer, Profil, `lineHash`, `source`),
  `bbox` (Linie und Stopps plus 1 km), `images`, `audio` (je Stopp genau eine Datei: gesperrt =
  Kostprobe `sample`, frei = `full`, signiert 2 h, nach `stopAudioAccess` aus
  `getTourDetailFor`), `contentHash`, `attribution`. Der `contentHash` (32 Zeichen SHA-256)
  deckt Tour-Detail, Route, Schritte, Bilder und Audio-Pfade ab, aber NICHT die signierten
  Links (Token wechselt) und nicht den Berechnungszeitpunkt. Die Route kommt aus
  `tour_nav_routes` (beim ersten Abruf gerechnet). Routendienst nicht erreichbar oder nicht
  eingerichtet und nichts gespeichert: `503 unavailable` (die App wiederholt). Grenzen: IP
  (300 in 5 min) und 30 Abrufe in 10 min je Konto bzw. je IP für Gäste. Die App macht aus den
  Schritten mit `SalzNavCore` (Port von `prepareSteps` und `toNavSteps`) die Ansagen in ihrer
  Sprache. Ohne Netz: "zurück zur Route" (docs/41 6.3).
- **Online umrouten:** `POST /api/app/v1/route`, optional angemeldet, Body (JSON, höchstens
  4000 Byte, unbekannte Felder = `400 invalid`): `{ tourSlug, from: [lng, lat], mode?, lang?,
  keep?: number[] (Indizes in tour.stops der offenen Stopps, aufsteigend), alongM?,
  viaAlongM? }`. Der Server baut die Kette selbst (`lib/tour-reroute.ts`, dieselben Bausteine
  wie `useBikeNavigation`: `navViasForStops`, `selectNavVias`, `buildBikeChain`): Position,
  offene Stopps mit den stillen Wegpunkten davor, Ziel, und zwar nur mit den Koordinaten, die
  `getTourDetailFor(slug, lang, canSeePro)` diesem Betrachter liefert. **Freie Wegpunkte
  nimmt der Endpunkt absichtlich nicht an:** sonst wäre er ein freier Routendienst. Bei Touren
  sind Stopp-Positionen und Linie öffentliche Teaser (Migration 0029, nur das Audio ist
  Pro-Ware), ein Gast bekommt also nichts, was `/tours/{slug}` ihm nicht auch zeigt.
  Antwort `{ lang, tier, route: { v, mode, profile, lineHash, geometry, steps, keep (Echo,
  damit die App `stopAlongM` zuordnen kann), stopAlongM (je Eintrag aus keep), viaAlongM, distanceM, durationMin, attribution } }`, `Cache-Control:
  private, no-store`. Nichts wird gespeichert, keine Koordinate geloggt (nur Anzahl Punkte,
  Zeit und Fehlercode).
- Prüfungen: `from` höchstens 5 km von der Linie der Runde (ohne Linie: von einem Stopp), sonst
  `400 invalid`; `mode` muss zur Runde passen; Fehlercodes wie in docs/41 4.3 plus
  `422 no_route` (additiv); Routing nicht erreichbar = `503 unavailable` (die App bleibt auf
  der alten Linie und zeigt "zurück zur Route").
- Ratenbegrenzung: die IP-Grenze (`appRateLimit`) und dazu ein eigener Topf `route`: **60
  Anfragen in 10 Minuten je Konto, 120 je IP für Gäste** (Hotel-WLAN teilt sich eine
  Adresse). Das deckt `stepNav` (höchstens alle 10 s am Rad = 60, alle 20 s zu Fuss = 30 in
  10 min). Gezählt wird vor der Prüfung des Inhalts.
- **Die App kennt weder den Geo-Server noch das Token.** Auch kein Mapbox-Directions-Aufruf
  aus der App (Product Terms 2.9.1).

## 8. Umstellung im Web (kleine Schritte, je ein PR)

1. **Dieses Gerüst** (`src/lib/routing/*`, `routing:compare`, `routing:drive`). Kein
   Verhalten ändert sich.
2. **Migration `tour_nav_routes`** (gebaut; Anton spielt sie vor dem Merge im SQL Editor ein).
3. **`snapTourRoute` auf BRouter (gebaut):** Kern in `routing/snap-tour.ts` (server-only), die Action bleibt
   unverändert in Signatur und Verhalten; Rückgabe Linie, Hash, Länge, Dauer, Wegpunkte und
   zusätzlich `warnings` und `attribution`; `saveTour` schreibt weiter `route_geo` und
   `route_hash` aus dem Formular, die `tour_nav_routes`-Zeile entsteht beim ersten Paket-Abruf. Die Vorschau zeigt Warnungen (Kehren) und den
   OSM-Hinweis. `MAPBOX_SERVER_TOKEN` wird dort nicht mehr gebraucht.
4. **Anton rechnet beide Runden im Editor neu** (Vorschau ansehen, speichern). Danach liegt
   keine Mapbox-Linie mehr in `tours`.
5. **Eigene Runden:** Die Reihenfolge rechnen wir selbst (höchstens 8 Stopps: exakt über
   alle Reihenfolgen auf Luftlinie, ab Start und zurück, deterministisch), die Linie kommt
   aus EINER BRouter-Anfrage mit `walk`-Profil. Ein einmaliges Skript rechnet die 5
   gespeicherten `user_tours.route_geo` mit derselben Reihenfolge (`point_ids`) neu.
6. **Web-Navigation auf BRouter (gebaut, ein System):** `fetchBikeRoute` fragt
   `POST /api/tours/[slug]/route` (selbe Herkunft, `foreignOrigin`, Cookie-Betrachter wie die
   Tour-Seite inkl. Entwurfs-Vorschau, 120 Anfragen je IP in 10 min), dahinter derselbe Kern
   wie `POST /api/app/v1/route` (`lib/tour-reroute.ts`; `keep` zählt hier die Halte mit
   Koordinate, `from` darf bis 30 km von der Linie liegen). Die Antwort wird zu `BikeRoute`
   (`steps` über `toNavSteps` mit den Texten `Tours.maneuver.*` aus den Sprachdateien in allen
   13 Sprachen, ohne Strassennamen). Hook, Stale-Antwort-Schutz, Wiederholung und
   Neuberechnung unverändert.
7. **Aufräumen (gebaut):** Mapbox-Directions-Code und `--mapbox` der Prüfskripte entfernt
   (Mapbox bleibt für Karten). Offen: Testfahrt am echten Gerät (`ride.mjs`/`walk.mjs`).

### 8.3 Web-Navigation: BRouter statt Mapbox live (entschieden und gebaut am 23.10.2026)

**Empfehlung: BRouter, ein System.**
- Eine Linie für alle: Admin-Vorschau, gespeicherte Runde, App offline, App online und Web
  fahren dieselbe Route mit demselben Profil. Genau diese Abweichung (Vorschau gleich
  andere Linie als die Fahrt) hat der Code schon zweimal gekostet (Kommentare in
  `snapTourRoute` und `tour-route.ts`, 15.09.2026).
- Ein Schritt-Format: Die Swift-Fixtures (docs/41 Phase 4) beweisen dann Web und App mit
  denselben Eingaben; mit Mapbox im Web und BRouter in der App liefen zwei Abbildungen.
- Gemessen gleich gut: keine falsche Neuberechnung, alle Stopps angeboten, Ziel erkannt
  (Abschnitt 5).
- Keine Abhängigkeit mehr von Mapbox-Directions-Bedingungen und -Kosten.

Preis: ein Server-Umweg je Berechnung (BRouter 220 bis 310 ms je ganzer Runde, plus
Vercel), keine Strassennamen mehr in der Anweisung ("Links abbiegen" statt "Links auf
Kreuzbergpromenade"), und der Geo-Server wird für die Web-Navigation betriebskritisch. Fällt
er aus, kein Rückfall auf Mapbox (zwei Systeme), sondern wie die App offline: alte Linie
behalten, "zurück zur Route".

## 9. Hinweis "© OpenStreetMap-Mitwirkende" (ODbL)

Überall, wo eine berechnete Linie oder eine Anweisung zu sehen ist: Tour-Seite (Karte),
Runden-Editor, Fahrbildschirm im Web, in der App Tour-Detail, Navigation und
Offline-Paket (Feld `attribution` im Manifest). Im Web über `customAttribution` der
Mapbox-Attribution ("Route: © OpenStreetMap-Mitwirkende"), Text über die Sprachdateien
(en: "© OpenStreetMap contributors"). Konstante: `OSM_ATTRIBUTION` in `types.ts`. Keine
Rechtsberatung: Kraxelbande behandelt gespeicherte Routen genauso (Hinweis ja,
Weitergabepflicht nicht für eigene Texte, OSM-Daten getrennt halten).

## 10. Datenschutz

Beim Umrouten geht die Position des Gastes an unseren Server und von dort (ohne IP des
Gastes) an den Geo-Server. Dort steht sie in keinem Protokoll: Caddy entfernt bei jedem
Logeintrag die Abfrage (lonlats) und den Authorization-Header (Filter logfilter). Die Ausgabe
von BRouter, das jede Anfrage mit Koordinaten auf stdout schreibt und nicht abschaltbar ist,
speichert Docker gar nicht (logging: driver: none). Das Caddy-Log enthält nur Zeit, Pfad ohne
Abfrage, Status, Dauer, Projekt und die IP unseres Servers; es rotiert bei 3 x 5 MB. Details:
Kraxelbande infra/geo/README.md, Abschnitt Datenschutz der Logs (Branch
geo-logs-ohne-positionen). Offene Frage 3 (Logs ohne Positionen) ist damit entschieden.
Hoster und Standort sind entschieden (offene Frage 2): Hostinger International Ltd.,
Server in Frankfurt am Main, Deutschland (EU), Auftragsverarbeiter. Die Datenschutzerklärung
(Punkt 3l "Navigation" und Punkt 5) ist darauf umgeschrieben. **Vor dem Merge:**
`LEGAL.updated` in `lib/legal.ts` nachziehen (bewusst erst beim Merge).

## 11. Server-Schritt für Anton

**Reihenfolge, nicht vertauschen:** (1) Token am Geo-Server (dieser Abschnitt) -> (2) Vercel-ENV `ROUTING_URL`/`ROUTING_TOKEN` für **Production UND Preview** -> (3) Migration `0076` im SQL Editor -> (4) erst dann mergen. Vercel-Previews brauchen die ENV ebenfalls, sonst gibt es dort keine Route (der Fahrbildschirm zeigt "gerade nicht erreichbar").

Auf dem Geo-Server, im Ordner `/opt/geo` (die Kopie aus Kraxelbande `infra/geo`), nach dem
README-Abschnitt "Ein weiteres Projekt anschließen". Die Kraxelbande-Dateien im Repo
bleiben unberührt; ob die Änderung auch dorthin zurück soll, entscheidet die
Kraxelbande-Sitzung.

1. Token erzeugen (auf dem Mac oder Server), Wert sicher ablegen:
   ```bash
   openssl rand -base64 36
   ```
2. In `/opt/geo/.env` eine Zeile ergänzen:
   ```
   GEO_TOKEN_SALZGUIDE=<token>
   ```
3. In `/opt/geo/Caddyfile` unter der Kraxelbande-Zeile:
   ```
   @salzguide header Authorization "Bearer {$GEO_TOKEN_SALZGUIDE}"
   ```
   und im Block `handle /routing/* { ... }` VOR `respond "unauthorized" 401`:
   ```
   handle @salzguide {
       uri strip_prefix /routing
       reverse_proxy brouter:17777 {
           header_up -Authorization
       }
   }
   ```
4. **Fehlt im README:** In `/opt/geo/docker-compose.yml` beim Dienst `caddy` unter
   `environment:` ergänzen, sonst bleibt `{$GEO_TOKEN_SALZGUIDE}` im Container leer:
   ```yaml
   GEO_TOKEN_SALZGUIDE: ${GEO_TOKEN_SALZGUIDE:?fehlt}
   ```
5. Prüfen und neu starten (Caddy wird neu erzeugt, laufende Anfragen von Kraxelbande
   brechen für eine Sekunde ab; `admin off` erlaubt kein sanftes Neuladen):
   ```bash
   cd /opt/geo
   docker compose config >/dev/null && echo compose-ok
   docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   docker compose up -d
   docker compose ps
   ```
6. Von aussen testen (Hostname einsetzen):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://<geo-host>/routing/brouter?lonlats=13.043,47.802|13.055,47.805&profile=trekking&alternativeidx=0&format=geojson"
   # erwartet: 401
   curl -s -H "Authorization: Bearer <token>" "https://<geo-host>/routing/brouter?lonlats=13.043,47.802|13.055,47.805&profile=trekking&alternativeidx=0&format=geojson&timode=2" | head -c 120
   # erwartet: {"type": "FeatureCollection", ...
   ```
7. Einstellungen für SalzGuide: in Vercel (Production und Preview) und in `.env.local`:
   ```
   ROUTING_URL=https://<geo-host>/routing
   ROUTING_TOKEN=<token>
   ```
   Profile und Wegdaten braucht es keine neuen: `segmente-laden.sh` lädt `trekking.brf`,
   `hiking-mountain.brf` und `E10_N45` schon.

Token zurückziehen: Zeile aus `.env` löschen (und die Caddy-Zeilen), `docker compose up -d`.
Kraxelbande merkt davon nichts.

**Lokal ohne Server** (Prüfskripte): BRouter-Release laden und starten, z. B.
`java -Xmx512m -cp brouter-1.7.10-all.jar btools.server.RouteServer segments4 profiles2 customprofiles 17777 4 127.0.0.1`
mit `segments4/E10_N45.rd5` und `profiles2/` von brouter.de (Merkmalstabelle
`lookups.dat` muss zur Datenversion passen). Die Skripte fragen `http://127.0.0.1:17777`
oder `ROUTING_URL_LOCAL`.

## 12. Geteilt oder getrennt

Der Code kennt nur `ROUTING_URL` und `ROUTING_TOKEN`. Deshalb bleibt beides möglich:
- **Geteilt (jetzt):** ein BRouter, je Projekt ein Token im Caddy. Speichergrenze 900 MB,
  1,5 CPU für beide Projekte; SalzGuide erzeugt wenig Last (Editor selten, Umrouten
  höchstens alle 10 bis 20 s je fahrendem Gast, eine ganze Runde 0,2 bis 0,3 s).
- **Getrennt (später, wenn Last oder Ausfallrisiko es verlangen):** denselben Ordner auf
  einer zweiten Maschine aufsetzen (oder als zweites Compose-Projekt mit eigenem
  Hostnamen), Token dort eintragen, in Vercel `ROUTING_URL` umstellen, redeploy. Keine
  Code-Änderung, keine Migration: gespeicherte Routen gehören uns und bleiben.
- Eigene SalzGuide-Profile gehen ohne Trennung: als Parameter in der Anfrage
  (`profile:...`) oder als eigene `.brf` im Profilordner (dann in `segmente-laden.sh`).
- Beide Projekte hängen an derselben Datenversion (`lookups.dat`); Image `master` statt
  `latest`, weil die veröffentlichte Fassung älter sein kann als die Wegdaten (Kommentar in
  Kraxelbandes docker-compose).

## 13. Prüfen

- `npm run routing:check [-- --no-brouter] [-- --base=http://localhost:PORT --server-log=<datei>]`:
  Modul, Admin-Kern, Paket (Gast gegen Pro, `contentHash`, Zwischenspeichern), Umrouten,
  Fehlerwege, Ratenbegrenzung. Der BRouter-Teil braucht den lokalen BRouter (Abschnitt 11),
  der HTTP-Teil einen laufenden Server mit `ROUTING_URL` und legt ein Wegwerf-Konto an. Die
  RLS-Probe von 0076 steht im PR (lokaler Wegwerf-Postgres, Gegenprobe ohne Migration rot).
- `npm run routing:compare [-- --profiles=all]`: jede veröffentlichte Runde
  mit dem echten Adapter gegen die gespeicherte Linie; nur lesend, Ausgabe ohne Titel und
  Slugs ("Tour 1 (Rad, Pro)").
- `npm run routing:drive`: dieselben Runden durch den echten `stepNav`.
  Braucht `scripts/lib/nav-cases.ts` (PR #309); bis dahin `NAV_CASES=<pfad>`.
- Spot-Wanderrouten (`snapRoute`, `wp:routes`) laufen über openrouteservice; dessen
  Bedingungen stellen Ergebnisse unter CC-BY-SA 4.0 (Kraxelbande docs/13, Abschnitt 3).
  Nicht Teil dieses Umbaus, aber derselbe Adapter (`walk` / `hiking-mountain`) könnte sie
  übernehmen (offene Frage 5).

## 14. Offene Fragen an Anton

1. **Geh-Runde ansehen:** BRouter ist 756 m kürzer als Mapbox live und weicht an einigen
   Stellen ab. Beim Neu-Berechnen im Editor die Linie prüfen; passt sie nicht, Wegpunkt
   setzen. Und die gespeicherte Linie ist schon heute veraltet (`route_hash` passt nicht).
2. ~~Geo-Server: Hoster, Land~~ entschieden: Hostinger, Frankfurt am Main (EU), Auftragsverarbeiter; Datenschutzerklärung angepasst (Abschnitt 10). Ob ein Auftragsverarbeitungsvertrag mit Hostinger besteht, prüft Anton.
3. ~~Logs ohne Positionen~~ entschieden und beschrieben in Abschnitt 10 (Kraxelbande-Branch
   geo-logs-ohne-positionen); vor dem Betrieb dort deployen.
4. ~~Tempo für die angezeigte Dauer~~ entschieden: Tempo der Navigation (Rad 12, zu Fuss
   4,5 km/h), Abschnitt 4. Anton kann es mit `FALLBACK_SPEED_MPS` ändern; das gilt dann auch
   für die Ankunftszeit.
5. **Spot-Wanderrouten** (openrouteservice, gespeichert): ebenfalls auf BRouter umstellen?

## 15. Folgearbeiten (nicht Teil dieses Umbaus)

Diese Stellen rufen weiter Mapbox oder openrouteservice auf; bis zur Umstellung bleibt, was
in Abschnitt 1 steht.

1. **Eigene Runden** (`optimizeLoop` in `tour-generate.ts`, Mapbox Optimization, speichert
   `user_tours.route_geo`): auf eigene Reihenfolge-Rechnung plus EINE BRouter-Anfrage mit
   `walk`-Profil umstellen (Abschnitt 8, Schritt 5); die 5 gespeicherten Linien neu rechnen.
2. **Spot-Wanderrouten** (`snapRoute` in `admin-actions.ts`, `wp:routes`, openrouteservice,
   gespeichert in `spots.route_geojson`): offene Frage 5; derselbe Adapter (`walk`) könnte sie
   übernehmen.
3. **Pflichtzeile im Web:** "Route: © OpenStreetMap-Mitwirkende" (`Tours.routeAttribution`, 13
   Sprachen) steht im Fahrbildschirm (`customAttribution` der Karte). Offen: Tour-Seite und
   Editor-Karte; im Admin steht sie in der Meldung der Vorschau.
4. **Neu rechnen im Admin:** ein Knopf "Route neu berechnen" für `tour_nav_routes`, falls
   Anton eine gespeicherte Route nach einem Wegdaten-Update bewusst erneuern will (heute:
   Runde ändern).
5. **Anstieg** (`ascentM`) steht noch nicht im Paket (nur Auskunft, nicht gespeichert).

## 16. Übergabe: Spot-Wanderrouten und eigene Runden auf BRouter (in Arbeit, 23.10.2026)

Branch `feat/spot-routes-brouter` (auf #316). Abgebrochen wegen Shutdown, Stand und Plan hier,
damit die nächste Sitzung ohne Scratchpad weiterkommt. Beim Abschluss diesen Abschnitt in §1, §8,
§13, §14 und §15 einarbeiten und löschen.

### 16.1 Inventar (fertig): alles, was nicht über BRouter routet

| Stelle | Datei:Zeile | Dienst | Speichert | Auslöser |
|---|---|---|---|---|
| `snapRoute()` Spot-Wanderung | `src/lib/admin-actions.ts:583-660` (ORS-Aufruf Zeile 596) | openrouteservice `foot-hiking` (`ORS_KEY`), mit Höhe | Formular -> `saveSpot` schreibt `spots.route_geojson` (LineString), `spots.elevation_profile`, `route_waypoints`; Dauer/Schwierigkeit nur, wenn leer (`adopt`-Regel in SpotForm) | Admin, Knopf "Anpassen" / "Hin & zurück" in `src/components/admin/SpotForm.tsx:364` |
| `optimizeLoop()` eigene Runden | `src/lib/tour-generate.ts:336-390` (URL Zeile 353) | Mapbox Optimization `optimized-trips/v1/mapbox/walking` (`MAPBOX_SERVER_TOKEN`), roundtrip ab Start | `user_tours.route_geo`, `distance_km`, `duration_min` (`saveUserTour`, `src/lib/user-tours.ts:70`) | Pro-Nutzer im KI-Builder `/touren/bauen` (`src/components/tours/TourBuilder.tsx`) |
| `scripts/wp-import/routes.ts:140` (`wp:routes`) | ORS `foot-hiking` | `.wp-cache/routes.json` (lokal; `wp:import` schreibt später in die DB) | Einmal-Import, Anton von Hand |
| `scripts/seed-runde-a.ts:209` | Mapbox Directions `cycling` | `tours.route_geo` + `route_hash` | Einmal-Seed, Anton von Hand; docs/42 §1: "nicht mehr ausführen bis umgestellt" |
| `scripts/routing-web-drive.mjs` | nur Prüfung ("keine Anfrage an api.mapbox.com/directions"), kein Aufruf | - | - |

Alles andere (Runden-Editor, Web-Navigation, App-Paket, App-Umrouten) ist seit #316 BRouter.

### 16.2 Datenstand Produktion (nur gelesen, 23.10.2026)

- 48 veröffentlichte Spots mit `route_geojson` (LineString), 32 davon Pro, ALLE mit
  `elevation_profile`; `route_waypoints` je 4 bis 20 Punkte (nie > 25, also unter
  `MAX_ROUTE_POINTS`); Linien 40 bis 797 Punkte.
- 6 `user_tours`, 5 mit `route_geo`, je 4 bis 5 Stopps.
- Folge einer Neuberechnung der Spot-Linien: `introSourceHash` (`src/lib/intro-hash.ts`) hängt
  an `route_geojson` -> alle Intro-Videos würden als "veraltet" gelten und neu gerendert.
  Anton muss das wissen, bevor jemand `--write` läuft.

### 16.3 Gebaut (im Worktree, committed als WIP)

- `src/lib/routing/types.ts`: `NormalizedRoute.elevationM: number[] | null` (additiv).
- `src/lib/routing/normalize.ts`: `finishRoute({ rawElevationM })` überträgt die Höhen auf die
  gesäuberte Linie (`elevationFor`), null bei Lücken.
- `src/lib/routing/brouter.ts`: `parseBrouterGeojson` liest die 3. Koordinate (Höhe; lokal
  geprüft: BRouter 1.7.10 liefert sie für jeden Punkt).
- `src/lib/routing/run.ts`: `RoutePurpose` um `"spot"` und `"builder"` (20 s) erweitert.
- Lokaler BRouter: `scratchpad/brouter/` (jar `dl/brouter-1.7.10/brouter-1.7.10-all.jar`,
  `segments4/E10_N45.rd5`, `profiles2/`), Start wie docs/42 §11 mit
  `/opt/homebrew/opt/openjdk@21/bin/java`. Liegt im Scratchpad, überlebt den Neustart evtl. nicht
  (dann neu laden von brouter.de, NIE ins Repo).

`npx tsc --noEmit` lief beim Abbruch noch (Ergebnis in `scratchpad/spot-routes/tsc.log`, falls
vorhanden). Lint und die Prüfskripte sind NICHT gelaufen.

### 16.4 Plan (entschieden, noch nicht gebaut)

1. `src/lib/elevation.ts` (OHNE server-only): Typ `ElevationProfile`, `downsample`,
   `buildElevationProfile(coords, elevationM)` (Format wie Migration 0006, 100 Punkte).
   `admin-actions.ts`, `spots.ts`, `SpotForm.tsx`, `SpotDetailMap.tsx`, `ElevationProfile.tsx`
   importieren den Typ von dort (heute aus der "use server"-Datei). `scripts/wp-import/route-math.ts`
   reicht `downsample`/`elevationProfile` von dort weiter (eine Quelle).
2. `src/lib/routing/snap-spot.ts` (server-only): `routeSpotLine(waypoints)` = Kette in
   Stücken zu je `MAX_ROUTE_POINTS` (25, Überlappung 1 Punkt; "Hin & zurück" mit 20
   Kontrollpunkten ergibt 39), je Stück `runRoute({ mode: "walk", purpose: "spot" })`
   (Profil `hiking-mountain`, docs/42 §3), Linie/Höhen/Länge zusammensetzen, Labels
   "Start", "Punkt n", "Ziel". `snapSpotRouteCore(waypoints)` = Profil über
   `buildElevationProfile`, Auf/Ab über `ascentDescent`, Dauer `hikingTimeMinutes` (SAC, wie
   heute), Testadapter-Riegel wie `snapTourRouteCore`, Fehlertexte `adminRoutingError`.
   Rückgabe wie `SnapResult` heute plus `warnings`, `attribution`.
3. `admin-actions.ts` `snapRoute`: nur `requireAdmin()` + Kern; ORS-Code, lokales `haversine`
   und `downsample` raus. NICHTS Neues aus der "use server"-Datei exportieren.
   `SpotForm.tsx`: Meldung um Hinweise + "© OpenStreetMap-Mitwirkende" ergänzen; die
   `adopt`-Regel (Dauer nur, wenn leer oder forceDuration) bleibt unverändert.
4. `src/lib/routing/order.ts` (rein): `orderLoop(start, coords) -> number[]`, exakt
   (Held-Karp) bis 10 Stopps auf Luftlinie ab Start und zurück, deterministisch; darüber
   Nächster-Nachbar + 2-opt. `src/lib/routing/user-loop.ts` (server-only):
   `routeUserLoop(start, stops)` = EINE `runChain`-Anfrage `[start, ...stops, start]`,
   `mode: "walk"`, `purpose: "builder"`, Dauer `tourDurationMin(distanceM, "walk", n)`
   (= 4,5 km/h + 2 min je Stopp, docs/42 §4); `planUserLoop` = `orderLoop` + `routeUserLoop`.
5. `tour-generate.ts`: `optimizeLoop`/`nearestNeighbor` raus, `planUserLoop` rein; Rückgabe
   `{ order, geo, distanceM, durationMin }`, bei Fehler `geo: null` wie heute (Linie
   geradlinig im Client), UX/Form der Antwort unverändert. Kommentare in `user-tours.ts`
   (Mapbox) anpassen. `MAPBOX_SERVER_TOKEN` wird dann nirgends mehr gebraucht.
6. `scripts/seed-runde-a.ts`: Mapbox-Block durch `runChain({ points: [start, ...spots, start],
   mode: "bike", purpose: "editor" })` + `tourDurationMin` ersetzen (nicht ausführen).
   `scripts/wp-import/routes.ts`: `snap()` durch `routeSpotLine` ersetzen, ORS-Schlaf und
   Tageslimit-Logik raus; Rauchtest mit `--limit 1` braucht `.wp-cache/` aus dem Haupt-Checkout
   (liegt dort, 95 Quellen, gitignored).
7. Vergleich VOR jeder Live-Änderung: `scripts/lib/line-compare.ts` (aus `routing-compare.ts`
   herauslösen: `sample`, `distToLine`, `compareLines`), neues
   `scripts/spot-routes-compare.ts` (nur lesend, `ROUTING_URL` im Skript auf
   `ROUTING_URL_LOCAL ?? http://127.0.0.1:17777` setzen, Token löschen): alle 48 Spots
   (`route_waypoints` -> `snapSpotRouteCore`) und alle 5 eigenen Runden
   (`[start, ...point_ids-Reihenfolge, start]` -> `routeUserLoop`) gegen das Gespeicherte:
   Länge, Dauer (alt: `duration`-Text und SAC aus altem Profil; neu: SAC), Auf-/Abstieg,
   Hausdorff/Mittel/"nah innerhalb 15 m"; Flags bei |Δkm| > max(0,5 km, 15 %), Hausdorff > 250 m,
   nah < 60 %, |ΔAnstieg| > max(50 m, 30 %). Markdown-Bericht nach
   `scratchpad/spot-routes/report.md`, Spots mit Slug (öffentliche URLs), eigene Runden nur als
   "Eigene Runde n" (Nutzerdaten). Screenshots der schlechtesten Fälle: Leaflet-HTML (alt links,
   rot; neu rechts, blau; gleiche Bounds) per playwright-core mit System-Chrome
   (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, wie `routing-web-drive.mjs`).
8. `scripts/spot-routes-rewrite.ts`: Trockenlauf-Standard, `--write` schreibt NUR
   `spots.route_geojson` + `elevation_profile` (nie `duration`, `difficulty`, `route_waypoints`)
   und `user_tours.route_geo` + `distance_km` + `duration_min`; `--only=<slug>`. NICHT ausführen.
   Nach einem `--write`: Katalog-Cache (`updateTag(SPOTS_TAG)`) wird vom Skript nicht
   invalidiert -> ein Spot im Admin speichern oder redeploy.
9. `scripts/routing-check.ts` erweitern: Spot-Kern gegen lokalen BRouter (Höhen da, Profil
   100 Punkte, Dauer = SAC-Formel, Stückelung bei 30 Punkten = 2 Anfragen, Labels), `orderLoop`
   gegen Brute-Force + Determinismus, eigene Runde = eine Anfrage und Linie endet am Start,
   Testadapter-Riegel. Dann `tsc`, `lint`, `routing:check`, `nav:check`, `tour-route:check`,
   `i18n:check`, Browser: Admin-Spot-Editor (Wächter per `SG_NAV_PROBE` im Worktree, Memory
   "Admin testen ohne Login") und Builder mit Wegwerf-Pro-Konto (`scripts/lib/temp-user.ts`,
   `setProfile({ is_pro: true })`, `webCookieHeader`) auf Port > 3030.
10. docs/42: §1-Tabelle, §8 Schritt 5 "gebaut", §13, §14 Frage 5, §15 Punkte 1+2 erledigen,
    neuen Abschnitt zu Spot-Wanderrouten (Profil, Höhen, Stückelung, Rewrite-Skript,
    Vergleichszahlen). `ORS_KEY` und `MAPBOX_SERVER_TOKEN` danach aus Vercel entfernbar
    (erst nach Merge prüfen, ob noch jemand sie liest).

### 16.5 Was Anton entscheiden muss

- Spot-Linien neu rechnen (Skript `--write`) oder Spot für Spot im Admin ("Anpassen")?
  Beides erzeugt neue Intro-Hashes (Videos "veraltet").
- Profil `hiking-mountain` für Spot-Wanderungen bestätigen, sobald der Vergleich die
  Abweichungen zeigt (ORS foot-hiking gegen BRouter).
- Eigene Runden: 5 gespeicherte Linien neu rechnen (Reihenfolge bleibt `point_ids`).
