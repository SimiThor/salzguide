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

**Ein Zahlenvergleich liest keine Wörter — sechs Routen endeten am Gipfel.** Beim
Gamskarkogel stand als alte Dauer „8 h **gesamt**". Der reine Aufstieg rechnet sich zu 7:55,
hin und zurück zu 13:35; der Schiedsrichter nahm also den Aufstieg, obwohl das Wort
„gesamt" wörtlich das Gegenteil sagt. Auf der Karte lag danach eine Linie, die oben aufhört,
und im Feld die Zeit für den halben Ausflug. Wer die Karte nicht daneben legt, merkt davon
nichts.

`npm run wp:there-and-back` zieht die sechs nach (Gamskarkogel, Lackenkogel, Tappenkarsee,
Oberhütte, Nockstein, Gollinger Wasserfall). Gemeinsam haben sie: kein Lift, kein Übergang,
das Ziel ist ein Stichweg. Damit ein neuer `wp:routes`-Lauf dieselbe Entscheidung trifft,
stehen die Slugs als `ALWAYS_DOUBLE` in `routes.ts` — die Gegenliste zu `NEVER_DOUBLE`.
Das Skript schreibt Datenbank UND `routes.json`, sonst dreht der nächste Import die
Verdoppelung wieder zurück.

**Nicht verdoppelt** werden Schmittenhöhe, Almenwelt Lofer, Spinnerin und Prinzensee (Bahn,
steht auch in den Texten), Kapuzinerberg, Bad Gastein und die Halleiner Altstadt
(Überschreitungen, die woanders herauskommen) und der Wiestalstausee (Uferstrasse, kein
Wanderziel).

**Die Rechnerei steht in `route-math.ts`.** `downsample` und `ascentDescent` standen vorher
wortgleich in `routes.ts` UND `import.ts`; zwei Kopien derselben Formel laufen auseinander,
sobald jemand nur eine anfasst.

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

Stand: 95 von 95 geschrieben, `wp:check` läuft sauber durch. Der Trockenlauf bereitet alle
95 Spots vor und überspringt keinen mehr. Was jetzt noch fehlt, ist `wp:import -- --go`.

## Kategorien nachziehen (`wp:categories`)

```bash
npm run wp:categories          # zeigt, was passieren würde
npm run wp:categories -- --go  # schreibt
```

Der Import ordnet nur zu, wo die alte WordPress-Kategorie die neue Reihe wirklich trifft.
Für „burgen", „parks", „sonstige" und „aussichtspunkte" gibt es kein Gegenstück, und eine
mechanische Zuordnung hätte die Hälfte falsch einsortiert. Die Liste in `categories.ts` ist
deshalb je Spot entschieden, nicht abgeleitet.

**Kategorien hängen an der SAISON, nicht am Spot.** Ein Spot mit `seasons =
["summer","winter"]` braucht in beiden Saisonen eine Reihe. Fehlt eine, verschwindet er im
Explore der anderen Saison, ohne dass irgendwo etwas kaputt aussieht: Dom, Mönchsberg und
Nonnberggasse waren nach dem Import nur im Winter sichtbar, weil der Winter-Marker griff
und die Sommer-Kategorie nicht. Der Trockenlauf zählt am Ende auf, wer in welcher Saison
noch ohne Reihe dasteht, und genau diese Zeile hat die Lücke gefunden.

**„City & Nearby Hills" war leer.** Die Reihe existierte von Anfang an, aber der Import
konnte nichts hineinlegen, weil die alte Seite dafür keine Kategorie hatte. 16 Stadt-Spots
lagen deshalb in keiner einzigen Reihe.

