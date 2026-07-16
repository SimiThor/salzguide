# Konzept — Events / „SalzGuide Weekly"

Quelle: `ab 15. Juni | SalzGuide.pdf` (aktueller Wochenkalender) + bestehende Skill `salzguide-weekly-calendar`.
Anforderung (Anton): Events anzeigen, **per KI ausführlich recherchiert anlegen**, **easy verwalten**, Design ähnlich, aber **nicht zu wartungsaufwändig**.
Stand: 2026-06-21.

---

## 1. Ist-Stand (aus PDF)
„**SalzGuide Weekly — Was geht in Salzburg?**", Wochenansicht (z.B. 15.–21. Juni):
- **Hero-Bild** + **Datums-Pill** (Wochenspanne).
- **Kategorie-Filter-Pills:** Alle Events · **Highlights** · **Party** · **Tradition** · **Kultur** · **Kids**.
- Events **nach Tag gruppiert** (Montag · 15.06. …), pro Event eine Card: Emoji/Icon, **Titel**, **Datum/Uhrzeit**, **Location**, **Kurzbeschreibung**, optional **„Highlight"-Badge**.
- Aktuell: HTML-Snippet (`sgw-card` etc.), per Skill manuell gepflegt/gefiltert.

## 2. Ziel im Neubau
Events als **echte DB-Entitäten** + **KI-gestütztes Anlegen** + **automatische Selbstpflege** (zeitgesteuert ablaufend) → minimaler Wartungsaufwand.

## 3. Datenmodell
`events`-Tabelle: `id, title, start, end, location_name, coords?(optional Karte), category (highlights|party|tradition|kultur|kids), is_highlight, description, source_url, image?, status (draft|published), seasons?/lang-Felder (DE/EN…)`.
- **Zeitbasiert:** Events nach `end` automatisch ausblenden/archivieren → Kalender bleibt **selbst-aktuell**, ohne manuelles Aufräumen.

## 4. KI-gestütztes Anlegen (der „easy"-Teil)
- **Wöchentlicher Recherche-Lauf (geplant/Cron):** Claude **mit Web-Recherche** sammelt Events für die kommende Woche (offizielle Veranstaltungskalender, TVB, Locations, Social) → erstellt **Draft-Events** (Titel, Zeit, Location, Kategorie, Kurzbeschreibung im Brand-Voice, Quelle).
- **Admin-Review:** Liste der Draft-Events → schnell prüfen, Kategorie/Highlight setzen, **1-Klick veröffentlichen** (oder verwerfen). Kein manuelles Zusammensuchen.
- **Einzel-Event per KI:** Admin gibt Link/Stichwort → KI füllt Felder (wie Spot-Texterstellung, Doc 27) + Kategorie-Vorschlag.
- **Anti-Halluzination/Grounding:** nur aus recherchierten Quellen (Quelle speichern), Datum/Zeit/Ort verifizierbar; im Zweifel „Draft" lassen.
- **Klassifizierung** (Highlights/Party/Tradition/Kultur/Kids) übernimmt die KI als Vorschlag (Logik aus bestehender Weekly-Skill als Referenz).

## 5. Anzeige (Design ähnlich, schlank)
- Wochenansicht, nach Tag gruppiert, Kategorie-Filter-Pills — wie heute, aber als saubere Komponente.
- **Wo:** Sektion innerhalb **Entdecken** (oder eigener Einstieg „Weekly") — leicht erreichbar, nicht überladen.
- Optional: Event mit Koordinaten → Pin auf der Explore-Karte.
- **KI „Anton" kennt Events** (Scope deckt Events ab, Doc 17) → „Was geht dieses Wochenende?" beantwortbar.

## 6. „Nicht zu wartungsaufwändig" — wie sichergestellt
1. **Auto-Ablauf** vergangener Events (zeitbasiert) → kein Aufräumen.
2. **Wöchentlicher KI-Draft** → Anton nur noch **prüfen & freigeben** statt recherchieren.
3. **Wiederkehrende Events** als Vorlage/Serie (z.B. wöchentlicher Markt) → einmal anlegen.
4. Schlanke Felder, kein Über-Engineering (keine Ticketing-Tiefe; optional Affiliate-Link wie Action-Tiles).

## 7. Architektur-Auswirkung
- `events`-Tabelle + Admin-CRUD + KI-Draft-Route + **Scheduled Weekly Research** (Cron).
- Teilt **Brand-Voice** (Doc 27) und **Übersetzungs-Pipeline**.
- Optional Karten-Pin (teilt `<SpotMap>`).
- Bestehende `salzguide-weekly-calendar`-Skill-Logik (Klassifizierung/Filter) als Referenz fürs KI-Klassifizieren.

## 8. Offene Frage
- [ ] Events **nur Salzburg-Stadt** oder ganzes Land? Reichweite der wöchentlichen Recherche (Quellen-Set).
- [ ] Eigener „Weekly"-Tab oder Sektion in Entdecken? (Empfehlung: Sektion/Einstieg in Entdecken, kein 5. Haupt-Tab → Nav schlank halten.)
