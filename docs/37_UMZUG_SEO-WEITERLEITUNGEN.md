# Umzug auf salzguide.com: die alten Adressen retten

Die alte WordPress-Seite und diese App benutzen völlig verschiedene Adressen. Beim Umzug
behält die Domain ihren Namen, aber jeder einzelne Pfad ändert sich:

    https://www.salzguide.com/alle/almkanal/        ->  /de/spot/almkanal
    https://www.salzguide.com/en/all/almkanal-2/    ->  /en/spot/almkanal
    https://www.salzguide.com/wassertemperaturen-salzburger-seen/  ->  /de/wasser

Ohne Weiterleitung ist für Google jede dieser Adressen am Umzugstag tot, und die Wertung,
die sie über Jahre gesammelt haben, zieht nicht mit, sondern verfällt. Google verlangt
dafür eine dauerhafte Weiterleitung **je alter Adresse** und rät ausdrücklich davon ab,
viele alte Adressen auf eine unpassende Seite zu werfen — das wertet es als „Soft 404".

Die Regeln stehen in `src/lib/legacy-redirects.ts`, jede Zeile mit ihrer Begründung.
Geprüft wird mit `npm run redirects:check`.

## Was auf der alten Seite überhaupt liegt

Nicht geschätzt, sondern aus ihren fünf Sitemaps gezogen: **254 Adressen**.

| Bereich | Anzahl | Ziel |
|---|---|---|
| Deutsche Spots `/alle/<slug>/` | 94 | `/de/spot/<slug>` |
| Deutscher Spot `/aussichtspunkte/dom-zu-salzburg/` | 1 | `/de/spot/dom-zu-salzburg` |
| Englische Spots `/en/all/<slug>-2/` | 74 | `/en/spot/<slug>` |
| Englische Spots unter anderer Kategorie | 2 | `/en/spot/<slug>` |
| Weekly-Beiträge | 25 | `/de/events` |
| Kategorie- und Autoren-Archive | 19 | `/de/explore` bzw. `/en/explore` |
| Feste Seiten (AGB, Wir, Merkliste, Mitgliedschaft …) | 23 | je einzeln |
| Themenseiten | 6 | je einzeln |
| Bewusst ohne Weiterleitung | 6 | 404 |

**Der wichtigste Fund war eine Adresse, die in keiner Sitemap steht.** `/impressum/`
antwortet mit 200, taucht aber nirgends auf, weil Pflichtseiten üblicherweise auf noindex
stehen. Wer die Liste allein aus der Sitemap zieht, verliert genau diese Sorte Seite.

## Die Spots: eine Regel statt einer Liste

Alle 95 Spots der neuen Seite tragen **denselben Slug** wie ihr alter WordPress-Beitrag.
Deshalb steht in der Konfiguration keine Slug-Liste, sondern ein Muster. Eine Liste würde
bei jedem neuen oder umbenannten Spot veralten, ohne dass es jemandem auffällt.

Auf Englisch hat WordPress durchweg ein `-2` angehängt, weil der deutsche Beitrag den Slug
schon belegt hatte. Das gilt **ausnahmslos** für alle 76 englischen Spot-Adressen
(nachgezählt), und alle 76 treffen einen Spot, den es heute noch gibt. Das `-2` ist
gleichzeitig das Merkmal, das die Regel ungefährlich macht: `/en/category/waterfalls/`
endet nicht darauf und wird nicht erfasst.

Der Doppelname-Fall ist mitgeprüft: `hangar-7-2` muss zu `hangar-7` werden, nicht zu
`hangar`. Das erledigt das Muster von selbst, weil es bis zum letzten `-2` liest.

## Drei technische Entscheidungen

**Die Regeln stehen in `next.config.ts`, nicht im Proxy.** Die dokumentierte Reihenfolge in
Next ist `headers` → `redirects` → Proxy. Unser Proxy ist das Sprach-Routing von next-intl:
Er sieht einen Pfad ohne Sprach-Präfix und schiebt eines davor. Lägen die Regeln dahinter,
käme `/alle/gaisberg/` dort schon als `/de/alle/gaisberg` an, und **keine einzige Regel
würde je greifen**.

**301 statt Nexts üblichem 308.** Google behandelt beide gleich. Aber 301 versteht jedes
Log-Werkzeug, jeder SEO-Crawler und jeder alte Client ohne Rückfrage. Der einzige Vorteil
von 308 ist, dass es die HTTP-Methode erhält, und diese Adressen werden ausschliesslich per
GET abgerufen.

**Die Reihenfolge in der Liste ist Bedeutung, nicht Geschmack.** Next nimmt den ersten
Treffer. Die drei Spots ohne Nachfolger stehen deshalb VOR der allgemeinen Spot-Regel —
sonst würde die sie auf eine Spot-Adresse leiten, die es nicht gibt, und aus einer sauberen
404 würde eine 301 auf eine 404.

## Zwei Sprünge, und warum das in Ordnung ist

