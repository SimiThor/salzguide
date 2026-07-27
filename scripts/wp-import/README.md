# Inhalts-Übernahme von der alten WordPress-Seite

Einmaliger Import der 98 Spots von `salzguide.com` (WordPress) in die neue App.
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
**Nach dem Import widerrufen.**

## Ablauf

```bash
npm run wp:fetch     # alte Seite -> .wp-cache/  (102 Beiträge + 775 Mediendateien)
npm run wp:extract   # .wp-cache/ -> .wp-cache/source/*.json + report.md
```

Beide Schritte sind wiederholbar und schreiben nur in `.wp-cache/` (gitignoriert).
An der alten Seite ändert nichts etwas: Es wird ausschliesslich gelesen.

## Warum es so gebaut ist, wie es gebaut ist

**`context=edit` statt normalem Abruf.** 40 der 102 Spots liegen hinter der Paywall
(Simple Membership). Das Plugin hängt am `the_content`-Filter, deshalb liefert der
öffentliche Abruf dort nur den Kauf-Hinweis. Ein Anwendungspasswort allein hilft nicht,
weil das Plugin seine eigene Sitzung prüft und nicht den WordPress-Login. `context=edit`
gibt `content.raw` zurück, also den Inhalt aus der Datenbank, bevor ein Filter ihn sieht.
Nebenbei ist der Rohinhalt der bessere Ausgangsstoff: sauberes HTML statt Elementor-Divs.

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

## Zwei Fallen, die hier schon zugeschnappt sind

**Der Titel als Quick-Fact.** Die Fact-Leiste endet beim Titel, nicht erst bei der ersten
Sektion. Ohne diese Grenze las der Automat `Schmittenhöhe` als Fact ein, und die unscharfe
Auflösung machte daraus klaglos die Gegend `Zell am See`. Falsch, aber plausibel, also
unsichtbar. Der Vergleich läuft über `normalizeText`, weil WordPress' `wptexturize` beim
Rendern aus `Maier's` ein `Maier’s` macht.

**Bilder über das Eltern-Feld.** Das ist nur gesetzt, wenn die Datei aus dem Beitrag heraus
hochgeladen wurde: 38 von 98 Spots hätten so gar kein Bild bekommen, ohne dass etwas kaputt
aussieht. Verlässlich sind die Mediathek-IDs aus dem Elementor-Datensatz
(`"url":"…","id":N`), die auf das Original in voller Auflösung zeigen. Die im Inhalt
sichtbaren Adressen sind beschnittene Elementor-Miniaturen und taugen nicht als Quelle.

## Was der Import NICHT entscheidet

Kategorien, Google-Place-IDs, das Pro-Flag und das Veröffentlichen bleiben Handarbeit.
Alles landet als Entwurf. Der Lücken-Report (`.wp-cache/report.md`) listet je Spot, wo
etwas fehlt.
