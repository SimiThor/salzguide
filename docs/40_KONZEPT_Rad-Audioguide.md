# Rad-Audioguide: Navigation, Audio-Spots, Auslegung

Stand: 2026-08-24 · Code: `src/lib/bike-nav-core.ts`, `src/components/tours/nav/` · Prüfung: `npm run nav:check`

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

Sie leben in `NAV` in `src/lib/bike-nav-core.ts`. **Bis zur ersten echten Testfahrt sind
alle Startwerte**, abgeleitet aus fremden Apps und aus 18 km/h. Sie gehören nach der ersten
Fahrt gegen die Wirklichkeit geprüft, nicht vorher festgeschrieben.

| Zweck | Wert | Herkunft |
|---|---|---|
| Audio-Spot ankündigen | 150 m vor dem Spot | 30 Sekunden bei 18 km/h. OsmAnd nimmt 167 m im Radprofil. Genug Zeit, den Daumen zu heben, ohne dass der Knopf ewig dasteht. |
| Spot als besucht werten | 100 m Vorbeifahrt | Der Gast war da, auch wenn er nicht gedrückt hat. Verhindert, dass ein verpasster Spot die Runde blockiert. |
| Ankunft am Spot | 35 m | Stadtübliche GPS-Streuung zwischen Häusern. |
| Abbiegung vorbereiten | 300 m | Erste von drei Stufen, damit eine Abbiegung nicht überrascht. |
| Abbiegung ansagen | 80 bis 100 m | Rund 18 Sekunden. Die Stufe, auf die der Gast reagiert. |
| Abbiegung auslösen | 15 bis 20 m | Letzte Bestätigung im Moment des Abbiegens. |
| Zwei Abbiegungen bündeln | unter 50 m Abstand | Sonst hört der Gast „rechts" und steht 20 m später vor der nächsten Kreuzung. Genau daran scheitert komoot laut Nutzerkritik. |
| Kurve ist keine Abbiegung | unter 35 Grad wird verworfen | „Sagt eine Abbiegung an, wo die Straße nur einen Bogen macht" ist die meistgenannte Beschwerde bei Rad-Navi-Apps. |
| Abstand zwischen zwei Audio-Spots | mindestens 600 m | Bei 18 km/h sind das zwei Minuten. Näher beieinander überlagern sich Geschichte und nächste Ankündigung. |
| Sperrzone vor einer Abbiegung | 140 m | **Sicherheitsregel:** In diesem Fenster startet kein Audio-Spot. Niemand soll eine Geschichte anfangen, während er in eine Kreuzung einfährt. |
| Off-Route | 40 m Querabstand, 3 Messungen | Radweg neben der Fahrbahn plus Häuserschlucht-Ungenauigkeit. |
| Kamera-Neigung | 45 Grad, auf kleinen Geräten 35 | Mapbox' eigener Standardwert für Navigation. Die 58 Grad aus dem Prototyp fressen Vorschau-Distanz. |
| Kamera-Zoom | 16,3 | Mapbox' Startwert. Nie unter 14, sonst verliert man die Straßenzuordnung. |
| Kamera vor der Abbiegung | ab 70 m flach kippen | Macht die Kreuzung von oben lesbar. Mapbox kippt ab 180 m, das ist Auto-Distanz. |
| Kamera-Drehung dämpfen | höchstens 30 bis 45 Grad je Messung | Ohne das dreht sich die Karte an jeder Ampel. |

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

Der Prototyp holt für jeden Stopp eine eigene kleine Route (`bike-directions.ts`,
`fetchBikeLeg`). Das war die richtige erste Entscheidung: kürzere Schrittlisten, bleibt unter
dem Koordinatenlimit der Directions-API, und eine neue Etappe entsteht ohnehin bei jedem
erreichten Stopp.

**Ab v1 gilt trotzdem das Gegenteil: eine Anfrage für die ganze Runde**, mit den Spots als
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

**Der Preis, ehrlich benannt:** `nearestPointOnRoute()` braucht ein Vorwärtsfenster, und der
Fortschritt muss monoton werden. Ohne das springt eine Runde an ihren eigenen
Kreuzungspunkten, das Ausgrauen wird falsch und Audio feuert am falschen Ort. Bei einer
Salzburger Altstadtrunde ist das kein Randfall, sondern der Normalfall.

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

## Bevor eine Runde live geht

1. Die Runde **einmal wirklich abfahren**, Etappe für Etappe abhaken, mit Datum und Fassung
   festhalten. Eine Route, die niemand gefahren ist, darf nicht veröffentlicht werden.
2. Die Sperrzonen prüfen: Startet irgendwo ein Audio-Spot zu nah an einer Abbiegung?
3. Die Schiebestellen prüfen: Ist jede als solche markiert?
4. Die Abfahrt-Prüfung **zweimal im Jahr** wiederholen, nicht nur einmal vor dem Start.
   Baustellen und Sperren ändern sich.
5. Wetter und Tageslicht: Eine Runde, die nach Sonnenuntergang minus Fahrdauer beginnen
   würde, wird gar nicht erst angeboten.

## Was noch offen ist

- **Bekommen wir Stationsdaten für S-Bike freigegeben?** Daran hängt der Leihrad-Schritt,
  der bewusst nicht in v1 ist. Anfrage an den Salzburger Verkehrsverbund, ausdrücklich
  inklusive Stationsbelegung.
- **Ein eigener Fahrmodus-Farbsatz** ist beschlossen, aber noch nicht entworfen.
- **Manöver-Texte in 13 Sprachen.** Mapbox liefert nicht alle. Für cs, hu, sk, ko und zh
  braucht es entweder eigene Bausteine oder einen bewussten Rückfall, der nicht still
  passiert.
- **Der Testhaken muss weg.** `lib/test-sbike-tour.ts`, `lib/test-sbike-slug.ts`, der
  Footer-Link und die Aufrufstellen verschwinden, sobald es eine echte Runde in der Datenbank
  gibt. Dafür braucht `tours` eine Spalte für die Fortbewegungsart, heute kommt `mode: "bike"`
  ausschließlich aus der fest verdrahteten Testrunde.
