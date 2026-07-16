# 35 — Rechtliche To-dos VOR dem Live-Gang (extern, nicht im Code lösbar)

Stand: 15. Juli 2026. Die Rechtstexte (Impressum, Datenschutz, AGB, Widerruf) sind im Code
**vollständig und mit echten Firmendaten** angelegt (`src/lib/legal.ts`, `/rechtliches/*`).
Die folgenden Punkte kann **nur Anton bzw. Anwalt/Steuerberater** erledigen — sie sind die
eigentlichen Schutzmaßnahmen gegen Bußgelder/Anzeigen.

> ⚠️ Diese Liste ersetzt KEINE Rechtsberatung. Vor Live von Anwalt + Steuerberater freigeben lassen.

## 1) Anwaltliche Prüfung der Rechtstexte
- [ ] **AGB** prüfen — v. a. Haftungsklauseln (§ 6 KSchG: zu weite Haftungsausschlüsse gegenüber
      Verbrauchern sind in AT oft nichtig), Gewährleistung, Vertragsschluss-Formulierung.
- [ ] **Datenschutzerklärung** prüfen (Vollständigkeit Art. 13/14 DSGVO, Drittland-Transfers).
- [ ] **Impressum** prüfen (Offenlegung § 5 ECG / § 25 MedienG / § 14 UGB; GISA statt Firmenbuch ok).
- [ ] **Widerrufsbelehrung** + Muster-Widerrufsformular prüfen.

## 2) Auftragsverarbeitungsverträge (AVV / DPA, DSGVO Art. 28) — HÖCHSTE PRIORITÄT
Mit JEDEM Dienstleister einen AVV abschließen (meist im Legal-/Dashboard-Bereich als „DPA"
online akzeptierbar). Fehlt der AVV, droht ein DSGVO-Bußgeld **unabhängig** vom Datenschutztext.
- [ ] **Supabase** (DB/Auth/Storage, EU) — DPA
- [ ] **Vercel** (Hosting/CDN, US) — DPA
- [ ] **Stripe** (Zahlung) — DPA
- [ ] **Anthropic** (KI/Claude, US) — DPA / Commercial Terms
- [ ] **Google** (Sign-In + Places, US) — Data Processing Terms
- [ ] **Cloudflare** (Turnstile, US) — DPA
- [ ] **Resend** (E-Mail-Versand, US) — DPA
- [ ] **ElevenLabs** (Audio-TTS, US) — DPA
- [ ] **Mapbox** (Karten) — DPA
- [ ] **Open-Meteo** (Wetter) — es werden nur gerundete Ortskoordinaten, KEINE personenbezogenen
      Daten übermittelt → i. d. R. kein AVV nötig (mit Anwalt bestätigen).
- [ ] Verzeichnis der Verarbeitungstätigkeiten (Art. 30) + ggf. DPIA anlegen.

## 3) Steuer (Steuerberater)
- [ ] **USt-Status** klären: UID vorhanden (ATU77969058) → vermutlich USt-pflichtig (kein
      Kleinunternehmer). „inkl. USt" in AGB/Preis muss zur echten Steuerlage passen.
- [ ] **Stripe Tax** einrichten (AT/EU-USt., Rechnungsstellung) → dann `STRIPE_TAX_ENABLED=true`.
- [ ] Rechnungs-Pflichtangaben (§ 11 UStG) sicherstellen.

## 4) Keys & Config VOR Live (sonst rechtliche Lücken)
- [ ] **`RESEND_KEY`** + verifizierte Absender-Domain (`EMAIL_FROM`) — sonst wird die
      **gesetzlich vorgeschriebene Widerruf-Eingangsbestätigung** NICHT gesendet (Verstoß).
- [ ] **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRO_PRICE_ID` / `STRIPE_TAX_ENABLED`**.
- [ ] **`CRON_SECRET`** (Cron-Endpoint), **Turnstile-Keys** (bereits gesetzt).
- [ ] Supabase Auth-Redirect-Allowlist eng auf `salzguide.com`.

## 5) Widerrufsbutton (§ 13a FAGG, VerbRÄG 2026)
- [x] Im Code umgesetzt: globaler login-freier Footer-Zugang „Vertrag widerrufen" →
      zweistufiges Formular → Eingangsbestätigung per E-Mail (Datum/Uhrzeit).
- [ ] Anwalt: Ist der Button für SalzGuide Pro (digitaler Inhalt, § 18-Verzicht) überhaupt
      zwingend, und genügt die aktuelle (graue) Beschriftung dem Kriterium „hervorgehoben"?
- ℹ️ Start in AT verschoben auf **1. Oktober 2026** (nicht 19.06.2026 wie DE).

## 6) Weitere Punkte
- [ ] **Newsletter**: aktuell Single-Opt-in mit Nachweis (in AT vertretbar). Double-Opt-in ist
      sicherer gegen UWG-Abmahnungen — mit Anwalt abwägen.
- [ ] **§ 8 FAGG Button-Lösung**: verbindlicher „zahlungspflichtig"-Button liegt auf Stripes
      Checkout (konform). Klären, ob der App-CTA „Jetzt Pro freischalten" auch „kaufen" heißen muss.
- [ ] Laufend: Datenschutztext mit tatsächlicher Verarbeitung synchron halten (neue Dienste →
      Datenschutz + AVV ergänzen).

Details zum Sicherheits-/DSGVO-Audit: siehe `docs/34_SICHERHEIT_AUDIT.md`.
