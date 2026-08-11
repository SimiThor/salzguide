# EU AI Act: KI-Transparenz bei SalzGuide (Stand 02.08.2026)

Dieses Dokument ist der Compliance-Nachweis zur KI-Verordnung (EU) 2024/1689 ("AI Act")
für salzguide.com. Es hält fest, welche KI-Funktionen es gibt, welche Pflicht wofür gilt,
was umgesetzt ist (mit Dateipfaden) und was bewusst nicht. Wer eine KI-Funktion baut oder
ändert, gleicht sie gegen dieses Dokument ab.

## 1. Rechtsgrundlage (geprüft am 02.08.2026, drei unabhängige Quellen)

- **Art. 50 gilt seit 02.08.2026** (Art. 113 AI Act). Der **Digital Omnibus on AI**
  (EU-Amtsblatt 24.07.2026) verschiebt einzig die maschinenlesbare Kennzeichnung nach
  Art. 50(2) für Systeme, die vor dem 02.08.2026 am Markt waren, auf den **02.12.2026**.
  Inhalte von vor dem 02.08.2026 müssen nicht rückwirkend gekennzeichnet werden.
- **Art. 50(1)** (Anbieterpflicht): Wer mit einem KI-System direkt interagiert, muss das
  erkennen können; Ausnahme "offensichtlich" ist eng auszulegen. Info spätestens bei der
  ersten Interaktion, klar, erkennbar, barrierefrei (Art. 50(5)).
- **Art. 50(2)** (Anbieterpflicht): Ausgaben generativer Systeme (Text, Bild, Audio,
  Video) maschinenlesbar als KI-generiert kennzeichnen, "soweit technisch machbar".
- **Art. 50(4)** (Betreiberpflicht): Deepfakes offenlegen. KI-Text nur dann, wenn er die
  Öffentlichkeit über Angelegenheiten von öffentlichem Interesse informiert UND keine
  menschliche Prüfung mit redaktioneller Verantwortung stattfindet.
- **Anbieter-Begriff** (Art. 3 Nr. 3): Wer auf einer GPAI-API (Claude) ein System unter
  eigener Marke betreibt, ist Anbieter DIESES Systems. Für "Toni" sind wir also Anbieter;
  Anthropic bleibt Anbieter des Modells.
- **Deepfake** (Art. 3 Nr. 60) umfasst auch Inhalte, die bestehenden **Orten** ähneln und
  fälschlich echt wirken. Fotorealistische KI-Bilder von Salzburger Orten wären Deepfakes.
- **Strafen**: Art. 99(4)(g) bis 15 Mio. € oder 3 % Weltumsatz; für KMU gilt der
  **niedrigere** Wert (Art. 99(6)).
- **Art. 4 KI-Kompetenz** gilt seit 02.02.2025 für Anbieter und Betreiber.
- Auslegungsquellen: Kommissions-**Leitlinien zu Art. 50** (final 20.07.2026) und
  **Code of Practice on Transparency of AI-generated Content** (final 10.06.2026,
  freiwillig; wir richten uns inhaltlich danach, unterzeichnen aber nicht).
- Österreich: **KI-Servicestelle bei der RTR** (KISG) ist Anlauf- und Beratungsstelle.

## 2. Einstufung je Funktion