**Eine Reihe kommt neu dazu: „Aussicht & Kultur" (`summer/sights`).** Die alte Seite hatte
neun Reihen, drei davon haben in der neuen App kein Gegenstück: Burgen (2), Parks (2) und
Sonstige (4). Parks und die Stadt-Sehenswürdigkeiten passen in „City & Nearby Hills"; übrig
blieben eine Burg über dem Salzachtal, ein Aussichtspunkt daneben, eine Höhle im Saalachtal
und der Ortskern von Bad Gastein. Der Winter hat mit „Aussicht & Erholung" längst so eine
Reihe, dem Sommer fehlte sie. Das Skript legt sie an, schiebt die drei Reihen dahinter um
eine Position nach hinten und trägt die Titel in allen neun Sprachen ein.

**Die Sommerrodelbahn Abtenau bleibt bewusst ohne Reihe.** Sie stand unter „Sonstige" und
ist weder Aussicht noch Kultur. Sie in die neue Reihe zu legen, wäre genau der Griff, den
die Reihe verhindern soll. Sie ist über Karte und Suche auffindbar und wartet auf eine
Familien- oder Action-Reihe.

**Fünf Spots haben die Winter-Saison wieder verloren** (Goldegger See, Grosser Barmstein,
Hintersee Pinzgau, Jägersee, Ritzensee). Sie trugen sie nur, weil die alte Angabe
„Ganzjährig" hiess; gemeint war „hier ist im Winter nichts gesperrt", nicht „das ist ein
Winterausflug". Winterfotos hat keiner der fünf. Das ist dieselbe Regel wie bei der
Gastein-Karte, nur andersherum.

## Feld gegen Fliesstext prüfen (`wp:consistency`, `wp:facts`)

```bash
npm run wp:consistency              # stellt Feld und Text nebeneinander
npm run wp:consistency -- --only dauer
npm run wp:facts                    # zeigt die Korrekturen
npm run wp:facts -- --go            # schreibt sie
```

Die Felder kommen aus den Quick-Facts der alten Seite, die Texte sind neu geschrieben. Wo
die alte Seite danebenlag, steht es danach doppelt auf derselben Bildschirmseite. `wp:consistency`
zieht deshalb aus jedem Text die Stellen heraus, die eine Zeit, eine Schwierigkeit, eine
Jahreszeit oder eine Anreise nennen, und stellt sie neben das Feld.

**Es vergleicht bewusst NICHT automatisch.** Die Texte sagen „knapp vier Stunden", „eine
Stunde zwanzig", „ein bis zwei Stunden, wenn du dir Zeit lässt". Ein Parser, der daraus
Zahlen macht, liegt bei jeder dritten Formulierung daneben und meldet dann entweder
Fehlalarme, die man wegzuschauen lernt, oder er schweigt genau dort, wo es zählt. Die
Extraktion ist mechanisch, das Urteil steht in `facts.ts` — je Zeile mit dem Satz aus dem
Text, der sie trägt.

Gefunden wurden dabei: zwei Wanderungen, die als „mittel" ausgezeichnet waren und deren
eigener Text „kaum Höhenmeter" bzw. „20 Höhenmeter, sonst harmlos" sagt; drei Spots mit
„nur Auto", deren Text einen Bus nennt (Gaisberg: „Der Bus 151 fährt direkt rauf"); und die
Festung mit der Rohform `1h gesamt`, wo überall sonst `1 Std` steht. Dazu 26 leere Felder,
die der Text klar benennt — 13 Winter-Spots hatten weder Schwierigkeit noch Jahreszeit,
weil die alte Seite dort `vibe` statt `difficulty` führte.

**Die Anreise-Prüfung ist absichtlich grob und produziert Fehlalarme.** „Parken in der
Altstadt ist teuer" enthält das Wort Parken, meint aber das Gegenteil. Zwanzig Treffer, drei
davon echt: Das ist die richtige Richtung für eine Prüfung, deren Ergebnis ein Mensch liest.

## Die zwei Wander-Reihen

Der Import trennte nur nach dem Schwierigkeits-Feld der alten Seite („schwer" -> die andere
Reihe). Dort stand genau EIN Spot auf „schwer", also lagen 29 Touren in „Leicht & Mittel"
und eine allein in „Anspruchsvoll" — darunter der Gamskarkogel mit 1.600 Höhenmetern und
acht Stunden.

