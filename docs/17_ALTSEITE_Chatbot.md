# Alt-Code-Analyse #8 — KI-Chatbot „Toni" (AI Travel Planner)

Quelle: Screenshot + System-Prompt (gebaut mit **AI Engine / mwai** WordPress-Plugin, Knowledge Base).
Stand: 2026-06-21. Gegenstück zu `16_ALTSEITE_KI-Suche.md`.

---

## 1. Was es ist
Ein **konversationeller Chatbot** (Multi-Turn) als schwebendes Chat-Widget. Persona: **„Toni" – AI Travel Planner**, sympathischer Insider-Reiseplaner fürs Salzburger Land. Anders als die Freitext-Suche („Anton", Single-Shot + Karten-Karussell) ist das ein **echter Dialog** mit Verlauf.

> ⚠️ **Zwei Personas im Bestand:** Freitext-Suche = **„Anton"**, Chatbot = **„Toni"**. Fürs Neubau (eine vereinte KI) muss **ein** Name/Persona gewählt werden. → Frage an Anton.

## 2. UI (Screenshot)
- Schwebendes Chat-Fenster, **roter Header** mit Avatar + „AI Travel Planner / Toni" + Close-X.
- Nachrichten-Bubbles: **User = rot rechts**, **Bot = hellgrau links**. Spot-Namen **fett**, mit Inline-Link „Mehr erfahren".
- Eingabe: „Stelle irgendeine Frage…" + Senden-Button. Unten **Datenschutz-Hinweis** (Chat-Nutzung = Zustimmung).
- Begrüßung: „Servus! Ich bin Toni – dein persönlicher Reiseplaner. 😍 …"

## 3. System-Prompt (Kernlogik — übernehmen)
- **Rolle:** Toni, Insider-Reiseplaner; locker, duzen, **kurz** (max. 2–3 Sätze/Spot, **max 120 Wörter**, max **EINE** Rückfrage am Ende, Emojis sparsam 🥾🥨🏞️☀️).
- **Fokus/Abgrenzung:** EINZIGE Kompetenz = Reise-/Freizeitplanung Salzburger Land. **Strikte Ablehnung** nur bei klar themenfremden Aufgaben (Kochrezepte, Texte/Masterarbeiten, Programmieren, Hausaufgaben, Übersetzungen) — mit fester Block-Antwort.
- **Interpretations-Regel:** vage Stichworte („4 Tage mit Zug", „Regen", „mit Kindern") **immer** als Salzburg-Reisewunsch deuten, nicht abblocken.
- **Wissen:** primär **Knowledge-Base-Kontext** (AI-Engine-Embeddings über Spot-Inhalte); sonst Allgemeinwissen über Salzburg — **nie erwähnen, dass Daten fehlen / dass in einer DB gesucht wird**.
- **Link-Pflicht (HTML):** empfohlene Spots, die im Kontext existieren, **müssen** als HTML-`<a>` „Mehr erfahren" verlinkt werden; **nie** rohe URLs; kein Kontext-Link → Ort ohne Link nennen.
- **Lokale Sicherheits-Regeln:** **Bade-Verbot** (Jägersee, Leopoldskroner Weiher, Bluntauseen); **keine Outdoor-Tipps bei Unwetter**. → identisch zur Regel-Engine der Freitext-Suche (Doc 16) → **eine** gemeinsame Regelquelle.

## 4. Konsequenzen / Neubau (zusammen mit Doc 16)
Beide KI-Teile jetzt vollständig bekannt → **Merge-Plan konkret:**
1. **EINE konversationelle Claude-Assistenz** mit **Tool-Calling**:
   - Chat wie „Toni" (Dialog, Scope-Regeln, kurze Antworten).
   - Tool `search_spots(wish)` → liefert passende Spots (Logik/Anti-Halluzination aus Doc 16) → UI rendert **Spot-Cards** *und/oder* Inline-Links. So sind „frei chatten" und „Spots vorschlagen" **dieselbe** KI, kein Moduswechsel.
2. **Local Knowledge** = Spot-Inhalte als **Embeddings (pgvector in Supabase)** für Retrieval **oder** via Tool direkt aus DB. Bei 60–70 Spots beides machbar; Embeddings sauberer fürs Chat-Wissen.
3. **System-Prompt** (Scope, Interpretation, Link-Pflicht, kurze-Antwort-Regeln, Block-Antwort) **1:1 als Basis übernehmen**, auf Claude anpassen.
4. **Sicherheits-Regeln (Baden/Unwetter)** zentral pflegen (Regel-Tabelle), greifen für **Chat UND Vorschläge**.
5. **Free-Limit** gilt für die vereinte KI (Nachrichten/Suchen pro Tag) → Paywall-Trigger wie gehabt.
6. **UI:** Chat-Widget + Card-Rendering kombinieren; ein Eingabefeld, verständlich für neue User (Antons Wunsch).

## 5. Entscheidungen (2026-06-21, Anton)
- ✅ **Persona = „Anton"** (eine vereinte KI, authentisch/local). Avatar noch wählen.
- ✅ **Anzeige = beides je nach Situation:** Spot-Cards (klare Wünsche) **und** Inline-Links im Fließtext — die KI entscheidet.
- ✅ **Voice (STT) bleibt** — fällt unters Free-Limit. STT-Anbieter in Architektur wählen (Whisper o.ä., entkoppelt vom Chat-Modell Claude).

## 6. Offen
- [ ] Chat-**Verlauf speichern** (pro eingeloggtem User) vs. pro Session flüchtig? → Vorschlag in Architektur.