| Funktion | Unsere Rolle | Pflicht | Umsetzung |
|---|---|---|---|
| Toni-Chat (Claude API, eigene Marke) | Anbieter | 50(1)+(5) sofort, 50(2) spätestens 02.12.2026 | Greeting nennt KI (Ai.greeting, alle 11 Sprachen), Disclaimer in jedem Zustand sichtbar inkl. Paywall (AiAssistant.tsx), Header "dein KI-Local", maschinenlesbar: aiGenerated-Feld + X-AI-Generated-Header (api/ai/chat/route.ts) und data-ai-generated im DOM (AiMessage.tsx) |
| Spot-, Event-, Home-Texte: KI-Entwürfe + 8 KI-Übersetzungen | Betreiber (Redaktion) | 50(4) nicht einschlägig: Reisetipps sind kein "öffentliches Interesse" im Sinn der Kommissions-FAQ, UND es gilt die Ausnahme menschliche Prüfung + redaktionelle Verantwortung (Anton) | Redaktions-Workflow in §4; freiwillige Offenlegung auf /ki |
| Insider-Tipps in Ich-Form benannter Locals | Betreiber | 50(4) nicht einschlägig, aber Irreführungsrisiko (UWG) | Regel in §4: nur mit Freigabe der benannten Person; Kommentar an generateSpotTexts (admin-actions.ts) |
| Audio-Touren: synthetische Stimme (ElevenLabs) | Betreiber (ElevenLabs ist TTS-Anbieter) | Kein Deepfake (imitiert keine bestimmte reale Person), Offenlegung trotzdem: Vertrauen + UWG | Sichtbarer Hinweis Tours.aiVoice im Player-Peek (TourView.tsx), ehrliches Tours.subtitle, Abschnitt auf /ki |
| Eigene Runden (TourBuilder, KI wählt Stopps + Name) | Anbieter | 50(1) | Feature-Text nennt die KI, Sparkle-Symbol; Name läuft durch stripEmDash und ist als KI-Ausgabe in diesem Dokument erfasst |
| Intro-Flyover-Videos | keine KI (Playwright + Mapbox, deterministisch) | keine | dokumentiert, §5 |
| Fotos, Blur-Teaser, Icons | im Regelfall keine KI (sharp); AUSNAHMEN tragen media.ai_origin bzw. LandingImage.aiOrigin und damit das sichtbare KI-Label | 50(4) nur bei Deepfake; Teil-Bearbeitungen ohne Sinn-Änderung sind Standard-Bearbeitung (Ausnahme) | Marker-System seit 08/2026, §5a |
| Startseiten-Hero, Desktop-Variante (Ränder mit KI verbreitert, Mitte = echtes Foto) | Betreiber | KEIN Deepfake i.S.v. Art. 3 Nr. 60: Motiv, Ort und Aussage unverändert, die Verbreiterung ist Standard-Bearbeitung ohne wesentliche Sinn-Änderung (Kriterien der Kommissions-FAQ, doppelt geprüft 03.08.2026). Label daher FREIWILLIG | Entscheidung Anton 03.08.2026: dezent labeln ('extended'), nur auf der Desktop-Variante sichtbar (md-Grenze = picture-Umschaltpunkt); Handy zeigt das echte Foto ohne Label |
| Admin-KI-Werkzeuge (Texte, Events, Insights) | intern | 50(1) durch Offensichtlichkeit erfüllt (Sparkle-Knöpfe, Admins wissen es) | AiButton.tsx + AiSparkle.tsx |
| Haiku-Klassifizierer für anonyme Chat-Insights | intern, kein Nutzerkontakt | keine 50er-Pflicht | anonym per Design, docs/34 §C zur Analytik |
| Toni-Avatar | Bild ist KI-generiert (Anton, 02.08.2026) | kein Deepfake-Fall (Kunstfigur), Offenlegung freiwillig | Satz auf /ki (AiTransparency.toniBody) |

## 3. Maschinenlesbare Kennzeichnung: Machbarkeits-Notiz (Art. 50(2))

Toni liefert kurze, interaktive Chat-Texte. Robuste Text-Wasserzeichen existieren dafür
nach aktuellem Stand nicht (der Code of Practice behandelt Wasserzeichen und signierte
Metadaten primär für Bild, Audio, Video und Dateiformate mit Metadaten). Wir kennzeichnen
deshalb auf jeder Auslieferungsschicht, die wir kontrollieren:

1. API-Antwort: Feld `aiGenerated: true` + Header `X-AI-Generated: true`
   (src/app/api/ai/chat/route.ts),
2. DOM: `data-ai-generated="true"` an jeder KI-Nachricht (src/components/ai/AiMessage.tsx),
3. sichtbar: Disclaimer + Greeting (Art. 50(1), wirkt zugleich als Label).

Das ist "soweit technisch machbar" im Sinn von Art. 50(2) und folgt dem Metadaten-Ansatz
des Code of Practice. Frist für Bestandssysteme wäre der 02.12.2026; umgesetzt seit
02.08.2026. Die gespeicherten MP3s der Audio-Touren erzeugt ElevenLabs (deren
Anbieterpflicht); optionales Härten unsererseits (ID3-Tag "AI-generated" beim Upload in
tour-pool-actions.ts) steht als Phase 2 offen.

## 4. Redaktions-Workflow (die Ausnahme in Art. 50(4), die uns trägt)

