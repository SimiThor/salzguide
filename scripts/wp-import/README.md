# Inhalts-Übernahme von der alten WordPress-Seite

Einmaliger Import der 95 Spots von `salzguide.com` (WordPress) in die neue App.
Die Skripte sind bewusst als eigener Ordner abgelegt: Sie gehören nicht zur App,
sondern zu einem Umzug, der einmal stattfindet und danach nachvollziehbar bleiben soll.

## Zugang

In `.env.local` (gitignoriert):

```
WP_USER=<WordPress-Benutzername oder E-Mail>
WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
WP_BASE_URL=https://www.salzguide.com
```

Das Anwendungspasswort entsteht in WordPress unter *Benutzer → Profil →
Anwendungspasswörter*. Es ist kein Kontopasswort und jederzeit einzeln widerrufbar.
Gebraucht wird ein Konto mit Bearbeitungsrechten (Begründung unten bei `context=edit`).
**Nach dem Import widerrufen.**

## Ablauf

```bash
npm run wp:fetch          # alte Seite  -> .wp-cache/     102 Beiträge, 775 Dateien, 2 Karten
npm run wp:extract        # .wp-cache/  -> source/*.json + report.md
npm run wp:media          # Fotos+Videos -> Supabase Storage, media-map.json
npm run wp:routes         # Linien an echte Wege snappen -> routes.json
npm run wp:import -- --go # source + drafts + routes -> Spot-ENTWÜRFE in der DB
```

Dazwischen entstehen die deutschen Texte von Hand als `.wp-cache/drafts/<slug>.json`.
Ohne Entwurf überspringt der Import den Spot: Die Textfelder sind das Einzige, was hier
niemand automatisch ableiten kann.

Alle Schritte sind **wiederholbar**. `wp:media` und `wp:routes` merken sich in ihren
Karten, was fertig ist, und überspringen es (bei knapp 1 GB Download und einem
ORS-Tageslimit ist ein Lauf, der von vorn anfängt, unbenutzbar). `wp:import` legt an oder
aktualisiert über den Slug, statt am eindeutigen Schlüssel zu scheitern.

An der alten Seite ändert nichts etwas: Es wird ausschliesslich gelesen.

### Aufräumen (einmalig, destruktiv)

```bash
npm run wp:reset          # zeigt, was gelöscht würde (Trockenlauf)
npm run wp:reset -- --go  # leert den Spot-Bestand der NEUEN App
```

Schreibt IMMER zuerst `.wp-cache/spots-backup.json` (Spot-Zeilen, alle Übersetzungen, alle
media-Zeilen), auch im Trockenlauf: Wer die Sicherung nur im Ernstfall schreibt, hat sie
genau dann nicht, wenn er sie braucht. Die Dateien im Bucket räumt es über
`removeSpotMediaFiles` weg, also über dieselbe Funktion wie `deleteSpot` — ein eigener
Nachbau würde die drei Intro-Video-Spalten vergessen, und die lägen dann für immer
öffentlich erreichbar herum. Kategorien und Locals bleiben stehen, die sind kuratiert und
kein Spot-Inhalt.

Gegenprobe nach dem Leeren: `collectStorageRefs` aus `scripts/lib/storage-refs.mjs` sagt,
welche Dateien im Bucket noch eine DB-Zeile hinter sich haben. Was dort fehlt, ist eine
Waise.

## Warum es so gebaut ist, wie es gebaut ist

**`context=edit` statt normalem Abruf.** 40 der 102 Spots liegen hinter der Paywall
(Simple Membership). Das Plugin hängt am `the_content`-Filter, deshalb liefert der
öffentliche Abruf dort nur den Kauf-Hinweis. Ein Anwendungspasswort allein hilft nicht,
weil das Plugin seine eigene Sitzung prüft und nicht den WordPress-Login. `context=edit`
gibt `content.raw` zurück, also den Inhalt aus der Datenbank, bevor ein Filter ihn sieht.
Nebenbei ist der Rohinhalt der bessere Ausgangsstoff: sauberes HTML statt Elementor-Divs,
und mit den Shortcodes, die auf der gerenderten Seite längst zu Widgets geworden sind.

