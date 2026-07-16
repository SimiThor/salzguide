# Alt-Code-Analyse #7 — KI-Freitext-Spot-Suche ("Anton AI" / KI-Guide)

Quelle: `Ki_Auswahl_Sommer_Freitext_teil_1–4` (Backend + 3027-Zeilen-Frontend + Regel-Engine + Voice).
Stand: 2026-06-21.

---

## 1. Was es ist
Ein „Concierge"-Erlebnis: User beschreibt im Freitext (oder per **Sprache**) einen Wunsch → bekommt bis zu **5 passende Spots** mit KI-geschriebenen Mini-Beschreibungen + einer persönlichen Intro-Zeile in **Antons Stimme**. Gebrandet als „**Anton, aus Salzburg**" / „SalzGuide AI". Subtitle: *„Frag mich wie ChatGPT – nur dass ich Salzburg wirklich kenne."*

> 🔑 Das ist die **Spot-Empfehlungs-Hälfte** der KI. Es gibt laut Code-Kommentar zusätzlich einen **separaten `/chat`-Chatbot**. Antons Briefing-Ziel: **beide in EINER KI** vereinen (normaler Chat + Spot-Vorschläge), verständlich für neue User. → Wichtig fürs Neubau-Konzept.

---

## 2. Frontend (Teil 2, Shortcode `[salzguide_kifree]`)
Mehrstufiger Flow, sehr aufwändig animiert (iOS-Look: Glow, schwebende Foto-Cards, Aura, Orb):
1. **Start-Screen:** Titel, Subtitle, ✨-Button „Los geht's".
2. **Input-Screen:** Anton-Avatar-Header, Frage „**Worauf hast du Bock?**", Textarea (**max 800 Zeichen**, Zähler, rotierende Beispiel-Placeholders), **🎤 Voice-Button** (Aufnahme→Whisper), **Mood-Pills** (Schnell-Prompts), Submit „Spots finden", **Datenschutz-Hinweis** (Verarbeitung über OpenAI).
3. **Loading-Screen:** Orb + rotierende Texte („Checke deine Vibes…", „Scanne unsere Secret Spots…", „Stelle dein Line-up zusammen…").
4. **Results:** Anton-Intro-Zeile + **Karussell** mit Spot-Cards (identischer Card-Stil wie Explore, inkl. Pro-Blur/Badge).
5. **Sonder-States:** Paywall („Dein Gratis-Limit ist erreicht" → Pro-CTA), Empty („Dafür haben wir noch keinen Spot"), Related („Nicht ganz, aber knapp dran").

**Mood-Pills (Beispiele):** ☕️ Coffee Vibes · 💦 Abkühlung · 🌅 Sunset Spot · 💧 Wasserfall · 🥾 Hütten-Wanderung · 🚗 Roadtrip · 🍽️ Dinner Date · 🌧️ Schlechtwetter. Jede Pill = vorformulierter Wunsch-Text.
**Beispiel-Wünsche (Placeholder-Rotation):** „chilliger Badespot für heiße Nachmittage", „Wandern mit Hund, max 3 Stunden", „Bester Specialty Coffee in der Altstadt", „Sunset-Spot, gut mit dem Bus erreichbar", „Versteckter Wasserfall, nicht überlaufen".

---

## 3. Backend Matching (Teil 1, `POST /salzguide/v1/kifree-match`)
- **Security:** Referer-Check (nur eigene Seite), **Rate-Limit 6/Minute pro IP**.
- **Tageslimit (Free-Begrenzung!):** **10/Tag Gast**, **150/Tag eingeloggt** → bei Überschreitung **HTTP 402** → Frontend zeigt Paywall. (IP-basiert via Transient.)
- **KI-Call** über **AI Engine Plugin** (`$mwai->simpleTextQuery`) — Modell dahinter aktuell OpenAI.
- **Kompakte Spot-Liste** an die KI: nur `id(slug), title, desc, cats, loc, vibes` (keine Koordinaten/Links). → Token-sparsam.
- **Prompt = „Du bist Anton, ein echter Salzburger."** Wählt ≤5 Spots, vergibt **ehrlichen Score 1–10**, schreibt neue Kurz-Desc (5–9 Wörter, du-Form) + **Intro-Zeile** (max 10 Wörter, SMS-Stil, keine Floskeln/Emojis). Strenge **Anti-Halluzinations-Regeln** + DE-Umlaut-Regeln. Output **striktes JSON** `{intro, matches:[{id,desc,score}]}`.
- **Nachbearbeitung:** Score **8–10** → KI-Desc nutzen; **6–7** → **Original-Desc** (gegen Halluzination); **<6** → verwerfen. Ehrliche Quality-States (`strong`/`mixed`/`related`/`none`), **kein Auffüllen** mit schwachen Treffern. Pro-Spots ausgeloggt → Link zur Join-Seite.
- **Fallback** bei KI-Fehler: 5 zufällige Spots (Original-Desc). Umlaut-Safety-Net.

## 4. Regel-Engine (Teil 3) — deterministischer Vor-Filter
- Definiert Regeln: **Trigger-Wörter** (z.B. `bade`, `schwimm`, `tauch`) → **blockieren bestimmte Spots**, BEVOR die KI sie sieht (z.B. „baden" → Bluntautal/Jägersee/Leopoldskroner Weiher raus, weil **Baden dort verboten/ungeeignet**).
- Titel-Normalisierung (Umlaut/Case), Pre-Filter **und** Post-Filter.
- 🔑 Wichtiger **Sicherheits-/Qualitäts-/Haftungs-Layer**: verhindert gefährliche/falsche Empfehlungen. **Im Neubau unbedingt übernehmen** (als pflegbare Regel-Tabelle im Admin).

## 5. Voice (Teil 4) — Spracheingabe
- `POST /salzguide/v1/kifree-transcribe` → **OpenAI Whisper** (Audio aus Browser-`MediaRecorder` → Transkript → füllt Textarea).
- Admin-`/kifree-voice-diagnose` (nur `manage_options`). OpenAI-Key aus AI-Engine-Optionen.

---

## 6. Konsequenzen / Verbesserungen fürs Neubau

1. **Zwei KIs vereinen (Antons Kern-Wunsch):** EINE Assistenten-Oberfläche, die sowohl **frei chattet** als auch **Spots vorschlägt**. Technisch sauber via **Claude mit Tool-/Function-Calling**: ein Tool `search_spots(wish)` (liefert die kompakte Spot-Liste/Treffer), ein Tool z.B. `get_spot_details(slug)`. Das Modell entscheidet, wann es Spots zeigt vs. nur antwortet. → Für neue User EIN Eingabefeld, kein Moduswechsel.
2. **Anbieter:** Briefing-Entscheidung **Claude** statt OpenAI. Voice/STT: separat (Whisper bleibt möglich, oder Alternative) — entkoppelt vom Chat-Modell.
3. **Free-Limit serverseitig & robust:** aktuell IP-Transient (umgehbar). Neubau: Limit **pro User/Session** (DB-Zähler), für Gäste pro Gerät/Session + IP-Heuristik. 402-Paywall-Trigger beibehalten. Konkrete Limits in Architektur (Conversion-Balance).
4. **„Local Knowledge" füttern:** aktuell nur kompakte Spot-Liste. Für echten Chat zusätzlich Zugriff auf **volle Spot-Inhalte** (Insider-Tipps etc.) via Tool-Retrieval. Bei 60–70 Spots reicht Liste/Tool-Calls; bei Wachstum **Embeddings/RAG** (pgvector in Supabase) als Option.
5. **Regel-Engine übernehmen** als gepflegte Block-/Safety-Regeln (z.B. Baden-Verbote) — wichtig.
6. **Anti-Halluzination + ehrliche Empty/Related-States + „Anton-Stimme"** sind stark — **als Prompt-/Logik-Vorlage 1:1 übernehmen**.
7. **UI/Cards** = gleiche Spot-Card-Komponente wie Explore (Wiederverwendung). Voice, Mood-Pills, animierte States übernehmen.
8. **Datenschutz-Hinweis** (KI-Verarbeitung) Pflicht — anpassen auf Claude/Anbieter.

## 7. Offene Fragen an Anton (KI)
- [ ] Hast du den separaten **`/chat`-Chatbot**-Code auch? (zum Vereinen beider KIs)
- [ ] **Voice** behalten? (kostet extra STT-Calls; Free-Limit auch hier?)
- [ ] Free-KI-Limit Zielwerte (z.B. „X Suchen/Tag gratis") — Vorschlag erarbeite ich in Architektur (Conversion).
