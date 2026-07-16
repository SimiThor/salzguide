# Konzept — KI-Texterstellung beim Spot-Anlegen (optimiert)

Quelle: Antons 2 bestehende Prompts (Aktiv + Gastro). Stand: 2026-06-21.
Ziel: Spot-Texte **direkt auf der Seite per KI** erzeugen, Anlegen **super einfach, intuitiv, schnell**.

---

## 1. Die SalzGuide-Marken-Stimme (das Wertvollste hier — zentral festhalten)
Diese Voice-Regeln gelten für **alle** Spot-Texte UND für die KI „Anton" (Chat) → **eine** zentrale „Brand-Voice"-Datei/Konstante.

- **Kumpel-Ton:** Schreib, als zeigst du einem guten Freund am Wochenende einen coolen Spot. Direkt, ehrlich, auf den Punkt, du-Form.
- **Zielgruppe:** 18–45, Locals & junge Reisende, allergisch auf Tourismus-Marketing.
- **🚫 Verbotene Reiseführer-/Märchen-Wörter:** „thront", „malerisch", „atemberaubend", „magisch", „verzaubert", „goldener Herbst", „episch", „Paradies" — plus keine übertriebenen Vergleiche („wie ein Infinity-Pool").
- **Show, don't sell:** „Es geht ordentlich in die Waden" statt „Das Terrain verwandelt sich in alpines Gelände".
- **Kurze, knackige Sätze. Wenige, treffende Adjektive.**
- **Varianz erzwingen:** konkrete Details DIESES Spots (Abzweigung, Hütte, markanter Fels) → beweist „wir waren selbst dort", kein generischer Natur-Content.
- **Fakten 100 % korrekt**, aber im Kumpel-Ton.

## 2. Die 6 Textabschnitte (= unsere Spot-Felder!)
Beide Typen liefern **exakt 6 Abschnitte**, die **1:1 auf unsere Datenmodell-Felder** mappen:

| # | Aktiv-Spot | Food-Spot | DB-Feld |
|---|---|---|---|
| 1 | Allgemeines (60–80 W) | Allgemeines (~50 W) | `general` |
| 2 | Insider-Tipp (~50 W) | Insider-Tipp (~50 W) | `insider_tip` |
| 3 | Dauer & Schwierigkeit (20–30 W) | Küche & Stil (~20 W) | `section_a` (typabhängig) |
| 4 | Beste Jahreszeit (~20 W) | Preisniveau (~20 W) | `section_b` (typabhängig) |
| 5 | Lage & Erreichbarkeit (20–30 W) | Lage & Erreichbarkeit (~20 W) | `location_text` |
| 6 | Kurzbeschreibung Startseite (5–8 W) | Kurzbeschreibung (5–8 W) | `short_desc` |

→ KI-Output wird **direkt in die Formularfelder** geschrieben.

## 3. Optimierungen ggü. den Original-Prompts (nicht blind übernehmen)
1. **JSON-Output statt Fließtext** → direkt in Felder einfüllbar, kein Parsen/Kopieren:
   `{"general":"…","insider_tip":"…","section_a":"…","section_b":"…","location_text":"…","short_desc":"…"}`
2. **Ein Prompt-Template, typgesteuert** (`type: activity|food`) statt zwei getrennter Texte → wartbar, eine Voice-Quelle. Abschnitte 3/4 + Zielgruppen-Nuance werden je Typ eingesetzt.
3. **Grounding gegen Halluzination (wichtig!):** Die Original-Prompts sagen „recherchiere Google-Reviews etc." — ein reiner API-Call **kann das nicht** und würde erfinden. Lösung:
   - **Echte Inputs mitgeben:** Name, Typ, Koordinaten, bei Food die **Google-Places-Daten** (Adresse, Bewertung, Öffnungszeiten — haben wir eh), bei Aktiv die **ORS-Routendaten** (Distanz, Höhenmeter, Start/Ende).
   - **Admin-Notizfeld** „Was du über den Spot weißt" (Stichworte) → fließt als Fakten ein.
   - Optional: **Modell mit Web-Recherche** (Claude mit Such-Tool) für offizielle Infos — sonst nur aus gegebenen Fakten schreiben.
   - Harte Regel: **nichts erfinden, das nicht in den Inputs steht** (wie KI-Suche Doc 16).
4. **Verbotene-Wörter-Liste als harte Regel** + Selbstcheck im Prompt.
5. **Pro Abschnitt regenerierbar** („nochmal", „kürzer", „lockerer") statt nur Komplett-Neugenerierung.
6. **Mehrsprachig nachgelagert:** Erst DE-Basis (Voice!), dann 1-Klick-Übersetzung (separat geplant) — Übersetzung muss Voice & Verbote ebenfalls einhalten.
7. **Auto-Quick-Facts** parallel: Dauer/Schwierigkeit-Vorschlag aus ORS (Doc 20), Preisniveau/Art teils aus Places → Felder vorbefüllt.
8. **Nie auto-publish:** KI schlägt vor → Admin liest/editiert → speichert. Vertrauen + Qualität.

## 4. Optimiertes Prompt-Design (Entwurf)
**System (konstant, = Brand-Voice §1):** Rolle „SalzGuide-Local-Autor", alle Voice- & Verbots-Regeln, „nur Fakten aus den Inputs, nichts erfinden", „Output ausschließlich gültiges JSON nach Schema".

**User (pro Spot):**
```
TYP: activity | food
SPOT: <Name>
BEKANNTE FAKTEN: <Admin-Notizen / Stichworte>
DATEN: <Koordinaten; ORS: Distanz/Höhenmeter/Start-Ende  ODER  Places: Adresse/Bewertung/Preisniveau/Öffnungszeiten>
ZIELGRUPPE: <activity: 25–45 Local/Reisende | food: 18–35 Social/Food>
```
**Output (striktes JSON):** die 6 Felder (typabhängige Keys section_a/section_b), Wortzahlen als Zielkorridor, keine Überschriften/Erklärtexte.

→ Voll deterministisch, direkt einfüllbar, mehrsprachig erweiterbar.

## 5. End-to-End „Spot anlegen" (super einfach, intuitiv, schnell)
Ein Flow im Admin-Dashboard, der alles bündelt:
1. **Name + Typ** wählen (activity/food + Unterkategorie).
2. **Karte:** Start/Ziel/Stops klicken → Auto-Route + Distanz/Höhen/Gehzeit/Schwierigkeit-Vorschlag (Doc 20). Bei Food/Punkt: 1 Pin (+ optional `place_id` für Öffnungszeiten/Telefon).
3. **Stichworte** ins Notizfeld („gratis parken hinterm Schloss, Pistazien-Croissant, …").
4. **„Texte mit KI erzeugen"** → 6 Abschnitte erscheinen in den Feldern (JSON → Felder), je Abschnitt **editier-/regenerierbar**.
5. **Quick-Facts** sind großteils vorbefüllt → nur prüfen.
6. **Bilder** hochladen (Hero + Inhalt).
7. **1-Klick-Übersetzen** in die Zielsprachen (separat geplant).
8. **Vorschau → Speichern/Veröffentlichen.**

→ Von „Name eintippen" bis fertiger, mehrsprachiger Spot in **wenigen Minuten**, ohne Copy-Paste aus ChatGPT.

## 6. Architektur-Auswirkung
- **Brand-Voice** als zentrale Konstante (Texte + Chat-KI „Anton" teilen sie).
- Server-Route `/api/admin/generate-spot-text` (Claude, JSON-Mode, Grounding-Inputs). Admin-only, rate-limited.
- Spot-Felder: `general, insider_tip, section_a, section_b, location_text, short_desc` (mehrsprachig).
- Greift in Übersetzungs-Pipeline + Quick-Fact-Autofill + Places/ORS-Grounding.