**Das Pro-Flag kommt aus einem ZWEITEN, anonymen Abruf.** Genau dieselbe Eigenschaft, die
uns an die Pro-Inhalte bringt, macht die Sperre unsichtbar: `context=edit` umgeht den
Filter, der den Kauf-Hinweis erzeugt, und in `meta` steht nichts (SWPM legt sie in einem
geschützten postmeta ab). Der angemeldete Abruf sieht also NIE, dass ein Spot gesperrt ist.
Nur ein Gast sieht es. Ohne diesen Durchgang lägen alle 40 Pro-Spots frei lesbar in der
neuen App, und nichts sähe falsch aus.

**Die zwei Frontend-Karten der alten Seite sind eine eigene Quelle.** `/` und `/gastein/`
tragen je ein `spots`-Array im Seitenquelltext, mit `isPro` und dem Emoji pro Spot. Sie
decken 95 der 102 Beiträge ab und stimmen beim Pro-Flag auf allen 95 mit dem anonymen
Abruf überein — zwei unabhängige Quellen ohne Widerspruch sind ein Beleg, eine wäre eine
Annahme. Ein Widerspruch bricht den Abruf ab, statt sich einen Wert auszusuchen.

**Was ein Spot ist, entscheidet die Karte.** Die Kategorie „alle" enthält 102 Beiträge,
aber sieben sind Vorlagen und Entwürfe. Vorher stand hier eine Ausschlussliste mit vier
Slugs, die beim Draufschauen nach Müll aussahen; sie hätte die drei Entwürfe durchgelassen
und jeden künftigen Test, dessen Titel man nicht errät. Was SalzGuide seinen Besuchern als
Spot zeigt, ist ein Spot.

**Zwei Quellen je Spot.** Der Text steht in `content.raw`, die Karte in
`meta._elementor_data`. Koordinaten und Wanderlinie stehen dort als Klartext-JavaScript,
also genau so, wie die alte Karte sie benutzt hat.

**Der Extraktor ordnet nichts zu.** Er greift jeden beschrifteten Block wortgetreu ab und
hängt sein Etikett dran, statt „Dauer" mechanisch auf `section_a` zu schieben. Der
Altbestand hat zwei Template-Generationen mit verschiedenen Überschriften; eine
mechanische Zuordnung müsste bei jeder Abweichung raten, und Raten fällt hier still aus.
Die Zuordnung passiert beim Umschreiben, wo geurteilt wird.

**Quick-Facts werden über ihren Wert eingeordnet, nicht über ihre Position.** Gen A
beschriftet sie mit einem Emoji, Gen B stellt nur nackte Werte hin. Wo das Emoji da ist,
gilt es; sonst entscheidet `factCanonical` aus `src/lib/facts-i18n.ts`, also die ECHTE
Auflösung der App. Was hier durchfällt, fiele im Admin genauso durch und steht deshalb im
Report statt still in einem null-Feld.

**Alt-Schreibweisen stehen in `LEGACY` (parse.ts), nicht in der ALIAS-Tabelle der App.**
`medium`, `Sommer - Herbst`, `Local Fav` sind Altlasten dieses einen Imports. Sie in die
App zu übernehmen hiesse, den Müll von 2025 dauerhaft zu adoptieren.

**Medien laufen durch dieselben Regeln wie ein Admin-Upload.** Fotos auf 1600 px WebP wie
`image-upload.ts`, Videos durch die wörtlichen ffmpeg-Argumente aus `VideoUploader.tsx`
(720×1280, crf 28). Ein importiertes Video ist damit von einem hochgeladenen nicht zu
unterscheiden. Aus 945 MB wurden 233 MB.

## Routen: was gerechnet wird und was nicht

`wp:routes` legt jede Linie über OpenRouteService auf echte Wanderwege und rechnet die
DAV-Gehzeit (`hikingTimeMinutes` aus `geo.ts`, dieselbe Funktion wie beim Snappen im
Admin). Das Ergebnis geht in `routes.json`, geschrieben wird dabei nichts.

