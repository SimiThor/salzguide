# Rad-Audioguide: Navigation, Audio-Spots, Auslegung

Stand: 2026-08-25 · Code: `src/lib/bike-nav-core.ts`, `src/components/tours/nav/` · Prüfung: `npm run nav:check` (18 Prüfungen)

Dieses Dokument war ab dem 24.08.2026 an neun Stellen im Code als „siehe docs/40" zitiert,
bevor es existierte. Es holt das nach: Es hält fest, was gebaut wird, mit welchen Zahlen,
und vor allem **warum**, damit niemand an einem Schwellwert dreht, ohne zu wissen, wogegen
er anläuft.

## Das Problem

Eine geführte Radtour durch Salzburg kostet rund 50 Euro und braucht einen Menschen, der
mitfährt. Der Gast bekommt dafür Orientierung („wo geht es lang") und Geschichten („was ist
das hier"). Beides zusammen ist der Wert, und beides zusammen ist auch der Grund, warum es
teuer ist und nur zu festen Zeiten stattfindet.

Ein Audioguide ohne Navigation löst nur die Hälfte: Der Gast weiß, was er sieht, aber nicht,
wo er hinfahren soll. Eine Navigation ohne Audio löst die andere Hälfte. Wer beides trennt,
zwingt den Gast, zwischen zwei Apps zu wechseln, und zwar auf dem Rad.

## Die Lösung in einem Satz

Eine Webseite, die den Gast per Abbiege-Navigation eine feste Runde fahren lässt und kurz
vor jeder Sehenswürdigkeit einen Play-Knopf einblendet, den er im Vorbeifahren mit dem
Daumen trifft.

## Die vier Festlegungen

Am 24.08.2026 von Anton entschieden. Sie stehen hier, weil jede davon den Code an mehreren
Stellen prägt und sonst später neu verhandelt wird.

| Frage | Entscheidung | Was daraus folgt |
|---|---|---|
| Verkauf | Gratis-Einstieg, Rest über Pro | Kein neuer Kaufweg. `freeStops` und das bestehende Pro-Gate der Audio-Touren gelten unverändert, auch im Fahrmodus. |
| Fahrrad | Jedes Rad, nicht nur S-Bike | Die Runde darf keine S-Bike-Station als Pflicht-Start haben. Kein Feature darf ausfallen, wenn der Gast sein eigenes Rad schiebt. |
| Gruppen | Ein Handy pro Person | Keine Geräteverwaltung, keine Freischaltung für Dritte. Der Startbildschirm sagt es in einem Satz. |
| Umfang v1 | Eine Runde, fahren und hören | Siehe die Nicht-Liste unten. |

## Was die erste Fassung ausdrücklich NICHT kann

Diese Liste ist der wichtigste Abschnitt des Dokuments. Sie ist keine Wunschliste für
später, sondern eine Absage für jetzt. Wer eines davon baut, baut über den vereinbarten
Umfang hinaus.

- **Kein Leihrad-Schritt.** Keine Stationskarte, kein Fußweg zur Station, keine Übergabe an
  die Ausleih-App. Grund: Die Stationsdaten liegen nur als Seiteninhalt auf s-bike.at, ihre
  Nutzung ist nicht freigegeben, und Verfügbarkeitsdaten gibt es überhaupt nicht (Belege im
  Prüfbericht vom 24.08.2026).
- **Keine zweite Runde.** Jede weitere Runde kostet 13 Sprachvertonungen und eine eigene
  Abnahmefahrt. Erst wenn eine Runde erprobt ist, lohnt die zweite.
- **Keine gesprochenen Abbiegehinweise.** Die Abbiegung steht als Text und Pfeil da, dazu
  ein Ton. Sprachausgabe in 13 Sprachen ist ein eigenes Vorhaben.
- **Kein Offline-Betrieb.** Die Runde braucht Netz. Ausnahme ist das Audio, siehe unten.
- **Keine Höhenprofile, keine Zwischenzeiten, keine Bestenlisten.** Das ist eine
  Sightseeing-Runde, kein Sportgerät.

## Zielgruppe und Auslegung

**Der Gast** ist erwachsen, ortsfremd, allein oder zu zweit unterwegs, hat ein Handy in
einer Lenkerhalterung und Kopfhörer im Ohr oder eben nicht. Er ist kein Sportler und kein
Ortskundiger. Er hat womöglich kein EU-Roaming, denn die Sprachen, wegen derer es das
Produkt gibt (ko, zh, en), kommen überwiegend von außerhalb der EU.

**Auslegungstempo: 18 km/h, also 5 m/s.** Alle Distanzschwellen unten sind aus dieser Zahl
gerechnet, nicht geschätzt. Ein Pedelec wird bis 25 km/h unterstützt, in der Stadt mit
Kreuzungen und Ampeln bleiben davon im Schnitt rund 18 übrig. Wer das Tempo ändert, muss
alle abgeleiteten Zahlen mitziehen, deshalb steht es hier ganz oben.

**Dauer unter zwei Stunden.** Zwei Gründe, beide hart: Der Browser hält eine Dauer-Navigation
mit Karte, GPS und Audio im selben Tab nur begrenzt durch, bevor der Akku knapp wird. Und
ein S-Bike hat ein Mietlimit von vier Stunden, in das die Tour samt Pausen passen muss.

## Die Zahlen, und warum sie so sind

Sie leben in `NAV` in `src/lib/bike-nav-core.ts`. **Bis zur ersten echten Testfahrt sind es
Startwerte**, abgeleitet aus fremden Apps und aus 18 km/h. Sie gehören nach der ersten Fahrt
gegen die Wirklichkeit geprüft.

Die Tabelle listet jetzt getrennt, was im Code steht und was noch aussteht. Eine Zusage ohne
Code ist eine offene Baustelle, keine Eigenschaft.

### Umgesetzt

| Zweck | Konstante | Wert | Herkunft |
|---|---|---|---|
| Audio-Spot ankündigen | `SPOT_NEAR_M` | 150 m | 30 Sekunden bei 18 km/h. OsmAnd nimmt 167 m im Radprofil. |
| Spot als vorbei werten | `SPOT_PASSED_M` | 100 m | Der Gast war da, auch ungehört. Verhindert, dass ein verpasster Spot die Runde blockiert. |
| Kulanz für einen vorgemerkten Spot | `SPOT_GRACE_M` | 250 m | Wer wegen einer Sperrzone nie angeboten werden konnte, bekommt die Geschichte kurz nach dem Ort noch. |
| Sperrzone vor einer Abbiegung | `MANEUVER_QUIET_M` | 140 m | **Sicherheitsregel:** kein Play-Angebot, während eine Abbiegung bevorsteht. „Ankommen" zählt nicht als Abbiegung. |
| Ende der Runde | `FINISH_M` | 35 m | Stadtübliche GPS-Streuung. |
| ...bestätigt über | `FINISH_FIXES` | 2 Fixe | Ein einzelner Messwert reicht nicht (siehe unten). |
| ...und nur nach Annäherung | `FINISH_APPROACH_M` | 250 m | Ein Sprung von der halben Runde auf 20 m Rest ist kein Zieleinlauf. |
| ...zurücknehmbar ab | `FINISH_RELEASE_M` | 90 m | Hysterese. Wer weiterfährt, ist nicht fertig. |
| Größter Fortschritts-Sprung | `MAX_JUMP_M` | 400 m | Gedeckelt, plus Zeitbudget `JUMP_SLACK_M`. Begründung unten. |
| Off-Route | `OFF_ROUTE_M` | 40 m, 3 Messungen | Radweg neben der Fahrbahn plus Häuserschlucht. |
| Neuberechnung frühestens | `REROUTE_COOLDOWN_MS` | 10 s | Keine zwei in derselben Häuserschlucht. |
| Messwerte verwerfen ab | `MAX_ACCURACY_M` | 60 m | Schlechtere werden gar nicht bewertet. |
| Entscheidungen brauchen | `DECIDE_ACCURACY_M` | 35 m | Off-Route und Ende brauchen einen saubereren Fix. |
| Ausreißer-Filter | `MAX_SPEED_MPS` | 20 m/s | Schnellere Sprünge sind GPS-Ausreißer, kein Tempo. |
| Kamera-Neigung | `NAV_PITCH` | 58 Grad | **Weicht bewusst von Mapbox' 45 ab.** Am Gerät geprüft und für gut befunden; 45 wäre die flachere Alternative mit mehr Vorschau. Offen, ob ein Vergleich lohnt. |
| Kamera-Zoom | `NAV_ZOOM` | 17 | Mapbox nennt 16,3 als Startwert. Ebenfalls am Gerät geprüft. |
| Position des Punkts im Bild | `PUCK_AT` | 0,68 | Nicht die Mitte: Beim Fahren zählt, was vorne liegt. |

### Noch NICHT umgesetzt

Diese Zeilen standen als Zusage in der Tabelle, ohne dass Code dahinterstand. Sie sind
weiterhin richtig, aber sie sind Arbeit, keine Eigenschaft.

**Gemessen an Runde A:** 54 Schritte auf 9,6 km, also alle 178 m einer. Nach dem Filtern und
Bündeln sind es **41 Ansagen, eine alle 234 m**, und alle 34 echten Richtungswechsel sind
weiterhin dabei. Der Winkel war beim ersten Anlauf invertiert (eine Gerade ergab 180 Grad
statt 0), es wurde also nichts verworfen; deshalb steht er als eigene Prüfung in
`nav:check` Nr. 21.

| Zweck | Wert | Stand |
|---|---|---|
| Abbiegung dreistufig ansagen | 300 m / 80 bis 100 m / 15 bis 20 m | Es gibt nur eine Stufe: der Banner zeigt die Distanz durchgehend, die Farbe wechselt bei 120 m und 30 m. |
| Zwei Abbiegungen bündeln | unter 50 m Abstand | **erledigt 25.08.2026** (`lib/nav-steps.ts`). Die zweite bleibt ein eigener Schritt, hängt aber als „dann" schon an der ersten. Es geht nichts verloren. |
| Kurve ist keine Abbiegung | unter 35 Grad verwerfen | **erledigt 25.08.2026.** Verworfen wird nur, was flach UND harmlos ist: `turn`, `new name`, `continue` ohne echte Richtung. Ein `end of road` bleibt, auch mit 20 Grad. Ohne Winkel von Mapbox wird nie verworfen. |
| Mindestabstand zwischen Audio-Spots | 600 m | Redaktionsregel, kein Riegel im Code. Nach einer Neuberechnung entscheidet Mapbox, wo die Spots liegen. |
| Audio vor dem Start vorladen | rund 13 MB | fehlt. Ohne Roaming beginnt die Runde sonst mit einem Ladebalken. |
| Ruhezustand zwischen Abbiegungen | Bildschirm abdunkeln | fehlt. Akku-Maßnahme aus der Recherche. |

## Warum ein eigener Navigations-Screen

`SpotMap.tsx` ist für rund 15 Aufrufer auf eine flache Kamera, Einpassen per `fitBounds` und
ein Kamera-Gedächtnis festgelegt. Im Fahrmodus ist fast alles davon umgekehrt: geneigte,
dem Kurs folgende Kamera, die nie einen gespeicherten Ausschnitt wiederherstellt und bei
jedem GPS-Signal neu zentriert. Beide Regime in eine Komponente zu zwingen hätte jeden
bestehenden Aufrufer riskiert. Deshalb `NavMap.tsx` daneben, das sich nur die geteilten
Bausteine holt (`tryCreateMap`, `declutterBasemap`, die Routen-Layer, den Ladeschirm).

**Der Fahrmodus hat kein App-Chrome.** Kein Header, keine Tab-Leiste, keine Toni-Blase. Auf
dem Rad ist jede Fläche, die einen wegnavigieren kann, ein Risiko, und diese Elemente fressen
genau den Platz, den die Abbiege-Anzeige braucht. Geregelt über `isImmersiveRoute()` in
`src/lib/routes.ts`. Wer einen weiteren so immersiven Screen baut, ergänzt ihn dort, statt an
`AppChrome` einzeln vorbeizuprüfen.

**Eigene Farben im Fahrmodus.** Die Creme-Farbe `#faf6ec` mit rotem Akzent ist für einen
ruhigen Innenraum gemacht. Am Lenker bei direkter Sonne ist das der falsche Grund. Der
Fahrmodus bekommt dunklen Grund und helle Schrift, Kontrast Richtung 7:1. Das ist kein Bruch
mit der Marke, sondern derselbe Fall wie ein Nachtmodus.

**Drei Elemente, nicht mehr.** Oben die Anweisungskarte mit Pfeil, Distanzzahl und einem
kurzen Anker-Halbsatz. In der Mitte die Karte, mindestens 55 Prozent der Bildschirmhöhe.
Unten eine einzige Kennzahl. Wer mehr unterbringen will, nimmt etwas anderes weg.

## Warum eine Route und nicht viele Etappen

Der erste Prototyp holte für jeden Stopp eine eigene kleine Route (`fetchBikeLeg`, seit
dem Umbau entfernt). Das war die richtige erste Entscheidung: kürzere Schrittlisten, bleibt unter
dem Koordinatenlimit der Directions-API, und eine neue Etappe entsteht ohnehin bei jedem
erreichten Stopp.

**Seit dem 24.08.2026 umgesetzt: eine Anfrage für die ganze Runde**, mit den Spots als
stillen Zwischenpunkten. Die Antwort liefert dann die durchgehende Linie, die vollständige
Abbiegeliste und zu jedem Spot seine Position auf der Route als Zahl. Drei Dinge, die mit
Etappen grundsätzlich nicht gehen, fallen damit von selbst an:

1. **Route vor dem Gast farbig, hinter ihm ausgegraut.** Eine Etappe kennt nur den Weg zum
   nächsten Spot, nie die ganze Runde. Mit einer Linie ist es ein einziger Wert
   (`line-trim-offset`, die Quelle braucht `lineMetrics: true`).
2. **Exakter Audio-Vorlauf.** Die Entfernung bis zum nächsten Spot ist direkt ablesbar,
   statt je Etappe neu geschätzt zu werden. Diese eine Zahl trägt das ganze Produkt.
3. **Neuberechnung nach vorn.** Biegt der Gast falsch ab, wird nicht zum Fehler zurück
   geführt, sondern vorwärts an den noch nicht gehörten Spots vorbei. Gehörte Spots fallen
   aus der Anfrage.

Nebenbei sinken die Anfragen von rund 40 auf rund 11 je Fahrt.

Am 24.08.2026 gegen die echte API gemessen, damit niemand die Annahmen nachbauen muss:
Eine Anfrage über fünf Punkte liefert ein Leg mit 342 Geometriepunkten, 34 Abbiegungen und
je stillem Wegpunkt seine Stelle auf der Linie. Die Spot-Position wird aus dem
`geometry_index` gelesen, nicht aus `distance_from_start`: Beide stimmen auf wenige Meter
überein, aber der Index zeigt auf UNSERE Geometrie, also wird der Spot-Offset auf derselben
Linie gemessen wie der Fortschritt des Gastes. Gegengeprüft mit `nearestPointOnRoute`:
jeder Spot misst auf den Meter dort, wo sein Offset ihn hinsetzt. Unsere Haversine-Länge
weicht um 6 m auf 5,6 km von Mapbox' Distanz ab, das sind 0,11 Prozent.

**Der Preis, ehrlich benannt:** `nearestPointOnRoute()` braucht ein Vorwärtsfenster, und der
Fortschritt muss monoton werden. Ohne das springt eine Runde an ihren eigenen
Kreuzungspunkten, das Ausgrauen wird falsch und Audio feuert am falschen Ort. Bei einer
Salzburger Altstadtrunde ist das kein Randfall, sondern der Normalfall.

## Zwei Wege zu jeder Geschichte, nicht einer

Das automatische Angebot hängt an der Ortung, und die ist genau dort am schlechtesten, wo die
Spots stehen: In der Altstadt liegt sie gemessen 11 bis 13 m daneben, an einer Ampel zwischen
Häuserwänden kann sie ganz wegbleiben. Wäre das Angebot der einzige Weg, wäre die Geschichte
dann nicht zu hören, obwohl der Gast direkt davor steht.

Seit 25.08.2026 gibt es deshalb zwei Wege von Hand, beide nach dem Muster von Apple Maps und
Google Maps, wo jeder Pin immer antippbar ist:

1. **Tipp auf einen Pin.** Öffnet denselben Streifen wie das automatische Angebot.
2. **Tipp auf die Zielleiste unten.** Öffnet die Liste aller Stopps, jeder anspielbar.

Der zweite Weg ist der wichtigere, und das ist gemessen: Auf einem iPhone-Viewport war
während der Fahrt **einer von sieben Pins im Bild**. Die Kamera folgt dem Fahrer, alles andere
liegt außerhalb. Ein Weg, der nur über die Karte führt, wäre also für sechs von sieben Stopps
gar keiner.

Die Handauswahl hat VORRANG vor dem automatischen Angebot: Wer selbst tippt, hat gerade eine
Absicht, und die darf ein Vorschlag nicht überschreiben. Und sie startet nichts von selbst.
Der Play-Knopf kommt, gedrückt wird er vom Menschen.

Die Bezahlgrenze bleibt dabei sichtbar und ehrlich: In der Liste steht bei den Gratis-Stopps
die Dauer, bei den anderen „20 Sekunden gratis". Kein Schloss, keine graue Zeile.

**Es läuft immer nur eine Stimme, und das X hält an.** Auf einen anderen Spot zu tippen
pausiert die laufende Geschichte. Weiterlaufen zu lassen, während im Streifen schon etwas
anderes steht, ist der verwirrendste der drei möglichen Ausgänge. Das X hält ebenfalls an und
räumt den Streifen weg.

Dafür braucht es einen eigenen Merker: Der Streifen zeigt eine angefangene Geschichte auch im
PAUSIERTEN Zustand weiter (`audio.time > 0`), damit man sie wieder aufnehmen kann, und genau
diese Regel holte ihn nach jedem X sofort zurück. Der Streifen liess sich also gar nicht
schliessen. Das X ist aber eine Ansage, und die schlägt die Regel. Wer danach wieder Play
drückt, hebt sie auf.

`pause()` ist dafür eine eigene Funktion im Player und nicht `toggle()`: Toggle STARTET,
wenn gerade nichts läuft, und das ist beim Schliessen das Gegenteil dessen, was gemeint ist.

## Warum die Karte fast leer ist

Am 25.08.2026 hat Anton den Fahrbildschirm am eigenen Gerät gesehen und gesagt, er wisse
nicht, wohin er fahren soll: mehrere rote Linien übereinander, kein erkennbarer Anfang.

**Gemessen:** 2,44 von 9,59 km der Runde sind doppelt befahren, also 25 Prozent. Zwei
Sackgassen (Nonnberg, Freisaal) und ein Uferkorridor, den sie zweimal benutzt. Auf diesen
Metern lagen der ausgegraute gefahrene Teil und die rote Linie auf DENSELBEN Pixeln.

Drei Änderungen, in der Reihenfolge ihrer Wirkung:

1. **Der gefahrene Teil verschwindet, statt grau zu werden.** Mapbox' Standardwert für
   `line-trim-color` ist `transparent` (nachgesehen im installierten Paket), wir hatten das
   aktiv auf Grau überschrieben. Eine graue Linie ist immer noch eine Linie. Und weil der
   Trim ENTLANG der Linie misst, löst sich damit auch jede Sackgasse von selbst: Sobald der
   Gast herausfährt, ist der Hinweg Vergangenheit und verschwindet, während der Rückweg auf
   derselben Straße stehenbleibt.
2. **Rot ist nur die aktuelle Etappe**, von Halt zu Halt (`sliceAlong` in `geo.ts`). Der
   zweite Durchgang durch denselben Korridor liegt in einer anderen Etappe und wird gar
   nicht gezeichnet, solange er nicht dran ist. Rot ist damit eine Zusage für JETZT, und die
   kann es nur einmal geben.
3. **Was noch kommt, bleibt sichtbar**: ab dem nächsten Halt bis zum Rundenende, als blasse
   Linie mit heller Fassung darunter. NICHT die ganze Runde, denn was hinter dem Gast liegt,
   hat er hinter sich; Googles Übersicht zeigt bei Mehrziel-Fahrten ausdrücklich nur „the
   untraveled portion of the route". Und bewusst erst AB dem nächsten Halt, nicht ab der
   aktuellen Position: So überlagern sich die blasse und die rote Linie nie, und die blasse
   muss nur siebenmal je Runde neu gesetzt werden statt bei jedem Messwert.

   Die helle Fassung ist kein Zierrat. Eine dünne dunkle Linie hat auf einer bunten Karte
   mal Kontrast und mal keinen, über Wiese, Wald und Wasser jeweils anders. Erst mit der
   Fassung ist die Frage „was habe ich noch vor mir" auf jedem Untergrund beantwortet.
   Mapbox macht es bei der Hauptroute genauso.

Ausdrücklich NICHT gebaut: Richtungspfeile auf der Linie, Versatz für Hin- und Rückweg,
Abdunkelung ausserhalb eines Korridors. Alle drei lösen ein Problem, das nach 1 und 2 nicht
mehr existiert, und füllen den Bildschirm wieder.

**Was sonst noch wegfiel**, nach dem Vorbild von Googles Fahransicht, die im Ruhezustand
zwei Panels zeigt und sonst fast nichts:

- Sechs von sieben nummerierten Pins. Nur der nächste Halt trägt eine Nummer, die anderen
  sind ruhige Punkte, weiterhin antippbar mit voller Trefferfläche.
- Eine von zwei Zahlen in der unteren Leiste. Der Restweg in Kilometern stand direkt neben
  einer zweiten Entfernung; das ist dieselbe Verwechslung, die im Kopf von `NextStopBar.tsx`
  schon einmal repariert wurde.
- Der Tourtitel im Zurück-Knopf, eine breite Textfläche direkt neben dem Abbiege-Banner.
- Die Zahl im Abschluss. „4 von 7 Stationen gehört" ist ersatzlos weg, samt Konfetti.
  Silverman und Barasch haben 2023 im Journal of Consumer Research gemessen, dass nicht das
  Auslassen demotiviert, sondern das ANZEIGEN des Auslassens: acht Prozentpunkte weniger
  Weitermachen bei identischer Handlung. Der Titel ist jetzt eine Ortsangabe („Wieder am
  Start"), die auch stimmt, wenn jemand bei Halt vier aufgehört hat.
- Das automatische Verschwinden des Play-Streifens. Er bleibt, bis Play, X oder der nächste
  Halt ihn ablöst. Wer an der Ampel steht und den Knopf schon weg findet, hat den Halt
  verloren und weiss nicht warum.

Dazu zwei Zahlen: `SPOT_NEAR_M` von 150 auf 200, weil bei einer Abbiegung im Angebotsfenster
von 150 m nur 10 m nutzbar blieben. Und der Abschlussvorhang fällt erst, wenn die Runde
wirklich durch ist, nicht schon beim ersten Ausreisser in Startnähe.

## Die vier Phasen eines Audio-Spots

Ein Spot durchläuft `open`, `pending`, `near`, `done`. Die dritte Phase ist der Grund, warum
die Zusage aus der Sperrzone überhaupt hält:

- **open**: noch zu weit weg.
- **pending**: in Reichweite, aber der Play-Knopf wartet, weil eine Abbiegung bevorsteht.
  Ohne diese Phase ging der Spot verloren: Der Übergang war blockiert, wurde nirgends
  gemerkt, und der Spot lief stumm von `open` auf `done`. In einer Gasse mit Abbiegungen
  alle 80 m lag sein ganzes Fenster in der Sperrzone.
- **near**: angeboten, der Play-Knopf steht.
- **done**: abgehakt. Heißt NICHT „gehört". Was wirklich lief, zählt der Fahrbildschirm
  getrennt mit, weil der Kern den Player bewusst nicht kennt.

**Höchstens ein Angebot gleichzeitig.** Die Oberfläche hat einen Streifen; zwei Angebote im
selben Rechenschritt hätten einander überschrieben, und der übergangene Spot hätte nie wieder
auslösen können. Der nächstgelegene gewinnt, der nächste rückt nach, sobald der erste
abgehakt ist.

## Warum eine Rundtour besondere Absicherung braucht

Eine Runde endet dort, wo sie beginnt. Drei Folgen, alle teuer erkauft:

**Das Ziel ist nicht der letzte Spot.** Bis 25.08.2026 routete die Navigation vom Gast über
alle Stopps zum letzten Stopp, und dort war Schluss. Bei Runde A ist der letzte Stopp Mülln,
und der liegt **692 m vom Leihrad entfernt**: Der Gast bekäme „Ziel erreicht", während sein
Rad noch sieben Minuten weiter steht. Der Zielpunkt aus Migration 0061 (`tours.end_lat/lng`)
wird jetzt hinter die Spots gehängt, als Wegpunkt OHNE Geschichte. Gemessen: 8,72 km und
692 m daneben werden zu 9,60 km und 4 m daneben, bei unverändert sechs Audio-Spots. Dass
das Ziel kein Spot sein darf, ist der Kern: Alles in der Spot-Liste bekommt einen
Play-Knopf, und ein Play-Knopf ohne Geschichte ist ein Knopf, der nichts tut.

**Jeder falsche Messwert in Startnähe sieht aus wie ein Zieleinlauf.** Deshalb reicht Nähe
allein nicht: Das Ende gilt erst nach `FINISH_FIXES` sauberen Messungen, und nur wenn der
Fortschritt vorher schon in Zielnähe lag. Es ist außerdem zurücknehmbar, und es sperrt die
Neuberechnung nicht mehr. Ein falsches „fertig" darf nicht die einzige Selbstheilung
abschalten, und der Abschlussbildschirm hat einen „Weiterfahren"-Knopf.

**Der Fortschritt darf auch nicht RÜCKWÄRTS laufen.** Am 25.08.2026 an der echten Runde A
gemessen: Zwei ihrer Spots liegen in Sackgassen (Nonnberggasse, Freisaal). Mapbox fährt
hinein, wendet und kommt auf demselben Weg zurück. Auf dem Rückweg liegt der Gast physisch
auf derselben Linie wie auf dem Hinweg, und die Suche nahm bei gleichem Abstand das zuerst
indizierte Segment, also den Hinweg. Weil das Suchfenster danach um diesen kleineren Wert
neu zentriert wurde, rutschte es beim nächsten Fix noch weiter zurück: **bei 3.690
gefahrenen Metern meldete der Kern 2.127 m**, und alle vier Spots dahinter blieben stumm.
Ein Boden unter dem Fenster allein half nicht, dann fror der Fortschritt bei 460 m fest,
weil die Korrektur nach vorn grösser war als der Stetigkeits-Riegel erlaubt.

Gelöst über die FAHRTRICHTUNG: Ein Segment, das ihr entgegenläuft, bekommt einen Aufschlag
und gewinnt nur noch, wenn es deutlich näher liegt. Die Richtung kommt vom Gerät, und wenn
das keine liefert (iOS gibt `heading` in der Geolocation-API oft gar nicht her), aus den
letzten beiden Messpunkten. NICHT aus der Richtung der Route an der Stelle: Die stammt aus
genau dem Segment, das bestimmt werden soll. Geprüft in `nav:check` Nr. 19, mit Rauschen
und ohne Geräterichtung.

**Der Fortschritt darf nicht springen.** Weil die Linie sich selbst nahe kommt, kann die
Suche auf einen ganz anderen Ast schnappen. Gemessen: ein einzelner Messwert ließ den
Fortschritt von 200 auf 1579 m springen, verbuchte vier Spots und meldete „Runde geschafft"
nach 200 gefahrenen Metern. Ein Sprung wird deshalb nur übernommen, soweit er in der
verstrichenen Zeit fahrbar war, gedeckelt auf `MAX_JUMP_M`. Der Deckel ist der Kern der
Sache: Nach einer langen Ortungslücke wissen wir ohnehin nicht, wo der Gast ist, dann ist
Stehenbleiben und Neuberechnen besser als Raten.

## Priorität 1 ist die Navigation, nicht das Audio

Wenn die Führung falsch ist, ist die Geschichte am falschen Ort oder gar nicht zu hören. Ein
Umweg kostet nicht nur Zeit, er kostet den Spot. Deshalb:

- Die reine Entscheidungslogik (Ankunft, Off-Route, Fahrtrichtung) lebt in
  `bike-nav-core.ts`, **ohne Mapbox, ohne DOM, ohne `Date.now()`**. Die Zeit kommt als Feld
  im Signal herein. Nur so lässt sie sich ohne Browser prüfen.
- `npm run nav:check` fährt sie gegen erfundene Signalfolgen. Das Skript ist Pflicht, nicht
  Kür: „beim Testen am Handy mal kurz schauen" geht hier nicht, dafür müsste man wirklich
  fahren.
- Jede Änderung an `NAV` oder an der Entscheidungslogik braucht einen Testfall, der den
  Grund für die Änderung festhält.

## Vier Grenzen, die nicht wegprogrammierbar sind

**Der Browser navigiert nicht im Hintergrund.** Sperrt der Gast das Handy oder wechselt die
App, wird der Bildschirmschutz freigegeben, die Standortverfolgung gedrosselt und das Audio
kann stoppen. Die Führung hängt daran, dass die Seite sichtbar bleibt. Der Startbildschirm
muss das in einem Satz sagen. Nach einer Rückkehr aus dem Hintergrund werden Entscheidungen
erst ab dem zweiten guten Signal wieder getroffen, sonst hält der Teleport-Filter einen
Fünf-Minuten-Sprung fälschlich für echte Fahrt.

**Der Akku.** Karte, GPS, Bildschirmschutz und Audio laufen im selben Tab. Zwischen den
Abbiegungen gehört ein Ruhezustand: sehr dunkler, sehr reduzierter Schirm, der rund 80 m vor
der nächsten Abbiegung von selbst aufwacht.

**Die Altstadt schaltet den Motor ab.** S-Bike drosselt in Fußgängerzonen per Geofence.
Genau dort liegen die schönsten Spots. Eine naiv gezeichnete Altstadtrunde lässt den Gast ein
40 Kilogramm schweres Rad schieben. Die Route wird um diese Flächen herum geplant, und wo
geschoben werden muss, steht es als eigene Markierung da: gestrichelte Linie, Schiebe-Symbol,
eigener Hinweis. **Nicht** still als Radweg durchgehen lassen.

**Ein Profil, nicht zwei.** Der Prototyp fragt Rad- und Fußprofil ab und nimmt die kürzere
Strecke, weil das Radprofil in Parsch Umwege nahm. Das kann den Gast auf Treppen oder in eine
Einbahn gegen die Fahrtrichtung führen. Ab v1: Radprofil, und wo ein Fußweg gewinnt, wird er
als Schiebestelle markiert.

## Audio im Fahrbetrieb

- **Play statt Autoplay.** Der Knopf erscheint, der Gast entscheidet. Nie von selbst starten,
  schon gar nicht während einer Abbiegung (siehe Sperrzone oben).
- **Der Player schrumpft, die Führung bleibt.** Läuft eine Geschichte, wird aus dem Sheet
  eine schmale Leiste. Die Karte und die nächste Abbiegung bleiben sichtbar. Wegwischen darf
  **niemals** zum nächsten Stopp weiterschalten, das sind zwei verschiedene Absichten.
- **Vorladen vor dem Start.** Das Audio der gewählten Sprache wird vor der Abfahrt vollständig
  geladen, mit sichtbarem Fortschritt (Größenordnung 13 MB). Gäste aus Korea, China, den USA
  und Großbritannien haben kein EU-Roaming, und das sind genau die Sprachen, wegen derer es
  das Produkt gibt.
- **Die Abbiegung hat Vorrang.** Kommt ein Hinweis, während eine Geschichte läuft, wird die
  Geschichte leiser geregelt. Die Browser-Schnittstelle dafür gibt es nicht, das muss die
  Seite selbst tun.
- **Signale ohne Sprache.** Ein Piep für „Abbiegung kommt", zwei für „jetzt". Das funktioniert
  in allen 13 Sprachen ohne Übersetzung. Vibration gibt es im iOS-Browser nicht, jedes Konzept
  damit ist auf der Hälfte der Geräte wirkungslos.

## Die erste Runde: A, "Die Stadt von außen"

Am 25.08.2026 entschieden, nachdem drei Runden gegen echte OSM-Wegedaten gerechnet und
verglichen wurden (BRouter, Profil trekking; Beläge und Poller aus Overpass; Straßennamen
über Nominatim alle 300 m entlang der Linie abgetastet).

**9,05 km · 33 Höhenmeter · 7 Audio-Spots · rund 55 Minuten · 0 m Fußgängerzone · keine
Schiebestelle.** Start und Ziel: S-Bike-Station Hanuschplatz, 47.80132/13.04160.

Die Spots in Reihenfolge: Marko-Feingold-Steg (km 0,00) · Festung und Dom von unten (0,95) ·
Stift Nonnberg von unten (1,70) · Schloss Freisaal im Weiher (2,70) · Giselakai, die Altstadt
von gegenüber (5,80) · Mirabellplatz und Mirabellgarten (7,28) · Mülln, Müllner Kirche und
Augustiner (8,24). Kleinster Abstand 750 m, also über der 600-m-Regel.

**Warum A und nicht B oder C.** A ist die einzige, die Festung, Dom, Nonnberg, Mirabell und
Augustiner liefert und dabei um jede gesperrte Fläche herumfährt. Genau das ist die Aufgabe
aus dem Problem-Abschnitt oben: Die schönsten Spots liegen dort, wo S-Bike den Motor
drosselt. Dazu stehen vier der sieben Spots ganz oder teilweise schon in der Datenbank, und
bei 13 Vertonungen je Spot ist das die halbe Produktionsrechnung.

B ("Wasser und Wiese", 7,56 km) ist die schönste, hängt aber am Neutor: ab Mitte September
2026 Vollsperre, für Radfahrende eine Schiebestrecke, in Phase 2 eingeschränkt bis August
2030. Sie ist die Vorlage für Runde 2, sobald das Neutor wieder offen ist. C ("Der Fluss",
8,88 km, 4 Höhenmeter) ist technisch die beste, hat aber keinen einzigen berühmten Namen auf
der Strecke und wäre mit fünf von sechs neuen Spots die teuerste.

**Zwei Stellen entscheiden über A, und beide nur vor Ort:**

1. **Die Unterführung an der Karolinenbrücke, km 5,3.** Rang 7 der neun amtlich benannten
   gefährlichsten Radstellen der Stadt: 13 Unfälle in drei Jahren, 3,5 m Breite bei 4,5 m
   Bedarf, an Spitzentagen 9.000 Radfahrende je Seite. Dort darf kein Audio-Spot liegen, der
   nächste steht bei km 5,80. Dorthin gehört eine gesprochene Tempo-Ansage.
2. **Der Mirabell-Abstecher, km 6,4 bis 7,3.** Drei Versenkpoller, einer mit Radfreigabe,
   zwei ohne. Lässt sich das nicht sauber fahren, fällt der Abstecher weg: Runde 8,1 km,
   sechs Spots, und der bekannteste Spot ist raus.

**Die Audio-Auslöser gehören in `tour_points`, nicht auf `spots`.** `spots.lat/lng` ist bei
allen 48 Spots mit Route der ERSTE ROUTENPUNKT, also der Ausgangspunkt eines Weges, nicht die
Sehenswürdigkeit. Wer die Koordinate vom Spot kopiert, startet die Richterhöhe-Geschichte
870 m vor der Richterhöhe und die Hellbrunner-Allee-Geschichte 1,5 km vor der Allee. Aus den
Spots kommen Text und Bild, nie die Position.

## Bevor eine Runde live geht

1. Die Runde **einmal wirklich abfahren**, Etappe für Etappe abhaken, mit Datum und Fassung
   festhalten. Eine Route, die niemand gefahren ist, darf nicht veröffentlicht werden.
2. Die Sperrzonen prüfen: Startet irgendwo ein Audio-Spot zu nah an einer Abbiegung?
3. Die Schiebestellen prüfen: Ist jede als solche markiert?
4. Die Abfahrt-Prüfung **zweimal im Jahr** wiederholen, nicht nur einmal vor dem Start.
   Baustellen und Sperren ändern sich.
5. Wetter und Tageslicht: Eine Runde, die nach Sonnenuntergang minus Fahrdauer beginnen
   würde, wird gar nicht erst angeboten.

## Der Kauf mitten in der Fahrt

Die ersten zwei Stopps sind gratis, ab dem dritten ist die Geschichte Pro. Der Übergang
passiert also auf einem Rad, in einer laufenden Runde.

**Der Rücksprung ist der erste Baustein, und er war kaputt.** Bis 25.08.2026 endete jeder
Kauf fest auf `/pro`, egal wo er begonnen hatte. Im Fahrbetrieb heisst das: Karte weg, Route
weg, Ortung weg, Wake Lock weg, und die Navigation muss am Straßenrand neu gestartet werden.
Wer bezahlen wollte, verlor dafür seine Fahrt. Jetzt reist der Slug der Runde in den
Metadaten der Stripe-Session mit und führt Erfolg, Abbruch und den Anmeldelink aus der Mail
dorthin zurück.

**Es reist ein SLUG mit, kein Pfad.** Ein Zielpfad von aussen ist eine offene Weiterleitung,
und der Moment direkt nach dem Bezahlen ist der denkbar schlechteste dafür: Der Käufer
erwartet gerade, dass etwas passiert, und würde eine Seite, die nach seinen Zugangsdaten
fragt, für unsere halten. Der Pfad entsteht deshalb serverseitig aus einem Slug, der weder
Schrägstrich noch Punkt noch Doppelpunkt enthalten darf (`safeTourSlug` in `lib/url.ts`).
Geprüft in `npm run pro:check` gegen fünfzehn Ausbruchsversuche.

**Statt eines Schlosses eine Kostprobe.** Am ersten bezahlten Stopp stand ein graues Schloss,
wo eben noch der Play-Knopf war. Ein Schloss sagt nein; es sagt nicht, was es kostet und was
danach kommt, und es nimmt dem Fahrbildschirm ausgerechnet den 56-Pixel-Knopf weg, der als
einziger im Fahren wirklich zu treffen ist. Seit Migration 0065 hat jeder Punkt eine
Kostprobe von rund 20 Sekunden, und der Knopf bleibt stehen.

Die Kostprobe ist eine EIGENE DATEI und kein Abschnitt der Volldatei. Wer die Volldatei
ausliefert und nach 20 Sekunden stoppt, hat kein Gate gebaut, sondern eine Bitte: Ein Blick
in die Netzwerkspur, und die ganze Geschichte liegt da. `stopAudioAccess()` in
`lib/tour-audio-gate.ts` ist die eine Stelle, die entscheidet, welcher Pfad signiert wird,
und sie fällt ausdrücklich NICHT auf die Volldatei zurück, wenn eine Kostprobe fehlt. Geprüft
in `npm run pro:check`.

Sie ist auch nicht der abgeschnittene Anfang, sondern ein eigener Text: Bei einem Schnitt
endet der Ton mitten im Satz, ein eigener Text darf aufhören, wo es spannend wird. Für die
Vertonung heisst das eine zweite, kurze Datei je Punkt und Sprache.

**Was noch fehlt**, in dieser Reihenfolge: Apple Pay und Google Pay im selben Fenster (der
Sprung zu Stripes Kasse ist der letzte verbliebene Seitenwechsel), und eine Preiszeile vor
dem Start, damit Stopp 3 als Bestätigung ankommt und nicht als Überraschung.

**Drei Fragen gehören vor dem Weiterbauen zu einem Anwalt.** Der EuGH hat am 09.07.2026 in
einem österreichischen Fall entschieden (C-234/25, Sky gegen VKI), dass laufend gepflegte
Angebote digitale Dienstleistungen sind und der Rücktrittsausschluss aus § 18 Abs. 1 Z 11
FAGG dort nicht greift; Sky hatte fast unsere Formel verwendet. Dazu: ob ein Häkchen reicht
oder zwei nötig sind, und der Widerrufsbutton nach § 13a FAGG ab 01.10.2026.

## Was noch offen ist

- **Bekommen wir Stationsdaten für S-Bike freigegeben?** Daran hängt der Leihrad-Schritt,
  der bewusst nicht in v1 ist. Anfrage an den Salzburger Verkehrsverbund, ausdrücklich
  inklusive Stationsbelegung.
- **Ein eigener Fahrmodus-Farbsatz** ist beschlossen, aber noch nicht entworfen.
- ~~Manöver-Texte in 13 Sprachen~~ **erledigt, war ein Fehlalarm.** Hier stand, Mapbox
  liefere nicht alle Sprachen und cs, hu, sk, ko und zh bräuchten eigene Bausteine. Am
  24.08.2026 gegen die echte API gemessen: Alle 13 Sprachen kommen als echte Übersetzung
  zurück, und `bike-directions.ts` übergibt den Sprachparameter längst. Was bleibt, ist
  eine Stilfrage: Die Texte nennen Straßennamen ("Leicht nach links auf
  Kreuzbergpromenade abbiegen"), und ein deutscher Straßenname hilft einem Gast aus Korea
  wenig. Ein sichtbarer Anker wäre besser ("nach der Brücke rechts"), aber den kennt nur,
  wer die Route zur Autorenzeit vor sich hat.
- ~~**Der Testhaken muss weg.**~~ **erledigt am 25.08.2026.** `lib/test-sbike-tour.ts`,
  `lib/test-sbike-slug.ts`, der Footer-Link und beide Aufrufstellen sind entfernt, sobald es
  eine echte Runde in der Datenbank gab. Die Parsch-Runde war nie eine Runde, sondern eine
  Attrappe mit erfundenen Stationen und geliehener Vertonung; sie stand nur, weil `mode`
  sonst nirgends "bike" werden konnte. Vorher nötig war die Spalte: **ebenfalls erledigt am
  25.08.2026:** Migration 0064 legt das Enum `tour_mode` und die Spalte `tours.mode` an
  (Default `walk`), `lib/tours.ts` liest sie an allen drei Stellen statt hart "walk"
  zurückzugeben, und das Admin-Formular hat ein Feld "Fortbewegung". Alle Lesestellen fangen
  eine fehlende Spalte ab, damit die Seite auch vor der Migration aufgeht. Was jetzt noch
  fehlt, ist die Runde selbst: Gebiet, sieben Punkte, Texte, Vertonung.
