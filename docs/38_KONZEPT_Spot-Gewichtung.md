# Spot-Gewichtung: Stufen + Abwechslungs-Regel

Stand: 2026-07-28 · Code: `src/lib/explore-ranking.ts` · Migration: `0059_sort_weight_tiers.sql` · Prüfung: `npm run ranking:check`

## Das Problem

Bis 07/2026 hatte jeder Spot eine frei vergebene Zahl (`spots.sort_weight`), und **jedes**
Explore-Regal sortierte nach derselben Zahl. Zwei Folgen:

1. **Nicht wartbar.** Bei 100 Spots heißt eine globale Zahl, 100 Werte gegeneinander
   abzuwägen. Das kann niemand im Kopf halten, und jede Neuanlage wirft die Frage auf
   „größer oder kleiner als welche der 99 anderen?"
2. **Eintönige Seite.** Der stärkste Spot stand in *jedem* seiner Regale ganz vorne.
   Beispiel Hochkeil: Platz 1 bei den Community-Favoriten UND Platz 1 bei den leichten
   Wanderungen, direkt untereinander. Die Seite fühlt sich an, als gäbe es nur fünf Spots.

## Die Lösung in einem Satz

Der Admin vergibt pro Spot **eine von vier Stufen** (bewertet den Spot für sich, nicht
gegen andere); die Reihenfolge **je Regal** rechnet der Server und sorgt dabei für
Abwechslung zwischen den Regalen.

## Baustein 1: Die vier Stufen

| Wert | Stufe | Bedeutung |
|---|---|---|
| 3 | Highlight | Das Beste vom Land, darf in den Regalen vorne stehen |
| 2 | Stark | Sehr gut, vordere Hälfte |
| 1 | Normal | Standard für jeden guten Spot (Default für neue Spots) |
| 0 | Zurückhaltend | Füllt Regale auf, steht hinten |

Die Stufen wohnen **weiter in `spots.sort_weight`** (Check-Constraint 0..3, Migration
0059). Bewusst keine neue Spalte: Alle bestehenden Sortierungen (Admin-Listen,
Gespeichert-Seite, Toni) funktionieren unverändert, es gibt keine zwei fast gleichen
Wahrheiten. Das Admin-Formular zeigt statt des Zahlenfelds einen Stufen-Wahlschalter
mit Klartext (`WEIGHT_TIERS` in `explore-ranking.ts` ist die eine Quelle für Werte,
Namen und Erklärtexte).

Die Migration hat die Alt-Werte der Reihenfolge nach in die Stufen 1..3 eingeteilt
(niemand wurde auf „Zurückhaltend" abgewertet, das soll ein Admin entscheiden).
**Einmal drüberschauen und nachjustieren.**

## Baustein 2: Die Abwechslungs-Regel

`rankShelves()` rechnet je Saison, Regal für Regal in ihrer Anzeige-Reihenfolge
(`categories.sort_order`):

1. Im **ersten Regal** zählt nur die Stufe. Die Top-Kategorie zeigt wirklich das Beste.
2. Wer einen der ersten **3 Plätze** bekommt (`TOP_SLOTS`, das ist beim Aufklappen des
   Sheets ohne Wischen sichtbar), gilt ab da als „schon vorne gewesen".
3. In jedem weiteren Regal gilt: **erst** die Spots, die noch nicht vorne waren (nach
   Stufe), **dann** die schon gezeigten (nach Stufe), **ganz hinten** die
   Zurückhaltenden. Jedes Regal bekommt frische Gesichter, aber ein Highlight fällt nie
   hinter die Füller und verschwindet nie aus seinem Regal.
4. Feinsortierung bei gleicher Stufe: neuere Spots zuerst (frischer Inhalt zeigt sich
   von selbst), dann der Slug. Deterministisch, kein Zufall: Das Ergebnis liegt im
   Katalog-Cache (`getExploreData`), Zufall hieße eine andere Seite nach jeder
   Cache-Erneuerung.

Sommer und Winter sind getrennte Seiten und rechnen getrennt.

Hochkeil-Beispiel danach: Platz 1 bei den Community-Favoriten; bei den leichten
Wanderungen stehen erst die starken Wanderungen, die noch nirgends vorne waren, der
Hochkeil kommt ein paar Plätze später.

## Wo was passiert

- **Rechnung:** `src/lib/explore-ranking.ts`, reine Funktion ohne Imports, läuft einmal
  serverseitig im gecachten Katalog (`queryExploreData` in `src/lib/spots.ts`). Gesperrte
  Pro-Spots ranken unter ihrem Tarn-Slug (`locked-N`), deshalb rechnet die Funktion NACH
  dem Blanking.
- **Anzeige:** `Explore.tsx` schlägt nur noch `cat.slugs` nach. Wer dort wieder selbst
  sortiert, holt das Problem zurück.
- **Admin:** Stufen-Wahlschalter in `SpotForm.tsx` (unter „Erweitert");
  `saveSpot` klemmt auf 0..3, der DB-Constraint ist die letzte Linie.
- **Prüfung:** `npm run ranking:check` importiert die echte Funktion und prüft jedes
  Versprechen dieses Dokuments einzeln (Hochkeil-Fall, Top-3-Grenze, Saison-Trennung,
  Determinismus).

## Bewusst NICHT gebaut

- **Pro Regal von Hand sortieren** (Drag & Drop je Kategorie): maximale Kontrolle, aber
  bei 100 Spots × mehreren Regalen genau die Fleißarbeit, die weg soll.
- **Automatik aus Nutzungsdaten:** dafür ist die Datenbasis noch zu dünn. Möglicher
  späterer Feinschliff: Merk-Zahlen (`analytics`, docs/34 §H) als Feinsortierung
  *innerhalb* gleicher Stufen, statt `createdAt`. Die Stufen und die Abwechslungs-Regel
  bleiben davon unberührt.