**Fehlende Rückwege werden ergänzt**, wie der Knopf „↔ Hin & zurück" im Formular. Aber
nicht blind: Auf der Schmittenhöhe geht man rauf und fährt mit der Seilbahn runter, dort
wäre Verdoppeln gelogen. Welche Lesart gilt, entscheidet die alte Dauer-Angabe. Das
Verdoppeln braucht keine zweite ORS-Anfrage, weil der Rückweg der Hinweg rückwärts ist.

**Snapping erfindet keine fehlende Strecke.** Ein Teil der alten Linien ist nicht ungenau,
sondern ein Stummel: Die Seisenbergklamm hat 16 Punkte im Abstand von zehn Metern, die
ganze Linie passt in eine Box von 130 Metern, angegeben sind zwei Stunden. Da hilft kein
API.

**Ab wann ist eine Linie eine Route: 500 Meter, absolut gemessen.** Der naheliegende
Vergleich mit der alten Dauer führt in die Irre — beim Goldegger See und der
Innersbachklamm sah die Linie „zu kurz" aus, dabei war sie richtig und die alte Zeitangabe
falsch. Darunter liegen Hangar-7 mit 80 Metern und Blick auf Hohenwerfen mit 30: Kringel um
einen Ort, keine Wege. Solche Spots bekommen nur einen Punkt.

**Was man fährt, bekommt keine Wanderlinie.** Panoramastraße, Schifffahrt, Bergbahn, und
die Hellbrunner Allee, die im eigenen Text durchgehend eine Fahrradtour ist. Die DAV-Formel
rechnete aus 30 km Grossglockner-Hochalpenstrasse 16 Stunden Fussmarsch.

**„0 min" ist keine Dauer, sondern das leere Feld der alten Seite.** 17 Spots tragen den
Wert, darunter der Dom und der Mirabellgarten. Unverändert übernommen stünde auf der
Detailseite „0 min", und das liest sich nicht wie eine fehlende Angabe, sondern wie ein
kaputtes Feld. Der Import wirft es weg (`durationForField` in `parse.ts`); echte Zahlen für
Punkt-Spots trägt Anton einzeln in `DURATION_BY_HAND` ein. Aufgefallen ist es erst, als der
Trockenlauf die Dauer für JEDEN Spot druckt und nicht mehr nur für die mit Route.

**Die Arbeitsvorlage sagt dieselbe Zahl wie der Import, weil sie dieselben Regeln benutzt.**
Vorher hatte `brief.ts` eine eigene Kopie der „wird gefahren"-Liste und verglich Subtyp-Namen
mit dem TYP-MARKER der alten Seite (`Panoramastraße` gegen `panoramastrasse`). Der Vergleich
traf nie zu, und deshalb sagte die Vorlage für die Grossglockner-Hochalpenstrasse „DAUER FÜRS
FELD: 16 Std 5 min" — die DAV-Gehzeit für 30 km Bergstrasse. Der Import lag richtig; falsch
war die Ansage an den, der den Text schreibt, und der hätte die 16 Stunden hingeschrieben.
`SUBTYPE_FROM_MARKER`, `notWalkedReason`, `MIN_ROUTE_KM` und `durationForField` stehen deshalb
in `parse.ts`, und beide hängen sich dort an. Ohne Route druckt die Vorlage jetzt die ALTE
Angabe als Feld-Wert, weil genau die im Feld landet.

**Die gerechnete Dauer gewinnt** über die alte Angabe, wo eine Route übrig bleibt: Die
alten Werte sind grob überschlagen, und 35 von 60 sind gar keine Gehzeit, sondern ein
„plane insgesamt X ein" inklusive Bergbahn, Pausen und Baden. Gerundet auf fünf Minuten,
weil die DAV-Formel eine Schätzung ist. **Der Fliesstext muss dieselbe Zahl nennen wie das
Feld** — ein Spot, der „50 min" anzeigt und „gut zwei Stunden" schreibt, ist schlimmer als
einer ohne Angabe.

## Drei Fallen, die hier schon zugeschnappt sind

**Der Titel als Quick-Fact.** Die Fact-Leiste endet beim Titel, nicht erst bei der ersten
Sektion. Ohne diese Grenze las der Automat `Schmittenhöhe` als Fact ein, und die unscharfe
Auflösung machte daraus klaglos die Gegend `Zell am See`. Falsch, aber plausibel, also
unsichtbar. Der Vergleich läuft über `normalizeText`, weil WordPress' `wptexturize` beim
Rendern aus `Maier's` ein `Maier’s` macht.

