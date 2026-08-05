# 35 — Rechtliche To-dos VOR dem Live-Gang (extern, nicht im Code lösbar)

> **Neu am 26.07.2026 (Gast-Kauf).** Der Kauf läuft ohne Konto davor; das Konto entsteht aus
> der bei Stripe angegebenen E-Mail. Rechtlich hat das drei Dinge ausgelöst, zwei davon sind
> im Code erledigt, eines gehört dem Anwalt:
>
> - **Erledigt: Vertragsbestätigung nach § 7 Abs. 3 FAGG.** Sie ist die DRITTE Bedingung
>   dafür, dass das Rücktrittsrecht bei digitalen Inhalten erlischt (§ 18 Abs. 1 Z 11 lit. c),
>   und es gab sie nicht. Ohne sie blieb das Rücktrittsrecht trotz Häkchen bestehen, und für
>   digitale Inhalte gibt es nicht einmal Wertersatz (§ 16 FAGG nimmt sie aus): voller Preis
>   zurück, nachdem alles gelesen ist. Geht jetzt als E-Mail raus, bevor freigeschaltet wird
>   (`src/lib/pro-purchase-mail.ts`). Braucht `RESEND_KEY` — siehe Punkt 4.
> - **Erledigt: Vorvertragliche Angaben im Kaufweg.** Der Hinweis auf AGB und
>   Widerrufsbelehrung hing vorher am Login-Screen, den es vor dem Kauf nicht mehr gibt. Steht
>   jetzt unter dem Kauf-Knopf (`Pro.legalHint`).
> - **Für den Anwalt: digitaler INHALT oder digitale DIENSTLEISTUNG?** Der EuGH hat am
>   09.07.2026 (C-234/25, VKI gegen Sky Österreich) entschieden: Ein Angebot, das sich am
>   Nutzerverhalten orientiert und laufend angepasst wird, ist eine digitale Dienstleistung.
>   Dann greift § 18 Abs. 1 Z 11 nicht, sondern Z 1 (Recht erlischt erst bei VOLLSTÄNDIG
>   erbrachter Leistung), und eine Klausel, in der der Kunde den Verlust bestätigt, kann den
>   Verlust nicht herbeiführen. Pro ist ein Paket: Spots und Audio-Touren sind Inhalt, Toni
>   und „wird laufend weiterentwickelt" sind eher Dienstleistung. AGB und Widerrufsbelehrung
>   sind deshalb bereits auf die geteilte Sicht umgestellt (Inhalte: erlischt; laufende Teile:
>   bleibt, mit Wertersatz nach § 16). **Der Anwalt muss die Einordnung bestätigen** und
>   entscheiden, ob das Häkchen im Checkout in dieser Form bleiben kann.
>
> Kaufmännische Alternative, die die ganze Frage entschärft: freiwillig 14 Tage Geld zurück.
> Dann muss § 18 gar nicht angerufen werden, das Häkchen könnte entfallen (ein Tipp weniger
> bis zur Kasse) und ein Streit über die Einordnung wäre gegenstandslos. Anton hat sich
> vorerst dagegen entschieden.

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
- [x] **`RESEND_KEY`** + `EMAIL_FROM` — lokal gesetzt (`.env.local`). Ziel-Absender ist
      „SalzGuide &lt;no-reply@salzguide.com&gt;"; bis salzguide.com in Resend verifiziert
      ist, bleibt der bisherige verifizierte Absender „SalzGuide
      &lt;no-reply@steinermedia.at&gt;" aktiv (Umstellungs-Reihenfolge: erst Resend
      verifizieren, dann `EMAIL_FROM` wechseln). Kontakt-/Reply-To-Adresse ist seit
      05.08.2026 einheitlich `anton@salzguide.com` (`LEGAL.email`). Darüber laufen
      bereits die Widerruf-Eingangsbestätigung und die Pro-Geschenk-Mail.
- [ ] **Dasselbe auf Vercel (Production) und Domain salzguide.com in Resend
      verifiziert?** Das ist der eigentliche Punkt: Ohne gesetzten Key auf dem Server
      oder ohne verifizierte Absender-Domain geht die **Kaufbestätigung nach § 7 Abs. 3
      FAGG** nicht raus (bzw. landet nirgends). Ohne sie erlischt das Rücktrittsrecht
      nicht (§ 18 Abs. 1 Z 11 lit. c), und jeder Käufer könnte binnen 14 Tagen den
      vollen Preis zurückverlangen, obwohl im Checkout etwas anderes stand. Prüfen:
      Vercel → Settings → Environment Variables (Production) und Resend → Domains.
      Beim DNS-Setzen die bestehenden MX-Einträge der Hauptdomain nicht anrühren,
      daran hängt der Empfang von anton@salzguide.com.
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
