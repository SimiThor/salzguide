# Sicherheit & DSGVO — verbindliche Querschnitts-Anforderungen (AT/EU, Stand Juni 2026)

> Gilt für **jeden** Baustein der neuen Plattform. In Architektur (`02` §17) und Masterprompt verankert.
> ⚠️ **Kein Rechtsrat:** Dies ist technische/organisatorische Engineering-Guidance. Vor Launch durch **Anwalt/DSB** (Datenschutzbeauftragte:r) prüfen lassen — v.a. Datenschutzerklärung, AVVs, AI-Act-Einordnung.

---

## 1. Cyber-Sicherheit (Defense in Depth, OWASP-orientiert)

### 1.1 Transport & Header
- **HTTPS/TLS überall** (Vercel automatisch), **HSTS** (preload).
- **Security-Header** (via `next.config`/Middleware): strenge **Content-Security-Policy** (nur erlaubte Quellen: Mapbox, Supabase, Stripe, Cloudflare; `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` (Kamera/Mikro nur wo nötig — Voice).
- **CORS** restriktiv (nur eigene Domain).

### 1.2 Auth & Sessions
- **Supabase Auth Magic-Link**: kurze Token-Gültigkeit, Single-Use, **Rate-Limit** auf Login-Anfragen (Brute-Force/Mail-Bombing verhindern).
- Sichere, httpOnly/SameSite-Cookies; serverseitige Session-Prüfung.
- **Rollen-Check serverseitig** für jede Admin-Aktion (nie nur UI).

### 1.3 Datenzugriff
- **Row Level Security (RLS)** auf **allen** Supabase-Tabellen (Default deny). User sehen nur eigene Daten; öffentliche Inhalte nur `status='published'` & nicht-Pro-Teaser.
- **Pro-Inhalte serverseitig gaten** — nie im Client-HTML/JS.
- **Parametrisierte Queries** (Supabase-Client/ORM) → kein SQL-Injection. Eingaben **serverseitig validieren** (z.B. `zod`).

### 1.4 Angriffsflächen
- **Rate-Limiting** auf allen öffentlichen/teuren Routen (KI, Upload, Video-Maker, Auth) — pro User/IP in DB/KV.
- **Bot-Schutz** (Cloudflare Turnstile) vor teuren/öffentlichen Aktionen (KI, Upload) ab Launch.
- **CSRF**-Schutz für state-ändernde Requests; **Webhook-Signaturen prüfen** (Stripe `STRIPE_WEBHOOK_SECRET`).
- **Sicherer Datei-Upload:** Typ/Größe serverseitig validieren, nur Whitelist (Bilder/Video), **kein** ausführbarer Content, EXIF-Strip, Speicherung außerhalb Web-Root (Storage-Buckets), signierte/zeitlich begrenzte Upload-URLs (Presigned, schon im Video-Maker), Malware-Scan erwägen.
- **DDoS**: Vercel/Cloudflare-Edge davor.
- **Output-Encoding** (React escaped per Default) → kein XSS; bei KI-HTML-Links (Spot-Links) **Sanitizing**/Whitelist.

### 1.5 Secrets, Dependencies, Monitoring
- **Alle Keys in ENV/Secret-Manager** (Vercel/Supabase), nie im Repo; Key-Rotation dokumentiert.
- **Least Privilege**: Service-Role-Key nur serverseitig; Storage-Token nur nötiger Scope.
- **Dependency-Scanning** (Dependabot/`npm audit`), regelmäßige Updates.
- **Logging & Monitoring** (Vercel/Supabase-Logs, Error-Tracking z.B. Sentry-EU), Alerts bei Anomalien; **Audit-Log** für Admin-Aktionen.
- **Backups** (Supabase Point-in-Time-Recovery), Restore getestet.
- **Security-Review** vor Launch (z.B. OWASP-Top-10-Check, ggf. Pentest).

---

## 2. DSGVO / Datenschutz (AT + EU)

### 2.1 Grundprinzipien
- **Rechtsgrundlagen (Art. 6):** Vertrag (Kauf/Account), berechtigtes Interesse (Sicherheit), **Einwilligung** (Marketing/nicht-essenzielle Analytics).
- **Datenminimierung & Zweckbindung:** nur erheben, was nötig ist. **EXIF/GPS** aus Upload-Bildern strippen.
- **EU-Datenresidenz:** Supabase **EU (Frankfurt)**, Cloudflare R2 **EU**, Storage EU. Verarbeitung möglichst in der EU.

### 2.2 Auftragsverarbeiter (AVV/DPA abschließen)
Für **jeden** Dienst, der personenbezogene Daten verarbeitet, **AVV** (Art. 28): Supabase, Vercel, Stripe, **Anthropic (Claude)**, OpenAI (STT/Embeddings), ElevenLabs (TTS), Mapbox, Google (Places), Meteoblue, Cloudflare, Creatomate, Resend, Analytics-Tool.
- **Drittlandtransfer (USA):** wo US-Dienste → **EU-US Data Privacy Framework** / **SCCs** sicherstellen, in Datenschutzerklärung nennen. Wo möglich EU-Region/EU-Anbieter wählen.

### 2.3 Betroffenenrechte & Pflichten
- **Auskunft / Löschung / Berichtigung / Datenportabilität** umsetzen (Self-Service im Profil: Daten exportieren, Account löschen).
- **Verzeichnis von Verarbeitungstätigkeiten** (Art. 30) führen.
- **DSFA/DPIA** prüfen: KI-Personalisierung/Profiling + Standortdaten können eine Datenschutz-Folgenabschätzung nötig machen.
- **Datenpannen:** Meldeprozess **72 h** an die **österr. Datenschutzbehörde (DSB)**.
- **Aufbewahrungsfristen:** definieren & automatisiert durchsetzen (z.B. **Video-Maker-Originale 24 h**, Logs begrenzt, inaktive Anon-Daten löschen).
- **Kinder/Minderjährige:** keine gezielte Datenerhebung; ab-18-Marketing.

### 2.4 Cookies / Tracking (ePrivacy/TTDSG-Linie)
- **Ohne Einwilligung nur technisch notwendige** Cookies. **Cookieless EU-Analytics** (Plausible/PostHog-EU) bevorzugen → minimiert/erübrigt Consent-Banner.
- Falls doch einwilligungspflichtige Tools: **Consent-Banner** (Ablehnen so einfach wie Zustimmen, granular, kein Dark-Pattern), Consent dokumentiert.

### 2.5 Rechtstexte (Österreich-spezifisch)
- **Impressum/Offenlegung** (ECG §5, Mediengesetz §24/§25): Steiner Media / Anton Steiner, Kontakt, UID etc.
- **Datenschutzerklärung** (vollständig: Verarbeitungen, Rechtsgrundlagen, Empfänger, Drittland, Rechte, DSB-Beschwerde).
- **AGB** + **Widerrufsbelehrung (FAGG)**: bei digitalem Einmalkauf Hinweis auf **Verlust des Widerrufsrechts** bei sofortiger Bereitstellung mit Zustimmung (sauber im Checkout abbilden — alte Seite hat „Widerruf"-Link, übernehmen/aktualisieren).
- **Sound/Brand-/Bildrechte:** Kooperations-Hinweis (SalzburgerLand/Gastein) beibehalten.

---

## 3. EU AI Act (Transparenz — gilt ab 2. Aug 2026)
- **Pflicht:** Nutzer müssen **erkennen, dass sie mit einer KI** interagieren (Art. 50). → KI „Anton" **klar als KI kennzeichnen** (Begrüßung/Hinweis), Datenschutz-Hinweis zur KI-Verarbeitung (Anbieter nennen). Antons Bots tun das bereits — beibehalten/aktualisieren auf Claude.
- **KI-Ausgaben** (Texte/Audio/Video aus KI) ggf. als KI-generiert kennzeichnen, wo relevant.
- Risikoklasse: Reise-Empfehlungs-Chatbot = **minimal/limited risk** → v.a. **Transparenzpflichten**. Kein Hochrisiko, aber dokumentieren.
- Verstöße: bis **35 Mio. € / 7 % Umsatz** → ernst nehmen.

---

## 4. Verankerung in der Architektur (wo greift was)
- **Pro-Gating, RLS, Validierung** → Datenmodell & alle Server-Routes (`02` §2,5,17).
- **Caching-Layer/Keys in ENV** → externe APIs (`02` §7).
- **EXIF-Strip, EU-Storage, 24 h-Löschung** → Medien-Pipeline & Video-Maker (`28`,`25`).
- **KI-Transparenz, Regel-Engine (Safety: Baden/Unwetter), Free-Limit** → KI-Assistent (`02` §6).
- **Stripe-Webhook-Signatur, PCI (Checkout hosted)** → Membership (`02` §5).
- **Consent-armes EU-Analytics** → Analytics (`02` §14).
- **Rechtstexte + Self-Service-Rechte** → Profil/Footer/Landingpage.

## 5. Pre-Launch-Checkliste (Auszug)
- [ ] RLS auf allen Tabellen aktiv & getestet · [ ] Security-Header/CSP gesetzt · [ ] Rate-Limits & Turnstile aktiv · [ ] Stripe-Webhook-Signatur geprüft · [ ] Secrets nur in ENV, Rotation dokumentiert · [ ] Dependency-Scan grün · [ ] EXIF-Strip aktiv · [ ] EU-Region überall · [ ] AVVs unterschrieben · [ ] Datenschutzerklärung/Impressum/AGB/Widerruf aktuell · [ ] Cookie-/Consent-Linie umgesetzt · [ ] KI-Transparenzhinweis sichtbar · [ ] Lösch-/Export-Self-Service · [ ] Backup-Restore getestet · [ ] **Anwalt/DSB-Review erfolgt.**

---
### Quellen
- [EU AI Act Art. 50 (Transparenz)](https://artificialintelligenceact.eu/article/50/), [AI-Act-Transparenz ab Aug 2026](https://artificialintelligenceact.eu/transparency-rules-article-50/), [EU-Kommission AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- DSGVO/Österreich: Datenschutzbehörde (dsb.gv.at), DSG, ECG §5, Mediengesetz, FAGG.
