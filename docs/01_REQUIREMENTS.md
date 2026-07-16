# SalzGuide – Neubau als Next.js App (salzguide.com)

> Lebendes Anforderungsdokument. Hier sammle ich **alles**, was Anton schickt (Briefing, Code, Screenshots), sauber strukturiert. Daraus entstehen später `02_ARCHITEKTUR.md` und `03_MASTERPROMPT.md`.
>
> Stand: 2026-06-21 · Status: **Briefing erfasst, warte auf Alt-Code & Screenshots**

---

## 1. Ziel & Kontext

SalzGuide (salzguide.com) ist eine Travel-Tipps-Plattform für das Salzburger Land mit kuratierten "Spots" (Wanderungen, Spaziergänge, Food-Lokale u.a.). Die aktuelle Seite läuft auf **WordPress + Elementor + PHP-Code-Snippets**, die direkt in Elementor liegen. Probleme: langsam, "gepfuscht", schwer wartbar, Code verstreut.

**Auftrag:** Komplett-Neubau als robuste, saubere, sichere **Next.js**-App mit vernünftigem Backend. Funktional gleich/ähnlich wie heute, aber besser, schneller, wartbarer und sicherer gebaut.

**Deployment-Plan (aktualisiert 2026-07-13 — App direkt auf der Hauptdomain):**
- Neue Plattform läuft direkt auf **salzguide.com** (Apex-Domain, KEINE `app.`-Subdomain mehr).
- Marketing-/Landing-/Trust-Inhalte werden Teil der App (eigene Route/Seite), nicht mehr eine separate Subdomain. Alte WordPress-Seite wird abgelöst; alte URLs per 301 auf die neue App umleiten.

**Arbeitsweise mit mir (Claude):**
- Anton schickt **schrittweise** den bestehenden Code und Screenshots der aktuellen Seiten.
- Ich notiere alles sauber hier und bereite **nach und nach Architektur + sehr ausführlichen Masterprompt** vor.
- Der Masterprompt ist für **Anton als Anfänger in Claude Code** gedacht — also klar, vollständig, schrittweise.

---

## 2. Design- & UX-Prinzipien

- **Mobile First.** Soll sich anfühlen wie eine **Apple iOS 2026 App**: super übersichtlich, minimalistisch, ruhig, klar.
  - **Map-First:** Karte **vollflächig** (wie Apple Maps), nicht klein eingebettet.
  - **Bottom-Sheets im iOS-2026-Stil:** ziehbar, mit Rasterpunkten (Peek/Halb/Voll), Grabber, Spring-Animation, Blur — für Spot-Details, KI, Filter. Karte bleibt darunter.
  - **Super aufgeräumt, einfach verständlich, leicht zu navigieren.**
- App-Charakter (nicht "Website"-Gefühl): klare Hierarchie, große Touch-Targets, weiche Übergänge, native-feel Navigation.
- Sehr einfache Verständlichkeit, auch für neue/unerfahrene User.

---

## 3. Seiten & Features (aus Briefing)

### 3.1 Explore-Seite (Startseite der App)
- Super übersichtlich.
- **Karte** mit den Spots.
- **Karussells** mit den Spots (Kategorien/Reihen).
- Mehrsprachig (siehe 3.4).
- **🆕 Sommer/Winter-Umschalter:** globaler Toggle, schaltet Spots + Kategorien + Karte zwischen Saisons. Winter = eigene Winter-Spots/-Kategorien (food/view/action), aktuell Gastein-Pilot → Ziel: ganz Salzburg. **Ein** System mit `seasons`-Dimension (kein duplizierter Code). Robust & einfach für User. Details: `24_ALTSEITE_Winter-Modus.md`.

### 3.2 Spot-Unterseiten
Jeder Spot hat eine eigene Unterseite (Deutsch als Basis, Übersetzungen siehe 3.4). Stil: iOS-2026-App, sehr übersichtlich, mit **Titel des Spots** oben.

**Zwei Spot-Typen mit unterschiedlichem Aufbau:**

#### A) Aktiv-Spots (Wanderung / Spaziergang / allgemeiner Ort)
Oben **4 Quick-Facts**:
1. **Länge / Zeit** der Wanderung/des Spaziergangs bzw. Zeit vor Ort
2. **Schwierigkeit**
3. **Beste Jahreszeit**
4. **Erreichbarkeit**: Öffis / Auto / Öffis & Auto