`wp:categories` trennt jetzt nach dem, was wir selbst gerechnet haben: **ab dreieinhalb
Stunden Gehzeit ODER ab 600 Höhenmetern.** Zwei Kriterien, weil keins allein reicht. Die
Gehzeit trennt Touren gleichen Aufwands an willkürlicher Stelle (Ellmautal 3:05,
Schuhflickersee 3:00), der Aufstieg übersieht den Tristkogel, der mit 925 Höhenmetern auf
12,8 Kilometern siebeneinhalb Stunden braucht. Ergebnis: 13 zu 17 statt 1 zu 29.

Die Reihen hängen an der Gehzeit, also gehört `wp:categories` nach jedem `wp:there-and-back`
noch einmal gelaufen. Die Oberhütte ist genau so hinübergerutscht.

Das Schwierigkeits-Feld bleibt davon unberührt. Es sagt etwas über das GELÄNDE, die Reihe
über den AUFWAND. Ein Weg kann technisch harmlos und trotzdem ein ganzer Tag sein, und beim
Gamskarkogel steht genau das im Text.

## Besuchsdauer für Spots ohne Route (`wp:visit-time`)

Bei einer Wanderung rechnet `geo.ts` die Dauer aus der Linie. Ein Museum, eine Therme oder
ein Platz hat keine Linie, und der Import liess das Feld deshalb leer: 24 Spots ohne jede
Zeitangabe, obwohl fast jeder Text eine nennt.