**Bilder über das Eltern-Feld.** Das ist nur gesetzt, wenn die Datei aus dem Beitrag heraus
hochgeladen wurde: 38 von 95 Spots hätten so gar kein Bild bekommen, ohne dass etwas kaputt
aussieht. Verlässlich sind die Mediathek-IDs aus dem Elementor-Datensatz
(`"url":"…","id":N`), die auf das Original in voller Auflösung zeigen. Die im Inhalt
sichtbaren Adressen sind beschnittene Elementor-Miniaturen und taugen nicht als Quelle.

**Ein `catch`, das seinen eigenen Fehler frisst.** Die Standbild-Erzeugung scheiterte bei
drei von drei Videos, und der Lauf meldete Erfolg, weil sie in einem leeren `catch` mit
einem Kommentar stand, warum das schon in Ordnung sei. Dieser ffmpeg-Build hat keinen
WebP-Encoder, und ffmpeg wählt den Encoder nach der Dateiendung. Aufgefallen ist es nur
beim Zurückholen der hochgeladenen Dateien.

## Die deutschen Texte schreiben (der lange Teil)

Das Einzige, was hier niemand ableiten kann. Ohne Entwurf überspringt der Import den Spot.

```bash
npm run wp:brief -- --limit 8   # Arbeitsvorlage für die nächsten acht
#   -> .wp-cache/drafts/<slug>.json schreiben
npm run wp:check                # gegen BRAND_VOICE prüfen
npm run wp:import -- --go       # als Entwurf in die Datenbank
```

Ein Entwurf hat sieben Felder: `subtype`, `shortDesc`, `general`, `insiderTip`, `sectionA`,
`sectionB`, `locationText`. Der Rest kommt aus der Quelle.

**Eher zu lang ansetzen.** Beim Schreiben landet man verlässlich rund 15 % unter dem, was
man schätzt: Wer 60 Wörter im Gefühl hat, tippt 50. BRAND_VOICE will bei einer Aktivität
60 bis 80, bei Food etwa 50. Also im Kopf auf 65 bis 70 zielen. In den ersten Chargen
kostete das zwei bis drei Nachbesserungsrunden pro Charge, und zwar nur wegen der Wortzahl.

**Die Gehzeit im Text muss die aus dem Feld sein.** `wp:brief` druckt sie deshalb ganz
oben. Ein Spot, der „50 min" anzeigt und „gut zwei Stunden" schreibt, ist schlimmer als
einer ohne Angabe.

**Der Gaisberg-Fall kommt öfter.** Die alte Linie zeichnet oft den Aufstieg vom Tal,
während der alte Text alle mit der Bergbahn hochfahren lässt (Gaisberg, Almwelt Lofer,
Asitz). Beides ist für sich richtig, es sind zwei verschiedene Ausflüge. Der Text folgt der
LINIE, weil das Dauer-Feld aus ihr gerechnet ist; die Bahn wird als der andere Weg zum
selben Ort erwähnt.

**Der Insider-Tipp steht in der Ich-Form des Locals**, und der steht in der Vorlage. Ohne
Namen ist es Anton. Toni ist die KI und nie ein Local.

Stand: 81 von 95 geschrieben.

## Was der Import NICHT entscheidet

**Subtyp**, wo die alte Seite keinen Marker hatte, die **24 Spots ohne zuordenbare
Kategorie** (Burgen, Parks, Stadt-Sehenswürdigkeiten — dafür gibt es keine Reihe), die
**Routen-Stummel**, und das **Veröffentlichen**. Alles landet als Entwurf; das Publish-Gate
in `saveSpot` verlangt ohnehin Ort und vollständige Übersetzungen.

Übernommen sind dagegen: Koordinaten, Parkplätze, Pro-Flag, Emoji, Quick-Facts,
Google-Place-IDs, Telefonnummern, Ticket-Links, Seenamen, Fotos, Videos, 60 Routen und 71
von 95 Kategorien.

Der Lücken-Report (`.wp-cache/report.md`) listet je Spot, wo etwas fehlt.