Inhaltsblöcke (Reihenfolge):
1. **Allgemeine Info** über den Spot (kurzer Text)
2. **Insider-Tipps** (kurzer Text)
3. **Aktuelles Wetter** für genau diesen Spot — über **Meteoblue API**, gecached & kosteneffizient
4. **Karte**: Wanderroute *oder* nur ein Punkt (je nach Spot)
5. **Buttons** → Google Maps Anreise: per Öffis **und** per Auto, jeweils zum **Parkplatz / Startpunkt**
6. **Dauer & Schwierigkeit** (kurzer Text)
7. **Beste Jahreszeit** (kurzer Text)
8. **Lage & Erreichbarkeit** (kurzer Text)

#### B) Food-Spots (Lokale, evtl. mit Öffnungszeiten)
Oben **4 Quick-Facts** (andere Kategorien):
1. **Art des Lokals** (z.B. "Coffee Spot", "Österreichisch")
2. **Preisniveau** (z.B. "mittel")
3. **Standort** (z.B. "Stadt Salzburg")
4. **Bekanntheit** (z.B. "Hidden Gem")

Inhaltsblöcke:
1. **Allgemeine Info** (kurzer Text)
2. **Insider-Tipps** (kurzer Text)
3. **Öffnungszeiten** — über **Google Places API**, kosteneffizient (Beispiel kommt noch). *Gilt für Food-Spots und alle Spots mit Öffnungszeiten, platziert VOR den 3 Kurztexten.*
4. **Karte** (Punkt)
5. **Buttons** → Google Maps Anreise (Öffis / Auto)
6. **Küche & Stil** (kurzer Text) *(ersetzt "Dauer & Schwierigkeit")*
7. **Preisniveau** (kurzer Text) *(ersetzt "Beste Jahreszeit")*
8. **Lage & Erreichbarkeit** (kurzer Text)

> Hinweis: Wetter (Meteoblue) vor allem bei Aktiv-Spots relevant; Öffnungszeiten (Places) bei Food/Öffnungszeiten-Spots. Genaue Logik pro Typ noch final festzulegen.

### 3.3 Spot-Daten & Karte
- Pro Spot: Geo-Punkt (Parkplatz/Startpunkt) + optional Routen-Geometrie (Wanderroute).
- Externe APIs pro Spot: **Meteoblue** (Wetter, gecached), **Google Places** (Öffnungszeiten, gecached), **Google Maps** (Routing-Deeplinks Öffis/Auto).
- **Kosteneffizienz** ist explizit wichtig → Caching-Strategie für alle externen API-Calls.

### 3.4 Mehrsprachigkeit (i18n)
- **Startseite** mehrsprachig.
- **Jede Spot-Unterseite** kann per Klick übersetzt werden — Admin legt beim Anlegen extra Unterseiten in mehreren Sprachen an, via **KI-Modell**-Übersetzung.
- Robust & sauber angelegt für **gutes SEO** (eigene URLs/hreflang pro Sprache) und **schnelle Prozesse** beim Anlegen.
- **Sprach-Switcher**: sehr einfach verständlich.
- **Sprach-Priorität (datenbasiert, `32_RECHERCHE`):** DE (Basis, DE+AT=58 % Markt) → **EN** (Übersee/intl.) → **IT, NL, CS, HU, FR** (restl. Europa 30 %). Rollout in dieser Reihenfolge.

### 3.5 Admin-Dashboard (intern)
- Spots **sehr einfach und sauber** anlegen.
- Inkl. **KI-Übersetzung** beim Anlegen (1-Klick in weitere Sprachen).
- Soll schnelle, saubere Prozesse ermöglichen.
- **Analytics** im Blick behalten & tracken (DSGVO-konform) zur Optimierung — siehe 3.9.

### 3.6 Membership / Monetarisierung
- **~20–30 Spots gratis** für alle User ohne Account.
- **SalzGuide Pro** schaltet restliche **~30–40 Spots** frei.
- Aktuell: **19,90 € Einmalzahlung** via **Stripe**.
- Anton will, dass ich überlege:
  - Wie ein **Abo** sinnvoll möglich wäre.
  - Ob **mehrere Mitgliedschaftsstufen** sinnvoll sind.