WordPress hängt an jede Adresse einen Schrägstrich. Next normalisiert den mit einem
**eigenen 308**, bevor unsere Regeln überhaupt drankommen:

    /alle/gaisberg/  --308-->  /alle/gaisberg  --301-->  /de/spot/gaisberg  --200

Google folgt bis zu zehn Sprüngen und empfiehlt höchstens drei. Zwei ist also in Ordnung,
und der Zwischenschritt lässt sich nicht wegkonfigurieren, ohne die Schrägstrich-Behandlung
der ganzen App selbst zu übernehmen. Das Prüf-Skript **misst** die Kette, statt sie
anzunehmen, und schlägt ab vier Sprüngen an.

Dieser Punkt hat die Prüfung selbst einmal belogen: Sie rief anfangs `/alle/gaisberg` ohne
Schrägstrich ab und meldete zufrieden „längste Kette: 1". Im Google-Index steht aber die
Form MIT Schrägstrich. Seitdem prüft sie die Originalform.

## Was bewusst 404 bleibt

Google sagt es selbst: Inhalte ohne Nachfolger sollen 404 oder 410 liefern, nicht
irgendwohin zeigen.

- `/elementor-hf/*` (4 Adressen) — Kopf- und Fusszeilen-Vorlagen des Seitenbaukastens,
  die nie eine Seite waren und nie hätten indexiert werden dürfen.
- Vier Vorlage- und Test-Beiträge (`food-spot-template`, `outdoor-spot-template`,
  `werbung-anzeige-template`, `video-maker-test`) — stehen in keiner Sitemap.
- `/feed/` — ein RSS-Feed gehört nicht auf eine HTML-Seite geleitet. Wer ihn abonniert
  hat, soll einen Fehler sehen und nicht stumm eine Startseite geliefert bekommen.

Zwei Adressen brauchen keine Regel, weil sie gleich heissen: `/` und `/en/explore/`.

## Die Startseite

`/` bleibt `/`. Das Sprach-Routing leitet von dort mit **307** auf die erkannte Sprache
(`/de`, `/en`, …). Das ist Absicht und soll so bleiben: Ein dauerhafter 301 würde im Browser
für immer zwischengespeichert, und wer einmal auf `/de` gelandet ist, käme nie wieder auf
`/en`. Die Zuordnung für Google übernehmen die `hreflang`-Angaben inklusive `x-default`, die
`alternatesFor()` auf jeder Seite setzt.

## Am Umzugstag

1. **Domain in Vercel.** `salzguide.com` als Produktions-Domain, `www.salzguide.com`
   zusätzlich als Weiterleitung darauf. Heute ist es umgekehrt: `salzguide.com` leitet mit
   302 auf `www`, und alles, was Google kennt, steht auf `www`. Die alten `www`-Adressen
   kosten dadurch einen Sprung mehr (drei statt zwei), das bleibt im Rahmen.
   `NEXT_PUBLIC_SITE_URL` in Vercel gleichzeitig auf `https://salzguide.com` setzen, sonst
   entscheidet `VERCEL_PROJECT_PRODUCTION_URL` allein.
2. **Prüfen, sobald die Domain hängt:**
   `npm run redirects:check -- --live https://salzguide.com`
   Das ruft alle 248 Adressen wirklich ab und vergleicht, wo sie ankommen.
3. **Search Console:** die neue Property anlegen, `sitemap.xml` einreichen, die alte
   Sitemap stehen lassen, bis die Adressen umgeschrieben sind.
4. **Weiterleitungen bleiben.** Google nennt ein Jahr als Untergrenze. Es gibt keinen
   Grund, sie je zu entfernen: Es sind 41 Zeilen, und sie kosten nichts.

## Das Prüf-Skript

    npm run redirects:check                    Regeln + Bestand (aus dem Cache)
    npm run redirects:check -- --sitemap       Adressliste frisch von der alten Seite
    npm run redirects:check -- --live <URL>    jede Adresse wirklich abrufen

Es findet vier Fehlerarten, die alle harmlos aussehen: eine Regel, die von einer
allgemeineren verdeckt wird und nie greift; ein Ziel, das es gar nicht gibt (eine 301 auf
eine 404 ist schlechter als keine Weiterleitung); ein Spot-Ziel, dessen Slug nicht in der
Datenbank steht; und eine alte Adresse, an die niemand gedacht hat.

Die Regeln werden dabei **nicht nachgebaut**, sondern importiert und mit dem
`path-to-regexp` ausgewertet, das in Next selbst steckt. Ein eigener Muster-Abgleich wäre
eine zweite Auslegung derselben Zeichenkette — die interessante Frage ist ja gerade, was
Next daraus macht, nicht was das Skript meint.

Nachgewiesen, dass die Prüfung wirklich prüft: mit drei absichtlich eingebauten Fehlern
(totes Ziel, verdeckte Regel, Spot-Slug ohne Spot) meldet sie acht Beanstandungen und
bricht ab. Ohne diesen Gegentest ist ein grünes Häkchen nur ein grünes Häkchen.