**Die Zahl kommt aus dem eigenen Fliesstext, nicht aus dem Gefühl.** In `visit-time.ts` steht
je Zeile das Zitat, das sie trägt. Wo der Text eine Spanne nennt, gilt die OBERE Zahl:
Gefragt ist, wie lange man braucht, um den Spot anzusehen und zu geniessen, nicht wie
schnell man durchkommt. „Ein halber Tag" zählt dabei nicht als obere Grenze, sondern als der
Ausnahmefall, den der Text danebenstellt (Mirabellgarten: „Eine Stunde reicht für einen
Rundgang" -> 1 Std).

**Drei Badeplätze hatten gar keine Zahl im Text.** Almkanal, Böndlsee und Hintersee: Wie
lange man dort bleibt, sagt kein Text. Sie bekommen zwei Stunden als Planungswert, und der
Satz dazu steht im ENTWURF, nicht im Skript. Text gehört in `.wp-cache/drafts`, sonst
überschreibt ihn der nächste Import.

**Schreibweise vereinheitlicht.** Sechs Punkt-Spots trugen die Rohform der alten Seite
(`2 h`, `1 h`). Es gibt jetzt nur noch die drei Formen, die `formatDuration` schreibt:
`N min`, `N Std`, `N Std N min`.

## Was der Import NICHT entscheidet

**Subtyp**, wo die alte Seite keinen Marker hatte, die **Kategorien ohne Gegenstück**
(siehe oben, `wp:categories` zieht sie nach), die **Routen-Stummel**, und das
**Veröffentlichen**. Alles landet als Entwurf; das Publish-Gate
in `saveSpot` verlangt ohnehin Ort und vollständige Übersetzungen.

Übernommen sind dagegen: Koordinaten, Parkplätze, Pro-Flag, Emoji, Quick-Facts,
Google-Place-IDs, Telefonnummern, Ticket-Links, Seenamen, Fotos, Videos, 60 Routen und 71
von 95 Kategorien.

Der Lücken-Report (`.wp-cache/report.md`) listet je Spot, wo etwas fehlt.

## Übersetzungen in die acht Zielsprachen (`wp:translate`)

Die 95 deutschen Texte sind 109.000 Zeichen. Mal acht Sprachen wären das über 700 bezahlte
API-Aufrufe, wenn man den Admin-Knopf „In alle Sprachen übersetzen" 95 Mal drückt. Deshalb
übersetzt hier die KI in der Sitzung (Abo), und das Skript ist nur Prüfer und Schreiber.

    npm run wp:translate                     Stand
    npm run wp:translate -- --todo 5         die nächsten 5 offenen Spots mit deutschem Text
    npm run wp:translate -- --check          alle abgelegten Dateien prüfen
    npm run wp:translate -- --go             prüfen UND schreiben
    npm run wp:translate -- --only a,b,c ... alles davon auf diese Spots eingegrenzt

Ablage: `.wp-cache/i18n/<slug>.json`, je Datei ein Objekt mit den acht Sprachcodes und
darunter denselben sieben Feldern wie in `.wp-cache/drafts/`. `.wp-cache/` ist ausgenommen,
das Repo ist öffentlich.

**Der Prompt-Kern in `admin-actions.ts` bleibt unangetastet.** Er ist weiter der Weg für
einzelne, spätere Spots. Was hier passiert, ist ein einmaliger Massenlauf.

### Geprüft wird maschinell, nicht durch Lesen

Eine Übersetzung, in der aus 1.042 Metern 1.024 werden, sieht beim Überfliegen richtig aus.
Genau deshalb liest das eine Maschine nach, und geschrieben wird erst, wenn ALLES sauber ist:

- **Zahlen.** Jede deutsche Zahl muss vorkommen, unabhängig von der Schreibweise: 1.100 =
  1,100 = 1 100. Verglichen wird die Ziffernfolge. Römische Zahlzeichen werden umgerechnet,
  weil die romanischen Sprachen Jahrhunderte so schreiben („XI secolo", „XIe siècle").
- **Gedankenstrich**, ausser Chinesisch. Zusätzlich läuft vor dem Speichern alles durch
  `stripEmDashFields()`. Ein Prompt ist eine Bitte, diese Funktion ist der Riegel.
- **Feld-Parität.** Wo Deutsch etwas sagt, sagt die Übersetzung etwas, und wo Deutsch
  schweigt, wird nichts dazuerfunden.
- **Länge.** Die Grenzen sind an den ersten 19 fertigen Spots GEMESSEN, nicht geschätzt:
  Chinesisch 29 bis 42 Prozent der deutschen Zeichenzahl, Koreanisch 46 bis 58, die
  lateinischen Sprachen 91 bis 113. Eine gemeinsame Schwelle für Chinesisch und Koreanisch
  war zu eng und meldete einen vollständigen chinesischen Text als zu kurz.

### Warum `--only` existiert

Damit die Arbeit auf mehrere parallel laufende Claude-Instanzen aufgeteilt werden kann, ohne
dass eine die halbfertigen Dateien der anderen als Fehler meldet. Jede bekommt ihre Slugs,
holt sich damit den deutschen Text, schreibt ihre Dateien und prüft nur ihre eigenen.
`--go` läuft danach EINMAL zentral über alles.

### Entscheidungen, die durchgehalten werden

- **Eigennamen bleiben stehen**, auch im Koreanischen und Chinesischen (Speicherteich,
  Getreidegasse 33a, Schloss Aigen). So macht es der Admin-Prompt auch; sonst driften
  später einzeln übersetzte Spots vom Bestand weg.
- **Beschreibende Titel werden übersetzt** (`Blick auf Hohenwerfen` -> `Vista sobre
  Hohenwerfen`), echte Namen nicht (`Asitz`, `Balkan-Grill Walter`).
- **Der Tipp bleibt in der Ich-Form.** Das ist Antons Stimme, nicht die eines Reiseführers.

### Was das Skript setzt

Je Sprache eine Zeile in `spot_translations` mit `source_hash = hashSpotTexts(de)`, und die
DE-Zeile bekommt dieselbe Marke. Erst damit gilt ein Spot als veröffentlichbar
(`translationsPublishable` in `spot-hash.ts`). Danach hängt der Katalog-Cache daran: Server
neu starten oder im Admin einmal speichern.

## Nachprüfen: was gemessen ist, und was nur behauptet (`wp:audit`)

    npm run wp:audit                Widersprüche, sprachliche Mängel, Nachschlage-Liste
    npm run wp:audit -- --dump en   Deutsch und Zielsprache Feld für Feld nebeneinander

`wp:consistency` stellt Feld und Text nebeneinander und **urteilt nicht**. Genau deshalb war
nie aufgefallen, dass drei Wanderungen die Kilometer der alten WordPress-Seite trugen,
während auf der Karte die gesnappte Linie liegt und die Gehzeit aus genau dieser Linie
gerechnet ist. `wp:audit` vergleicht, statt aufzulisten, und hat sie gefunden.

**Die wichtigste Trennlinie in diesem Skript** ist die zwischen dem, was eine Maschine wissen
kann, und dem, was sie nur für richtig hält. Länge, Höhenmeter und Dauer sind im System
gemessen, dazu gibt es ein Urteil. Ob ein Berg wirklich 2.051 Meter hoch ist oder ein Bus
noch dorthin fährt, steht nirgends in der Datenbank. Solche Angaben landen in der Liste
`NACHSCHLAGEN`, damit ein Mensch sie prüft, statt dass sie stillschweigend als wahr gelten.

**Zwei Fehlalarme waren mehr Arbeit wert als die Funde.** „mit Pause eher anderthalb" lässt
das Wort „Stunden" weg, und Hin-und-retour-Wege nennen einmal den reinen Anstieg und einmal
Auf plus Ab. Beides ist richtig. Eine Liste voller Fehlalarme schaut sich beim zweiten Mal
niemand mehr an, also löst die Prüfung beide selbst auf.

### Was das Nachschlagen fand, und wie es korrigiert wird

Zwei Skripte, weil die Fälle verschieden sind:

- **`wp:fix-numbers`** tauscht eine Zahl in ALLEN neun Sprachen und setzt die
  Aktualitäts-Marke neu. Deutsch allein zu ändern hiesse, den Widerspruch in acht Sprachen
  stehen zu lassen und sie gleichzeitig auf „veraltet" zu setzen. Die Schreibweisen leitet
  das Skript selbst ab: aus „2.300" werden „2,300", „2 300" und „2300".
- **`wp:fix-claims`** ändert eine Aussage, und zwar NUR auf Deutsch. Deutsch ist die Quelle;
  ändert sie sich, sollen die Übersetzungen veralten und danach neu geschrieben werden. Eine
  Übersetzung hier mitzuschreiben hiesse, sie an einer zweiten Stelle zu pflegen.

Jede Zeile in beiden Tabellen trägt ihren Grund und ihre Quelle. Wer später eine anzweifelt,
findet die Begründung daneben und muss nicht suchen.

### Muttersprachler-Durchgänge (`wp:apply-review`)

Acht Lektorate, eines je Zielsprache, über alle 95 Spots. Jeder Durchgang schreibt NUR
`.wp-cache/review/<lang>.json` mit seinen eigenen Feldern; zusammengeführt wird an einer
Stelle. Hätte jeder direkt in `.wp-cache/i18n/<slug>.json` geschrieben, hätte der letzte die
Arbeit der anderen sieben überschrieben, ohne dass es jemandem aufgefallen wäre.

Der Lauf ist wiederholbar: schon eingespielte Felder werden übersprungen, nicht beanstandet.
Sonst wären spätere Durchgänge nur einspielbar, indem man die früheren rückgängig macht.

**Reihenfolge, die man nicht vertauschen darf:** erst `wp:apply-review`, dann
`wp:translate --check` und `--go`, und ERST DANACH `wp:fix-numbers`. Die Durchgänge haben den
Bestand gelesen, bevor die Zahlen korrigiert waren; umgekehrt holt der Patch die alte Zahl
zurück.