- **Conversion** wichtig: Free-User sollen die Plattform richtig gut testen können, aber trotzdem zum Kauf konvertieren.
- **Monetarisierung #2 (entdeckt im Alt-Code):** **Affiliate-Tiles** (Tickets/Touren, z.B. GetYourGuide) auf Spot-Detailseiten, mit Pflicht-Werbekennzeichnung. → in Monetarisierungs-Konzept aufnehmen (zusätzliche Einnahmequelle neben Pro).

### 3.7 User-Features
- User können **Spots speichern** und übersichtlich abrufen.
- Gespeicherte Spots evtl. auf **eigener Karte** auf der "Gespeichert"-Seite.

### 3.8 KI-Chatbot
- User können mit einer **KI-API** (OpenAI oder Claude) schreiben, gefüttert mit dem **lokalen Wissen unserer Seite** (Spots/Insider-Wissen).
- Zwei Nutzungsarten, **in EINER KI** zusammengefasst (nicht verwirrend, voll verständlich für neue User):
  1. Normales Schreiben/Fragen.
  2. **Spot-Empfehlungen** passend zu den Bedürfnissen des Users.
- **Free-User: Nutzungs-Limit** für die KI-Funktion.

### 3.9 Analytics (Admin)
- Im Dashboard alle wichtigen Analytics gut im Blick + tracken.
- **DSGVO-konform.**
- Zweck: Plattform optimieren.

### 3.9b Events / „SalzGuide Weekly" (🆕)
- Wochenkalender „Was geht in Salzburg?" mit Tag-Gruppierung + Kategorie-Pills (Highlights/Party/Tradition/Kultur/Kids).
- **KI-gestützt anlegen:** wöchentlicher Recherche-Lauf (Claude + Web) erstellt Draft-Events → Admin prüft & gibt frei. Einzel-Event per Link/Stichwort.
- **Geringe Wartung:** zeitbasierter Auto-Ablauf, wiederkehrende Events als Serie. Design wie heute, schlank. Sektion in Entdecken (kein 5. Haupt-Tab). KI „Anton" kennt Events. Konzept: `29_KONZEPT_Events.md`.

### 3.10 Auth / Login
- Anton will beste Lösung von mir: **Passwort** vs. **Magic Link** (E-Mail) vs. anderes.

### 3.11 Migration der Bestands-User
- Aktuell **~100 Pro-User**.
- Sollen **robust, schnell, sauber, unkompliziert** in die neue Plattform eingepflegt werden.

---

## 3b. Getroffene Entscheidungen (2026-06-21)
- **Stack/Hosting:** Vercel (Next.js) + Supabase (Postgres, Auth, Storage), EU-Region für DSGVO.
- **KI-Anbieter:** Claude (Anthropic) — für Chatbot UND Übersetzungen.
- **Bereits vorhanden:** Stripe ✅, GitHub ✅, Domain-DNS-Zugang ✅. **Vercel-Account: noch nicht** (im Setup einplanen).
- **Strategische Punkte:** Ich arbeite begründete Empfehlungen aus und baue sie direkt in Architektur & Masterprompt ein (Anton kann alles ändern).

---

## 4. Offene strategische Punkte (Anton delegiert an mich → ich erarbeite Empfehlungen)
- [ ] Abo-Modell + Stufen (zusätzlich/statt Einmalzahlung)
- [ ] Auth-Methode (Magic Link vs. Passwort)
- [ ] Analytics-Tooling (DSGVO-konform, EU)
- [ ] KI-Anbieter & Limit-Logik (Free vs. Pro)
- [ ] i18n-Sprachenliste + technischer Ansatz
- [ ] Caching-Strategie Meteoblue / Places (kosteneffizient)
- [ ] Migration der ~100 Pro-User
- [ ] Conversion-/Paywall-Strategie (Free testet gut, konvertiert trotzdem)