- JEDER veröffentlichte Text läuft durch das Admin: KI liefert Entwürfe, ein Mensch
  (Anton) prüft, ändert oder verwirft inhaltlich (inkl. Faktencheck) und speichert.
  Reine Rechtschreibprüfung würde laut Kommissions-FAQ nicht genügen; unsere Prüfung ist
  inhaltlich (Spot-Fakten, Ton, Sicherheitshinweise).
- Events aus der Wochen-Recherche entstehen IMMER als `status: "draft"` und werden erst
  durch einen Menschen veröffentlicht (event-research.ts).
- Insider-Tipps in Ich-Form: nur live, wenn die benannte Person den Text freigegeben hat
  (Kommentar an generateSpotTexts in admin-actions.ts).
- Redaktionelle Verantwortung: Anton Steiner (wie Impressum/Blattlinie).
- Der Em-Dash-Stripper (lib/em-dash.ts) ist eine Stilregel und keine Umgehung von
  Kennzeichnungspflichten: Die Offenlegung passiert über Chat-Kennzeichnung, /ki und
  diesen Nachweis, nicht über Satzzeichen.

## 5. Was ohne KI läuft (Negativ-Abgrenzung)

- Intro-Videos: Playwright nimmt die echte Mapbox-3D-Route auf (scripts/render-intro.ts),
  deterministisch, kein generatives Modell. Damit außerhalb von Art. 50(2)/(4).
- Fotos: von Menschen aufgenommen, nur WebP-Re-Encoding (lib/image-upload.ts).
  Blur-Teaser: deterministisches sharp-Resize (lib/blur-preview.ts).
- Keine Emotionserkennung, keine biometrische Kategorisierung (Art. 50(3) leer),
  keine vollständige KI-Bildgenerierung im Produkt.
- REGEL (verschärft 03.08.2026): KEINE fotorealistischen, VOLL KI-generierten Bilder oder
  Videos von echten Orten oder Personen; das wären Deepfakes (Art. 3 Nr. 60) mit
  Labelpflicht, und wir wollen sie grundsätzlich nicht. KI-BEARBEITUNGEN echter Fotos
  (Retusche, Rand-Erweiterung für Breitbild) sind erlaubt, MÜSSEN aber beim Speichern
  als ai_origin markiert werden (§5a). Erst dieses Dokument erweitern, dann bauen.

## 5a. Bild-Marker ai_origin (seit 08/2026)

Jedes hochgeladene Bild kann eine KI-Herkunft tragen. EINE Werte-Quelle:
src/lib/ai-origin.ts ('generated' | 'edited' | 'extended' | null = ohne KI).

- Rechtliche Einordnung (doppelt geprüft am 03.08.2026 gegen Kommissions-FAQ und
  Praxisleitfäden): Die MASCHINENLESBARE Markierung nach Art. 50(2) ist Pflicht des
  WERKZEUG-Anbieters (z. B. Adobe/Firefly), nicht unsere. Unsere Betreiberpflicht aus
  Art. 50(4) greift nur bei Deepfakes. Teil-Bearbeitungen ohne wesentliche Änderung von
  Inhalt/Semantik sind ausgenommen (Standard-Bearbeitung). Unser sichtbares Label ist
  bei 'edited'/'extended' also FREIWILLIG (Vertrauen), bei einem fotorealistischen
  'generated'-Bild echter Orte/Personen wäre es PFLICHT; solche Bilder sind per Regel
  in §5 aber ohnehin verboten.
- Speicherung: media.ai_origin (Migration 0062, Spot-Fotos, eine Schreibstelle
  writeSpotImages) und LandingImage.aiOrigin (home_content.media, Parser
  lib/landing-media.ts). Beim Foto-Ersetzen und Speichern wird der Wert wie der
  Alt-Text am BILD mitgeführt.
- Admin: Kachel-Umschalter im PhotoUploader (Spot-Fotos) und Auswahl je Startseiten-Slot
  (HomeMediaManager).
- Anzeige: EIN Bauteil AiImageBadge.tsx (dunkle Glas-Pille, Marken-Sparkle, Text aus
  AiMedia.* in 11 Sprachen, data-ai-origin als maschinenlesbares Attribut).
- VOLLSTÄNDIGE Abdeckung (seit 03.08.2026, zweiter Durchgang): Die Offenlegung muss
  spätestens bei der ERSTEN Exposition stehen (Art. 50(4)+(5)), und die erste Exposition
  eines Hero-Fotos ist meist eine Karte. Deshalb ist imageAiOrigin ein PFLICHTFELD in
  SpotCardData: TypeScript zwingt jeden neuen Karten-Erzeuger, den Wert zu liefern.
  Verdrahtet sind ALLE Flächen mit Spot-Fotos:
  Spot-Detail (Hero, Galerie, Lightbox über den Galerie-Kontext), Explore-Karussell
  (SpotCard), Desktop-Panel (SpotCardDesktop), Karten-Sheet (SpotSheet),
  Startseiten-Featured (FeaturedSpots), Ähnliche Spots (Detailseite), Gespeichert
  (SavedSpots), Toni-Chat-Spotkarten inkl. Wasser-Empfehlungen (AiSpotCard),
  /wasser-Seeliste, Startseiten-Hero (je picture-Variante).
- Grenzfälle, bewusst OHNE sichtbares Label (Begründung je Fall):
  - 48px-Thumbnails (/wasser-Liste): Label wäre unleserlich; das data-ai-origin-Attribut
    sitzt trotzdem am Element, das sichtbare Label trägt die nächste größere Fläche.
  - Blur-Teaser gesperrter Pro-Spots (~160px, stark unscharf): kein erkennbarer
    Bildinhalt, damit keine Exposition im Sinn von Art. 50(4); das echte Foto erscheint
    erst nach Freischaltung, dann mit Label.
  - og:image / Link-Vorschau (WhatsApp & Co.): rohe Bild-URL an fremde Plattformen, ein
    Overlay ist technisch nicht möglich. Deshalb bleibt die harte Regel aus §5: kein
    'generated' bei fotorealistischen Ortsbildern; für 'edited'/'extended' ist das Label
    ohnehin freiwillig.
  - Alte Toni-Chat-Verläufe: gespeicherte Karten von vor 08/2026 tragen das Feld nicht;
    Inhalte von vor dem 02.08.2026 sind laut Kommissions-FAQ nicht rückwirkend zu
    kennzeichnen.
- Andere Bildspalten OHNE Marker (events.image_url, tour_points.image_url,
  tours/areas.cover_url, locals.avatar_url): dort gilt die Regel aus §5 (keine
  KI-Bilder verwenden). Wer sie doch braucht: ERST Spalte + Badge nachziehen wie bei
  media.ai_origin, DANN hochladen. Toni-Avatar: als KI-Bild auf /ki offengelegt.
- WebP-Re-Encode beim Upload entfernt eingebettete Herkunfts-Metadaten (C2PA) des
  Werkzeugs; unser ai_origin-Marker ist der Ersatz auf Plattform-Ebene. Optionales
  Härten (Metadaten durchreichen) wäre Phase 2.

## 6. Sichtbare Transparenz (Nutzerseite)

- /ki ("Mit Liebe und KI gemacht"): erklärt alle KI-Hilfen in 11 Sprachen,
  src/app/[locale]/ki/page.tsx, Namensraum AiTransparency. Seit 03.08.2026 sagt der
  Abschnitt "Was ohne KI läuft" ehrlich, dass einzelne Bilder mit KI erweitert und
  am Bild gekennzeichnet sind.
- Fußzeile: Legal.aiMotto verlinkt /ki (LegalFooter.tsx). Chat verlinkt /ki neben dem
  Disclaimer (Ai.transparencyLink). Sitemap führt /ki, llms.txt nennt die KI-Nutzung.
- Datenschutzerklärung §3d: Anthropic-Übermittlung, Chat-Verlauf (24-Monate-Frist,
  data-retention.ts aiConversations), Personalisierung über gemerkte Spots, Verweis /ki.

## 7. Art. 4 KI-Kompetenz (seit 02.02.2025)

Team: Anton (Betrieb/Redaktion) und Simon (Merges). Maßnahmen: dieses Dokument als
Pflichtlektüre bei Änderungen an KI-Funktionen; einmal jährlich (erstmals 08/2027) die
Kommissions-Leitlinien zu Art. 50 und die RTR-FAQ auf Änderungen prüfen; bei neuen
KI-Features vor dem Bau die Einstufungstabelle in §2 ergänzen.

## 8. Offene Punkte

- [ ] Phase 2 (optional): ID3-Metadaten in Audio-MP3s beim Upload.
- [ ] DPAs abschließen: Anthropic und ElevenLabs (docs/35 §Auftragsverarbeiter).
- [ ] 02.12.2026: Frist-Check Art. 50(2) (bei uns bereits erfüllt, nur bestätigen).
- [ ] Jährlicher Review 08/2027 (§7).