- [ ] Routen-Anlegen vereinfachen (Start/Ziel/Zwischenstops → Auto-Route) → **Konzept fertig in `20_KONZEPT_Route-Anlegen.md`** (Empfehlung: OpenRouteService `foot-hiking` mit Höhenprofil).
- [x] **KI-Texterstellung beim Anlegen** → **Konzept fertig in `27_KONZEPT_KI-Texterstellung.md`**: 6 Abschnitte (= Spot-Felder) per Claude, **JSON-Output direkt in Felder**, eine typgesteuerte Voice-Vorlage, Grounding (Places/ORS/Admin-Notizen) gegen Halluzination, pro Abschnitt regenerierbar, dann 1-Klick-Übersetzung. **Brand-Voice = zentrale Konstante** (auch für Chat-KI „Anton"). Macht „Spot anlegen in wenigen Minuten" möglich.
- [x] **Medien-Pipeline (Foto/Video)** → **Konzept fertig in `28_KONZEPT_Medien-Pipeline.md`**: Bild-Upload JPG/PNG/HEIC → **auto WebP/AVIF + responsive Größen + EXIF-Strip** (`sharp`); MP4-Video → **Transcode/Komprimierung** (Cloudflare Stream empfohlen) + Poster. `media`-Tabelle, EU-Storage, im Anlege-Flow integriert (kein manuelles Vor-Komprimieren mehr).

→ Diese arbeite ich in `02_ARCHITEKTUR.md` als begründete Empfehlungen aus.

### 4a. Optimierungen aus Wettbewerbsrecherche (`30_RECHERCHE_Wettbewerb-Optimierung.md`)
Übernommen ins Konzept (MVP-relevant): **Speichern als Listen** (statt flacher Merkliste) + Profil-Hub (Rexby/AllTrails); **Live-Wetter im Header** + **Speichern prominent im Hero** (Madeira); **Quick-Facts um Höhenmeter/Distanz/Start-Ende erweitern** (aus ORS-Route, Madeira/AllTrails-Niveau); **Onboarding mit schnellem Aha + kontextuelle Soft-Paywalls** (RevenueCat 2026: Content-Gating ist #1 Conversion-Treiber); **Related-Spots nach Region/Vibe**. Phase 2: **„Schon besucht"-Tracking**, **Offline/PWA** als Pro-Hebel + App-Gefühl, Tourismusverband-Partnerschaft. Modell-Validierung: **Rexby** (Creator-Guide + KI auf eigenem Wissen) = quasi SalzGuide → Kurs bestätigt.

---

## 4b. Eingegangenes Alt-Material
- ✅ **Explore-Seite** (`Salzburg_Datenbank+Karte+Karussells_v17`) — analysiert in `10_ALTSEITE_Explore.md`.
  - 76 Spots (36 Free / 40 Pro, davon 12 Food). Datenmodell, 8 Kategorien + versteckte „som"-Reihe, Mapbox-Karte, clientseitiges Pro-Gating (→ Neubau: serverseitig!), Design-Tokens (Rot `#cc2924`).
- ✅ **Spot-Unterseite Aktiv/Wanderung** (`Aignerpark.pdf`) — analysiert in `11_ALTSEITE_SpotWanderung.md`.
  - Vollständiger Detail-Aufbau bestätigt; iOS-Look (Creme-BG, weiße Cards); Meteoblue-7-Tage-Wetter; **2 getrennte Geo-Koordinaten** (Auto→Parkplatz, Öffis→Startpunkt); optionale Routen-Geometrie.
- ✅ **Spot-Unterseite Food** (`Karaffu.pdf`) — analysiert in `12_ALTSEITE_SpotFood.md`.
  - Food-Variante bestätigt: 4 andere Quick-Facts (Art/Preis/Standort/Bekanntheit), **kein Wetter**, nur Punkt-Karte, **1** Anfahrts-Button (Auto), **Öffnungszeiten via Google Places** (gecached) vor den 3 Kurztexten (Küche & Stil / Preisniveau / Lage). → **ein** Modell mit `type` (`activity`|`food`) + `has_opening_hours`.
- ✅ **Wetter-Integration Meteoblue** (`Wetter_Spots…Teil_1_v5`) — analysiert in `13_ALTSEITE_Wetter.md`.
  - Meteoblue `basic-day`, **24h-Cache**, Koordinaten auf ~1km gerundet (geteilter Cache), Fehler-Backoff 10min, eigene Pictocode-Heuristik, Inline-SVG-Icons. → Caching-Konzept 1:1 übernehmen, API-Key in ENV.
- ✅ **Öffnungszeiten Google Places** (`sg-oeffnungszeiten_v1.php`) — analysiert in `14_ALTSEITE_Oeffnungszeiten.md`.
  - Google Places (v1) über **Cloudflare-Worker-Proxy**, Key geheim, **1×/Tag Edge-Cache**; Open/Closed + AT-Feiertage (inkl. Salzburg-Rupertitag) **clientseitig** berechnet; „Powered by Google". → Worker-Muster als Next.js-Server-Route + KV/DB-Cache nachbauen, Status-Logik clientseitig portieren.
- ✅ **Detail-Wanderkarte** (`Wanderkarte`) — analysiert in `15_ALTSEITE_Wanderkarte.md`.
  - Mapbox, **Route als GeoJSON LineString mit Höhen** `[lng,lat,ele]` (→ DB-Feld `route_geojson`, ermöglicht Höhenprofil), rote Linie `#e04848` + weiße Outline, Start `🅿️`/Ziel `🏁`, Fullscreen wie Explore. → **eine** wiederverwendbare `<SpotMap>`-Komponente. ⚠️ 2. Mapbox-Token + MapTiler-preconnect bemerkt (konsolidieren).
- ✅ **KI-Freitext-Spot-Suche** (`Ki_Auswahl…teil_1–4`) — analysiert in `16_ALTSEITE_KI-Suche.md`.
  - Concierge-Flow „Anton AI" (Text + **Voice/Whisper**), Backend-Matching mit Score/Anti-Halluzination/ehrlichen Empty-States, **Regel-Engine** (Block-Regeln, z.B. Baden-Verbote), **Free-Limit 10/Tag → HTTP 402 Paywall**. → Neubau: **Chat + Spot-Vorschläge in EINER Claude-KI** (Tool-Calling), Limit pro User, Regel-Engine + Anton-Stimme übernehmen.
- ✅ **KI-Chatbot „Toni"** (Screenshot + System-Prompt, AI Engine/mwai + Knowledge Base) — analysiert in `17_ALTSEITE_Chatbot.md`.
  - Konversationeller Reiseplaner, schwebendes Chat-Widget, Knowledge-Base-Kontext, HTML-Spot-Links, Scope-/Sicherheits-Regeln (Baden/Unwetter). → **Merge mit Freitext-Suche zu EINER Claude-Assistenz** (Tool-Calling + Embeddings/pgvector). Entschieden: Persona **„Anton"**, Cards **+** Inline-Links, **Voice bleibt**.
- ✅ **Mobile Bottom-Nav** (`salzguide-glass-bottomnav`) — analysiert in `18_ALTSEITE_Navigation.md`.
  - iOS-Glass-Tab-Bar mit **4 Bereichen: Entdecken · KI · Gespeichert · Profil**; KI = Overlay-Aktion (nie aktiv); native Zurück-Geste auf Detailseiten; Profil = Account/Login. → bestätigt App-Struktur. ⚠️ mehrere Chat-Systeme parallel im Alt-Code (Chatbase + AI Engine) → Neubau: EIN Assistent.
- ✅ **Anfahrt-Buttons** (`Anfahrt_v9.html`) — analysiert in `19_ALTSEITE_Anfahrt.md`.
  - 2 animierte Kacheln Auto/Öffis, Google-Maps-Deeplinks; bestätigt 2-Koordinaten-Modell (`parking_coords` für Auto/driving, `transit_coords`/Spot für Öffis/transit). Helper `buildMapsLink(coords,mode)`.
- ✅ **Anrufen + Tickets-Widget** (`Telefonnummer_v1.html`, `Tickets_v2.html`) — analysiert in `21_ALTSEITE_Anrufen.md`.
  - `tel:`-Anruf (`phone`) + **Affiliate-Tickets** (GetYourGuide u.a., Werbekennzeichnung = Monetarisierung #2). **Action-Tile-Familie** → generische `<ActionTile>`-Komponente, bedingt je Spot-Feld.
- ✅ **Winter-Modus / Gastein-Explore** (`Gastein_Datenbank+Karte+Karussell_v2`) — analysiert in `24_ALTSEITE_Winter-Modus.md`.
  - Duplizierte Winter-Explore (19 Spots, Kat. food/view/action). → Neubau: **EIN** System mit **`seasons`-Dimension** + Sommer/Winter-Toggle (Spots+Kategorien+Karte), skaliert von Gastein zu ganz Salzburg. **Winter-Modus = Kern-Feature.**
- ✅ **Wassertemperatur — Widget + eigene Karten-Seite** (`Wassertemperaturen_Widget_New_v6.html` + `Wassertemperaturen_Karte_v2.html`) — analysiert in `23_ALTSEITE_Wassertemperatur.md`.
  - Aktuelle Seetemperatur aus **gratis Behörden-Open-Data** (Land Salzburg OGD + AGES), gut gecached (1h/12h). (a) **Widget** auf Seen-Detailseiten (Feld `lake_name`); (b) 🆕 **eigene „Wassertemperaturen"-Seite** = Mapbox-Karte mit ~15 Salzburger Seen + Live-Temp pro Marker. → `lakes`-Tabelle (Seed-Liste vorhanden), `<SpotMap>`-Wiederverwendung, Einstieg aus Entdecken, **null Kosten**.
- ✅ **Video Maker** (`SalzGuide_VideoMaker_Doku.docx` v1.4 + 2 Snippets) — analysiert in `25_ALTSEITE_VideoMaker.md`.
  - **Entwickelt, noch nicht released.** Besucher erstellt auf Spot-Seite ein 15-Sek-Story-Video (10s 3D-Spot-Animation + 5s User-Video + Watermark) → Download/Share. Stack: R2 (EU, Presigned, 24h-Delete) + Creatomate + n8n + WP-Endpoints + Shortener. → Neubau: **als Subsystem „Media/Render" einplanen**, WP/n8n → Next.js-Routes konsolidieren, R2+Creatomate behalten, Spot-Felder `intro_video_url`/`preview_video_url` je Sprache, **Render-Limit als Pro-Hebel**. DSGVO + Kosten-Caps Pflicht.
- ✅ **Audio-Tour „nookmate"** (`nookmate_salzburg_v1…freitext.html`, 3820 Z.) — analysiert in `31_ALTSEITE_AudioTour.md`.
  - **Quasi fertig.** KI-kuratierte, selbstgeführte Audio-Walking-Tour: User-Wunsch (Text/Voice) → KI baut Route aus Spot-Pool mit **Audio-Narration** je Stop. → Neubau: Spots + `audio_url`/`audio_text` (je Sprache), schlankes **Tour-Subsystem**, KI-Tour-Builder als **Tool der „Anton"-KI**, **TTS-Pipeline** (ElevenLabs/OpenAI) für Audio-Erstellung. ⚠️ **„nookmate" = nur interner Arbeitstitel — NICHT als Name/Logo verwenden; Farben/Branding = SalzGuide, nicht aus dem Prototyp übernehmen.**
- ✅ **Membership / Kauf / Auth (Ist-Stand)** (Antons Beschreibung) — analysiert in `22_ALTSEITE_Membership-Auth.md`.
  - Heute: WP-Membership + Stripe-Button → Stripe-Checkout (19,90€ einmal) → E-Mail mit Passwort-Setzen-Link. → **Neubau-Empfehlung: Magic-Link-Auth (Supabase)** = null Reibung **und triviale Migration** der ~100 Pro-User (nur E-Mail + Pro-Status importieren, kein Passwort-Transfer); Kauf eingeloggt, Pro via **Stripe-Webhook** serverseitig.
- ✅ **Verkaufsseite „Jetzt kaufen"** (Screenshot) — analysiert in `26_ALTSEITE_Verkaufsseite.md`.
  - Value-Props + Social Proof („60+ Highlights", „unlimitierte KI", „25.000+ Trips"), Founder-Video, **€19,90 einmalig, „Kein Abo"** als Verkaufsargument. → 🟡 Abo-Idee steht im Spannungsfeld zu „Kein Abo" → im Monetarisierungs-Konzept abwägen (Einmalzahlung als Trust-Anker behalten, Abo nur als Add-on). Inhalte → Landingpage + In-App-Upgrade-Screen.

---

## 5. Noch ausstehend von Anton
- [x] Code der aktuellen **Explore-Seite** (Karte + Karussells) ✅
- [ ] Code-Beispiele der aktuellen **Spot-Unterseiten** (Aktiv & Food)
- [ ] Beispiel **Öffnungszeiten** (Google Places, aktueller Stand)
- [ ] **Screenshots** der aktuellen Seiten
- [ ] Liste/Anzahl der **Spot-Kategorien** & aktueller Spots
- [ ] Branding (Logo, Farben, Schrift) falls vorhanden

---

## 6. Changelog
- 2026-06-21 — Dokument angelegt, erstes Briefing erfasst.
