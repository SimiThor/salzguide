# 34 — Sicherheits- & Datenschutz-Audit

Vollständiger Audit der gesamten Plattform (Code + DB-RLS + Konfiguration) gegen die
typischen „Vibe-Code"-Schwachstellen und die EU/AT-Rechtslage.
**Stand: Juli 2026.** Firma in Österreich (EU) → DSGVO + AT TKG 2021 + EU AI Act.

Recherche-Grundlage (extern, verifiziert): CVE-2025-48757 (offene Supabase-RLS, 10,3 %
der Lovable-Projekte), Supabase-Security-Best-Practices, LG München I (3 O 17493/20,
Google-Fonts-Selfhosting), AT TKG 2021 §165(3) (Cookie-Consent).

---

## A. Verifiziert GUT — kein Handlungsbedarf
Am echten Code/DB geprüft (nicht geraten):

1. **RLS auf ALLEN 17 Tabellen aktiv** mit korrekten Policies. Kein CVE-2025-48757-Muster
   (keine offene Tabelle). `is_admin()` = `SECURITY DEFINER` mit fixem `search_path`
   (kein Rekursions-/Injection-Risiko). Nutzer-Daten (`profiles`, `saved_*`,
   `ai_conversations/messages`) nur eigene Zeile; `profiles`-SELECT nur eigene → **kein
   E-Mail-Leak an fremde User**. `api_cache`/`ai_usage`/`event_research_log` = service-only
   (Default-deny).
2. **Secrets sauber:** `.env.local` nicht in Git (nur `.env.local.example`). **Kein Secret
   an `NEXT_PUBLIC_`** (nur Mapbox-Token, Supabase-URL, Anon-Key, Site-URL — alle öffentlich
   by design). Service-Role-Key + Anthropic-Key + Cron-Secret nur server-seitig; **von
   keiner `"use client"`-Datei importiert**.
3. **Admin-Actions alle abgesichert:** jede mutierende Action (`saveSpot`, `deleteSpot`,
   `saveEvent`, `saveAnchor`, KI-/Übersetzungs-Actions …) prüft `getUser()` + `profiles.role
   === 'admin'` (bzw. `requireAdmin()`). Zusätzlich RLS als zweite Schicht (Session-Client).
4. **Merklisten-Actions:** Login-Pflicht, `user_id`-Bindung, nur `status='published'`
   speicherbar → kein IDOR.
5. **Kein `dangerouslySetInnerHTML`, kein `eval`/`new Function`.** KI-Text wird über einen
   sicheren React-Renderer (nur `[Label](url)`/`**fett**`) gerendert — keine HTML-Injection.
   KI-Karten sind hallucinationssicher (nur real vom Tool gelieferte Spots/Events).
6. **Google Fonts lokal** via `next/font` (Self-Hosting, keine Laufzeit-Anfrage an Google)
   → DSGVO-konform gemäß LG München I (3 O 17493/20). Kein `<link>`/`@import` zu Google.
7. **Cron** (`/api/cron/events`) mit `CRON_SECRET`-Bearer, fail-closed (401 wenn Secret fehlt).
8. **Externe Links** `target="_blank"` überall mit `rel="noopener noreferrer"`.
9. **CVE-2025-29927** (Next.js Middleware-Auth-Bypass, CVSS 9.1): **nicht betroffen** — Next.js
   16.2.9 (Patch ab 15.2.3), und unsere Middleware (`proxy.ts`) macht KEINE Autorisierung
   (nur Locale + Session-Refresh); Authz liegt in Server-Actions + RLS.
10. **Storage** (`spot-media`): Bucket public-read (Bilder sind öffentlich), aber
    **Insert/Update/Delete nur `is_admin()`** (Storage-RLS) → kein Fremd-Upload. Dateiname
    `crypto.randomUUID().webp` (kein Path-Traversal, `upsert:false`); Canvas-WebP-Konvertierung
    **strippt EXIF/GPS** (DSGVO).
11. **Kein SSRF:** alle server-seitigen `fetch`-Hosts sind fest verdrahtet (Anthropic, ORS,
    Google Places, Meteoblue, Behörden-Open-Data) — kein user-kontrollierter Host/URL.
12. **Keine PostgREST/SQL-Injection:** kein User-Input in Text-Filtern; die `.or()`-Zeitfilter
    in `events.ts` nutzen server-generierte ISO-Zeitstempel, nicht User-Input.

---

## B. Sofort behoben — in diesem Audit umgesetzt
1. **XSS über Link-Schema:** externe URLs aus DB/KI (`website_url`, `ticket_url`,
   `source_url`) wurden ungefiltert als `href` gerendert → `javascript:`/`data:`-URLs möglich.
   Neuer Helfer `src/lib/url.ts` (`safeHttpUrl`/`safeHref`, nur http/https/tel/mailto);
   angewandt in `ActionTile` (fällt bei unsicherem Schema auf nicht-klickbares Element zurück)
   und `EventCard`. (KI-Nachrichten validierten `^https?://` bereits.)
2. **Security-Header** (`next.config.ts`, alle Routen): `X-Frame-Options: DENY` (Clickjacking),
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy` (nur eigene Geolocation für die Karte; Kamera/Mikro/USB/Payment aus),
   `Strict-Transport-Security` (HSTS).
3. **KI-Endpunkt Kosten-/DoS-Backstop:** Gast-Limit hing nur am Cookie (Cookie löschen →
   wieder 3 frei → Bot konnte unbegrenzt Claude-Calls auslösen). Ergänzt: **IP-Backstop**
   (SHA-256-gehashte IP + Server-Salt → kein Klartext-IP in DB, DSGVO-schonend),
   `IP_GUEST_CAP = 40`/Tag pro IP, nur für Gäste.
4. **Magic-Link Host-Header-Injection:** in Produktion wird die feste `NEXT_PUBLIC_SITE_URL`
   statt des angreifer-steuerbaren `Origin`-Headers als Redirect-Basis genutzt.
5. **🔴 Privilege Escalation über `profiles` (KRITISCH):** Die RLS erlaubte einem eingeloggten
   User, die eigene Zeile zu ändern — ohne Spaltenschutz. Ein User hätte per direktem
   PostgREST-Call `PATCH /profiles {"role":"admin"}` oder `{"is_pro":true}` sich selbst zum
   **Admin machen bzw. Pro erschleichen** können. **Fix:** Trigger `protect_profile_columns`
   (`0016_protect_profile_columns.sql`) setzt `role`/`is_pro`/`pro_since`/`pro_source`/
   `stripe_customer_id` für normale User (Bedingung `auth.uid() is not null and not is_admin()`)
   auf die alten Werte zurück. Service-Client, Migrationen und Admins bleiben ungehindert.
6. **Open Redirect im Auth-Callback:** `?next=` war user-kontrolliert. Jetzt wird das Ziel
   gegen unsere Origin aufgelöst und die **resultierende Origin geprüft** (`new URL().origin`)
   → bulletproof, deckt auch Steuerzeichen-Tricks ab (siehe Härtetests).

### Härtetest-Runde (adversarial getestet, Bypässe in den eigenen Fixes gefunden & geschlossen)
7. **`safeHttpUrl`/`safeHref` Backslash-Bypass:** `"/\evil.com"` wurde durchgelassen — Browser
   normalisieren `\`→`/`, d.h. es würde zu `//evil.com` (Open Redirect). Fix: Backslash im
   relativen Zweig verboten. **18/18 Angriffs-Payloads** (javascript:, data:, Tab/Newline im
   Schema, protocol-relative, Backslash) blockiert.
8. **Auth-Redirect Steuerzeichen-Bypass:** `"/⇥//evil.com"` (Tab) hätte die String-Prüfung
   umgangen (`new URL` entfernt den Tab → `//evil.com`); die Error-Weiterleitung feuert sogar
   ohne gültigen Code. Fix = Origin-Vergleich (Punkt 6). **12/12 Angriffe bleiben on-origin.**
9. **KI-IP-Backstop war fälschbar:** nahm den linkesten `x-forwarded-for` (client-gesetzt →
   Cap umgehbar + `ai_usage`-Zeilen flutbar). Jetzt `x-real-ip` (vom Vercel-Edge gesetzt,
   client-seitig nicht fälschbar; Vercel überschreibt eingehendes XFF).
10. **KI-Endpunkt:** Body-Size-Cap (413 bei > 100 KB) + **Same-Origin-Check** (403 bei
    Cross-Site-`Origin`) → keine fremde Seite kann fremde KI-Kontingente verbrauchen.
11. **Gesperrte Pro-Pins:** zeigten die EXAKTEN Koordinaten des geheimen Spots. Jetzt auf
    ~1 km grob gerundet (`fuzzCoord`) → Teaser zeigt die Gegend, nicht den Punkt.

---

## C. VOR DEPLOYMENT zwingend — dokumentiert (noch offen)

### C1. ✅ BEHOBEN — Pro-Inhalte waren über den Anon-Key direkt lesbar (Paywall-Bypass)
`spots_public_read` erlaubte alle `status='published'`-Zeilen **inklusive `is_pro=true`**.
Damit waren Pro-Spot-Inhalte über die öffentliche PostgREST-API mit dem **Anon-Key** direkt
abrufbar — an der App vorbei. **Konkret nachgewiesen:** der Anon-Key lieferte den Pro-Spot
„Liechtensteinklamm" mitsamt Titel aus.

**Fix umgesetzt:**
- `public.is_pro_user()` (`SECURITY DEFINER`) + verschärfte RLS in
  `0017_pro_content_rls.sql`: anon/Nicht-Pro lesen nur `is_pro=false` published Spots
  (+ deren translations/media); Pro-Zeilen nur für Pro-User bzw. Admin.
- `getExploreData`/`getSpotDetail` (`src/lib/spots.ts`) laufen über den **Service-Client**
  mit **autoritativem Blanking** (Pro-Felder werden server-seitig genullt, bevor etwas zum
  Client geht) und ermitteln `canSeePro` aus der Session (Pro-User/Admin). `getPublishedSpots`
  bleibt am Session-Client → RLS blendet Pro automatisch aus. Doppelte Schicht: RLS schützt
  den Direktzugriff, Code-Blanking den App-Pfad.

**Nach Anwendung von 0017 verifizieren:** Anon-Query auf Pro-Spots muss **0** liefern:
```
GET /rest/v1/spots?select=slug&status=eq.published&is_pro=eq.true   (apikey = Anon)
```

### C2. 🔴 Supabase Auth — Redirect-URL-Allowlist
Im Supabase-Dashboard die erlaubten Redirect-URLs strikt auf `https://salzguide.com/**`
(+ lokal `http://localhost:3000/**`) begrenzen. Das ist die eigentliche Sperre gegen
Magic-Link-Phishing (der Code härtet bereits, die DB-Allowlist ist maßgeblich).

### C3. 🟡 Content-Security-Policy — Report-Only umgesetzt, enforce ausstehend
**Umgesetzt:** `Content-Security-Policy-Report-Only` in `next.config.ts` (nur Produktion,
verifiziert ausgeliefert). Bricht nichts, meldet Verstöße in der Browser-Konsole.
**TODO vor Launch:** In Produktion normal nutzen (Karte, Login, KI, Foto-Upload) und die
Konsole auf CSP-Verstöße prüfen; wenn sauber → Header-Key auf `Content-Security-Policy`
(ohne `-Report-Only`) umstellen = enforce. Falls Mapbox/Next Verstöße zeigt, betroffene
Quelle ergänzen (häufig `script-src`/`worker-src`).
Aktuelle Policy:
```
default-src 'self';
script-src 'self' 'unsafe-inline';        # besser: Nonce statt unsafe-inline
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.supabase.co https://*.mapbox.com;
connect-src 'self' https://*.supabase.co https://*.mapbox.com https://events.mapbox.com;
worker-src blob:;                          # Mapbox GL braucht blob-Worker
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
upgrade-insecure-requests;
```
Anthropic-/Google-/ORS-Calls laufen server-seitig → gehören NICHT in `connect-src`.

### C4. 🟡 Bot-Schutz & Burst-Rate-Limit
- **✅ Burst-Limit umgesetzt:** `hit_ai_burst`-RPC + Tabelle `ai_burst`
  (`0018_ai_burst_limit.sql`) → max. 6 Anfragen/Minute pro Subjekt am KI-Endpunkt (auch Pro).
  Atomarer Fixed-Window-Zähler, eine Zeile/Subjekt (in-place), veraltete Zeilen putzt der Cron.
- **⬜ noch offen (du):** **Cloudflare Turnstile** (o.ä.) auf KI-Chat + Magic-Link (braucht Keys);
  Supabase-Auth-eigene Rate-Limits bestätigen.

### C5. 🟠 Mapbox-Token restringieren
Im Mapbox-Dashboard URL-Restriction (nur `salzguide.com`) + minimale Scopes. Der Token
ist öffentlich (NEXT_PUBLIC) — die Domain-Restriktion ist der Schutz gegen Fremdnutzung.

### C6. ✅ Analytics & Cookie-Consent
Die App setzt **nur essenzielle/funktionale Cookies** (Supabase-Auth, next-intl-Locale,
`sg_aid` Abuse-Schutz). Analytics ist **cookieless umgesetzt** (§H) → nach AT TKG §165(3)
**kein Consent-Banner erforderlich**. Datenschutzerklärung um den Analytics-Baustein (§H)
ergänzen. **Falls** je ein cookie-basiertes Tool dazukommt (z.B. PostHog mit Cookies,
Marketing-Pixel), dann ist ein **Opt-in-Consent-Banner** nötig (Consent-Cookie = exempt).

### C7. 🟡 Rechtstexte & Betroffenenrechte (DSGVO)
- **✅ Self-Service Account-Löschung + Datenexport (Art. 15/17/20) umgesetzt:** Profil-Seite
  → „Deine Daten & Datenschutz". Export = JSON-Download (`exportMyData`, Session-Client/RLS =
  nur eigene Daten). Löschung (`deleteMyAccount`) entfernt `ai_usage` (Text-Subject, kein FK)
  + `auth.users` via Auth-Admin-API → `on delete cascade` räumt profiles/saved_*/ai_* restlos.
  Cascade-Kette + Query-Formen gegen die Live-DB verifiziert.
  **✅ Newsletter-Widerruf** (Einwilligung jederzeit abschaltbar, `setNewsletter`) in derselben
  Sektion — Toggle auf `profiles.newsletter_opt_in` (nicht vom Privilegien-Trigger blockiert).
- **⬜ noch offen (du):** Datenschutzerklärung (nennt Auftragsverarbeiter **Supabase, Vercel,
  Anthropic, Google Places, Mapbox, Resend** + EU/Drittland), Impressum/ECG, AGB, Widerruf/FAGG.
- **⬜ AVV/DPAs** mit allen Auftragsverarbeitern; USA-Verarbeiter (Anthropic, Google) via **DPF/SCCs**.
- **✅ EU AI Act:** Anton ist als KI gekennzeichnet (Disclaimer im Chat) — beibehalten.

### C8. 🟠 EU-Datenresidenz & Supabase-Härtung
- Supabase-Projekt in EU-Region (Frankfurt) bestätigen; Vercel EU wo möglich.
- Supabase-Dashboard: **Leaked-Password-Protection** an, **MFA** für Admin-Accounts,
  Postgres aktuell, Backups/PITR, DB-Netzwerkzugriff einschränken.

---

## D. Hardening — nice-to-have
- Admin-Check konsolidieren: 1 gemeinsamer `requireAdmin()`-Helper statt 3 Varianten
  (`admin-actions.ts` inline, `event-actions.ts`, `anchor-actions.ts`) → weniger Drift-Risiko.
- **Prompt-Injection ist bewusst begrenzt:** die KI hat nur Lese-Tools auf `published`-Daten,
  keine sensiblen/schreibenden Tools → keine Datenexfiltration möglich. So lassen (keine
  sensiblen Tools ergänzen).
- Log-Hygiene: keine PII/Secrets in Logs (aktuell nur Fehlermeldungen — ok).
- **`ai_usage`-Retention (DSGVO-Datensparsamkeit): ✅ umgesetzt** — der wöchentliche Cron
  (`/api/cron/events`) löscht pseudonyme Zähler-Zeilen (gehashte IP, Gast-UUIDs) älter als
  90 Tage (`cleanupOldAiUsage`). Chat-Verlauf löscht bereits per `on delete cascade` mit dem Account.
- **`profiles.email` vom User änderbar** (nur Anzeige-Kopie; Auth läuft über `auth.users`, nicht
  über diese Spalte) → geringes Risiko; bei Bedarf in den `protect_profile_columns`-Trigger
  aufnehmen. Notiert.
- **Koordinaten-Rundung (Punkt 11) ist tunebar:** gröber runden oder Pro-Pins ganz verstecken —
  Produktentscheidung (Teaser-FOMO vs. maximaler Geheimnis-Schutz).
- **Dependencies:** `npm audit` = 3× **moderate** (PostCSS „XSS via unescaped `</style>`",
  GHSA-qx2v-qp2m-jg93), transitiv über `next`/`next-intl`. **Build-Zeit-Tool, nicht ausnutzbar**
  (wir verarbeiten keine fremde CSS). Kein Force-Update (bräche Next); mit dem nächsten
  regulären Next-Update mitziehen. Regelmäßig `npm audit` vor Deployment.

---

## F. User-Daten-Härtetest (live, adversarial) — bestanden
Mit **zwei echten Test-Usern (A/B) + deren Tokens** direkt gegen die Produktions-REST-API
getestet (Angriffsmethoden aus der Recherche: direkte REST-Umgehung, **`gt`/`lt`-UUID-Trick**,
Mass-Assignment, Enumeration, Cross-User-Insert, SECURITY-DEFINER-RPC). **19/19 dicht:**
- **IDOR/BOLA:** A liest B's Profil NICHT; `gt`-Trick auf profiles gibt nur die eigene Zeile
  (RLS filtert wirklich, nicht nur `.eq()`). ai_conversations/ai_messages/saved_events/
  saved_lists per `gt`-Trick alle leer für Fremdzugriff.
- **Mass-Assignment (0016 LIVE bestätigt):** A kann sich per Direkt-PATCH **weder `role=admin`
  noch `is_pro=true`** setzen; legitime Änderung (eigener Newsletter) funktioniert weiter.
- **Enumeration:** A sieht nur die eigene profiles-Zeile (keine fremden E-Mails).
- **Cross-User:** A kann B's Profil nicht ändern und kein `saved_event` für B anlegen (with-check).
- **`ai_usage`** (pseudonyme Daten) für Authenticated NICHT lesbar; **`bump_ai_usage`**-RPC für
  Authenticated gesperrt (revoke greift).
- **Anonym:** kein Lesezugriff auf profiles/ai_conversations/ai_usage/saved_events.
- **Consent:** Newsletter-Checkbox nicht vorangekreuzt (EuGH „Planet49" ok); Opt-out vorhanden.
- **Keine PII in Logs**; Auth-Cookies via @supabase/ssr (httpOnly/secure/sameSite), Gast-Cookie ebenso.
- **Alle SECURITY-DEFINER-Funktionen** ohne Ownership-Gap (is_admin/is_pro_user param-los = eigener
  Status; bump/hit_ai_burst revoked = nur Service).

**GDPR-2026-Einordnung:** Verschlüsselung at-rest = Supabase-Standard (AES-256, managed Postgres —
im Dashboard bestätigen). Pseudonymisierung (gehashter IP) umgesetzt. DSAR (Auskunft/Export/
Löschung) umgesetzt & verifiziert. Datensparsamkeit (Retention) umgesetzt.
**Rest organisatorisch (du):** DPIA, Verzeichnis von Verarbeitungstätigkeiten (Art. 30),
72h-Breach-Prozess, Backup-Retention (Löschung rollt aus Backups aus), AVVs/EU-Region (C7/C8).
**Kleiner Rest-Punkt (unkritisch):** keine Rectification-UI (Art. 16) für display_name/E-Mail-
Änderung — bei Bedarf als Feature; `profiles.email` ist eine Anzeige-Kopie (nur eigene Zeile
änderbar, kein Fremdeinfluss).

## G. Moderne Angriffsflächen (OWASP LLM Top 10 2025/26, DoW, TOCTOU, ReDoS)
- **🔴→✅ TOCTOU-Race auf dem Rate-Limit (Denial-of-Wallet-Vektor):** die Limit-Prüfung war
  „erst lesen, später hochzählen" → nebenläufige Requests konnten den Zähler gemeinsam
  unterlaufen (Free-Kontingent per Concurrency überziehen). **Fix:** Reihenfolge = Burst zuerst,
  dann **bump-first atomar** (Tages- und IP-Zähler werden VOR dem Lauf über den atomaren Upsert
  hochgesetzt und geprüft). **Live bewiesen:** 20 gleichzeitige Increments → Zähler 1..20
  lückenlos & doppelfrei (kein Lost Update). Free-Limit ist jetzt exakt statt „~burst-viele".
- **Denial of Wallet (OWASP LLM):** abgedeckt durch Tages- (Gast 3/Free 15) + IP-Cap (40) +
  Burst (6/min, atomar) + Body-Cap (100 KB) + Input-Cap (800 Zeichen × 24 Turns). Query-Pattern-
  Monitoring/Alerting = organisatorisch (empfohlen).
- **ReDoS:** kein Regex mit verschachtelten Quantoren; die auf User-/KI-Input laufenden Regexe
  sind linear (negierte Zeichenklassen). Sauber.
- **Cache-Poisoning von Pro-Inhalten:** keine `force-static`/`revalidate`-Direktiven; die DB-
  Seiten sind dynamisch (per-User, `viewerCanSeePro` liest Cookies) → kein CDN-Cache über User.
- **Image-Optimizer-SSRF:** `next/image` wird nicht genutzt (App rendert `<img>`) → kein
  Optimizer-Endpunkt exponiert.
- **Prompt-Injection / Jailbreak (Restrisiko, akzeptiert + mitigiert):** die KI hat NUR Lese-
  Tools auf öffentliche `published`-Daten (kein User-/Schreib-/Fetch-Tool) → keine Datenexfil,
  kein SSRF. Scope-Prompt begrenzt Off-Topic. Indirekte Injection via Spot-/Event-Text ist
  admin-gated (nur Admins schreiben Inhalte). Vollständige LLM-Guardrails sind inhärent
  begrenzt — Rate-Limits + Scope + fehlende sensible Tools sind die robuste Absicherung.
  Zusätzlich: `sanitizeMessages` erlaubt nur die Rollen `user`/`assistant` → **keine
  „system"-Rolle** aus dem Client injizierbar (kein System-Prompt-Override).

### Runde 4 (Auth-Session, Admin, Cache-Deception, Storage-Abuse)
- **✅ `getSession` vs `getUser`:** die App nutzt für **jede** server-seitige Autorisierung
  `getUser()` (validiert gegen den Auth-Server) — **kein** `getSession()`-Authz-Pfad (der Cookie
  ungeprüft vertraut). Der bekannte Supabase-Auth-Bypass existiert nicht.
- **✅ Admin-Bereich:** komplett server-seitig durch das **Layout-Guard** (`getAdminUserId()` +
  `redirect`) geschützt — kein „nur client-seitig versteckt".
- **✅ CDN-Token-Refresh-Cache-Bug:** `@supabase/ssr 0.12.0` (> 0.10.0) sendet die nötigen
  Cache-Header beim Token-Refresh → keine Fremd-Session aus dem CDN.
- **✅ Web-Cache-Deception:** App-Router matcht exakte Routen (`/profil/x.css` → 404, nicht die
  Profil-Seite); DB-Seiten sind dynamisch (kein Cache); Middleware-Matcher schließt `*.*` aus.
- **✅ E-Mail-Header-Injection:** kein eigener E-Mail-Versand (Resend ungenutzt); Auth-Mails
  gehen über Supabase mit Redirect-Allowlist.
- **✅ Prototype-Pollution:** kein rekursives Mergen von User-Input; JSON-Felder werden per Key
  gelesen, nicht in gemeinsame Objekte gemischt.
- **🟠→✅ `locale` aus Formularfeld ungeprüft:** `sendMagicLink`/`signOut` nahmen `locale` roh
  → jetzt `safeLocale()` gegen die Whitelist `["de","en"]` festgenagelt (keine getürkten
  Redirect-/Pfad-Werte).
- **🟠→✅ Gast-Cookie Storage-Abuse:** ein manuell gesetztes, überlanges `sg_aid` hätte riesige
  `ai_usage`/`ai_burst`-Subjekte anlegen können → jetzt wird nur ein **UUID-förmiges** Cookie
  akzeptiert, sonst neu generiert.

## H. Analytics — datenschutzkonform (First-Party, cookieless)
**Rechtslage AT/EU (Juli 2026):** TKG 2021 §165 greift auf der Geräte-Zugriffs-Ebene —
„berechtigtes Interesse" hebelt die Consent-Pflicht für Cookies/Storage NICHT aus. Nur
**echtes cookieless** Tracking (null Lesen/Schreiben am Gerät) umgeht den Banner. Das
Plausible-Modell (täglich rotierender, verworfener Salt-Hash) wurde von der **DSK 2022
akzeptiert**; Rechtsgrundlage = berechtigtes Interesse (Art. 6(1)(f)), aggregat-only.

**Umsetzung (robust & sauber):**
- **Null Cookies/Storage** am Client — Beacon `<Analytics>` sendet nur Pfad+Referrer an
  `/api/track` (`credentials:'omit'`, kein localStorage). **Nur in Produktion aktiv.**
- **IP wird NIE gespeichert** — nur transient zu `visitor_hash = sha256(tages-salt : ip : ua)`.
  Salt liegt in `analytics_salt`, wird vom Cron **nach 2 Tagen gelöscht** → Hashes danach
  unumkehrbar anonym. Events werden nach ~14 Monaten gelöscht.
- **Nur Aggregate** im Admin (`/admin/analytics`), Zeitraum umschaltbar (30 T / 3 / 6 / 12 Monate):
  Seitenaufrufe, **Besuche/Sessions, Bounce-Rate, Ø Verweildauer** (cookieless aus der Pageview-
  Abfolge je visitor_hash rekonstruiert, Plausible-Methode), **Merkungen** (Spots/Events, eigene
  Events), **Event-Link-Klicks**, **Kategorie-Beliebtheit** (Spot-subtype nach Aufrufen, Event-
  Kategorie nach Merkungen), **Top-Spots/Events nach Merkungen**, **Kampagnen/UTM** (Ad-Qualität:
  Besuche, Seiten/Besuch, Bounce je Kampagne), **Quellen, Land** (2-Letter aus Edge-Geo, keine IP),
  Geräte, Sprache, KI-Anfragen, **Conversions** (vorbereitet für Stripe). RPCs SECURITY DEFINER,
  für User gesperrt; Admin-Guard; keine Einzel-Nutzer-Ansicht.
- **Kampagnen-URLs**: `?utm_source/medium/campaign` oder Kurzform `?s=` / `?c=`
  (z.B. `salzguide.com/?c=ig-sommer24`). Attribution über die Einstiegs-Session (cookieless,
  first-session; Cross-Device/Cross-Visit nicht möglich = bewusst datensparsam).
- **Retention**: Salt nach **2 Tagen** gelöscht → Visitor-Hashes danach **irreversibel anonym**
  (fallen aus der DSGVO → Jahresvergleiche zulässig). Roh-Events ~14 Monate (Cron), damit der
  12-Monats-Bereich direkt funktioniert; danach Löschung. Skalierungspfad: tägliche Rollups.
- **EU-Residenz** (Supabase EU), **Same-Origin**-Ingestion, `/admin` wird NICHT getrackt.
- Migrationen `0019_analytics.sql` + `0020_analytics_v2.sql` einspielen; Klassifizierer 22/22 getestet.

**v3-Erweiterungen (in 0020):**
- **Filter** (jede RPC, optionale Params): Sprache, Land, Gerät, Quelle, Kampagne — für
  Zielgruppen-Segmentierung. Save-/KI-Events tragen Land/Gerät/Sprache (aus Headers), damit
  die Filter überall greifen (Quelle/Kampagne bleiben traffic-scoped).
- **Custom-Zeitraum** von–bis zusätzlich zu den Presets; Bucket automatisch (Tag/Woche/Monat).
- **Top-Spots nach Aufrufen UND Merkungen**; Merkrate (Saves/100 Aufrufe).
- **Ad-Link-Generator** im Dashboard (Kurz-URLs `?s=&c=`, rein clientseitig).
- **KI-Auswertung** (`src/lib/analytics-ai.ts`, Button im Dashboard): schickt **ausschließlich
  anonyme Aggregat-Kennzahlen** (keine Roh-Events/Hashes/IP) an Claude → kurze, umsetzbare
  Einschätzung. Da keine personenbezogenen Daten übertragen werden, DSGVO-unkritisch; Anthropic
  ist ohnehin als Auftragsverarbeiter gelistet (AVV/DPF, §C7). Admin-only (Server-Action prüft).
- **Live verifiziert** (Testdaten mit echten Sessions → alle RPCs exakt, Filter, Sicherheit,
  /api/track end-to-end; 48/48 Checks). **Fund + Fix:** die alte 0019-`analytics_breakdown`
  (4 Args) kollidierte mit der neuen (9 Args) → PostgREST-Mehrdeutigkeit (PGRST203). Behoben
  im Code (Dashboard ruft breakdown immer 9-armig auf) + Migration `0021_fix_breakdown_overload.sql`
  (droppt die alte Signatur, saubere Endform). Demo-Vorschau greift jetzt bei `pageviews===0`
  (nicht mehr durch einzelne Server-Events wie KI-Anfragen gestört).

**Datenschutzerklärung — Baustein (bitte übernehmen):**
> *„Reichweitenmessung: Wir werten die Nutzung unserer App anonymisiert und ausschließlich
> mit eigenen Mitteln aus (kein Google Analytics, keine Cookies, keine Weitergabe an Dritte).
> Zur Schätzung eindeutiger Besucher bilden wir einen täglich wechselnden, nicht rückführbaren
> Hashwert aus IP-Adresse und Browserkennung; die IP-Adresse wird dabei nicht gespeichert.
> Erfasst werden zudem anonym: aufgerufene Seiten, gemerkte Inhalte, Herkunft (Referrer/Kampagne
> aus dem aufgerufenen Link), grobes Land (nur Länderkürzel), Gerätetyp und Sprache. Es findet
> keine seiten- oder geräteübergreifende Wiedererkennung statt. Rechtsgrundlage ist unser
> berechtigtes Interesse an einer datensparsamen Reichweitenmessung (Art. 6 Abs. 1 lit. f DSGVO).
> Sie können der Verarbeitung jederzeit widersprechen: [Kontakt]."*

## §I — Anonyme KI-Chatbot-Auswertung (Anton-Insights)

**Ziel:** Verstehen, was Nutzer den Chatbot fragen, um die Plattform weiterzuentwickeln (welche Spots/Infos fehlen, welche Themen/Regionen gefragt sind, Sprach-Nachfrage) — **ohne personenbezogene Daten**.

**Rechtslage (Stand Juli 2026, recherchiert):**
- Chatbot-**Freitext ist besonders heikel** (kann Namen, Orte, sogar Art.-9-Daten enthalten) und mit `user_id` verknüpft = personenbezogen.
- **EDPB-Leitlinien 01/2025 (Pseudonymisierung):** pseudonymisierte/„geschwärzte" Freitexte bleiben personenbezogen, solange Re-Identifikation (auch theoretisch) möglich ist → **Roh-Logs schwärzen und auswerten ist KEIN sicherer Weg**.
- **Legitimes-Interesse-Weg (CNIL)** für Chatlog-Auswertung existiert, verlangt aber LIA + Information + jederzeitigen Widerspruch + Zweckbindung + Löschfristen → Aufwand + Restrisiko (vgl. TikTok-Bußgeld 530 Mio. € 2025 für Zweck-Ausweitung). **Bewusst NICHT gewählt.**
- **DSGVO Recital 26:** echt anonyme Daten (Aggregation/k-Anonymität) sind **außerhalb der DSGVO** → keine Rechtsgrundlage, kein Consent, keine Auskunfts-/Löschpflicht.

**Umsetzung = „Anonymisierung an der Quelle":** Aus jeder Anfrage werden per billigem Klassifikator (Claude Haiku, `tool_choice` erzwungen) NUR **geschlossene Codes** abgeleitet und gespeichert: `intent`, `category`, `region` (grob), `answered` (bool), `unmet_reason`, `locale`, `day`. **Nie gespeichert:** Rohtext, `user_id`, Session/Konversations-ID, IP, Uhrzeit (nur Tag; UUID v4 = zeitfrei). Damit ist jede Zeile für sich anonym → Recital 26. Zusätzlich **k-Anonymität (k≥5)** in den Read-RPCs (kleinere Buckets werden ausgeblendet). Gilt für Gäste UND eingeloggte (weil anonym → kein Consent nötig); Prod-Gate + Betreiber-Ausschluss wie die übrige Analytik. Die Klassifikation nutzt denselben Auftragsverarbeiter (Anthropic), der ohnehin antwortet → kein neuer Datenfluss; nichts Personenbezogenes wird persistiert. Läuft via `after()` NACH der Antwort → keine Latenz.

**Dateien:** `0022_ai_insights.sql` (Tabelle + `ai_insights_overview/_breakdown/_gaps`, k-anonym, service-only), `src/lib/ai-insights.ts` (Klassifikator + Read), `src/lib/ai-insights-summary.ts` (KI-Zusammenfassung, nur Aggregate), `src/components/admin/AiInsightsSummary.tsx`, Dashboard-Sektion „KI-Insights" in `admin/analytics/page.tsx`, Einhängung in `api/ai/chat/route.ts` via `after()`.

**Produkt-Nutzen:** Content-Lücken (unbeantwortete Wünsche → Spots aufnehmen), Datenlücken (fehlende Öffnungszeiten/Anfahrt → Spot-Daten ergänzen), Nachfrage-Landkarte (Themen/Regionen), Sprach-Nachfrage (→ EN-Übersetzung priorisieren), Pro-Interesse.

**AI Act, Art. 50 (ab 2. Aug. 2026):** KI-Kennzeichnung erfüllt — Disclaimer „Anton ist eine KI und kann Fehler machen" steht dauerhaft unter dem Eingabefeld (auch beim ersten Kontakt).

**Datenschutz-Baustein (Ergänzung Datenschutzerklärung):**
> *„KI-Assistent: Anfragen an unseren KI-Assistenten werden zur Beantwortung an unseren Auftragsverarbeiter (Anthropic) übermittelt. Zur Verbesserung der App werten wir Anfragen zusätzlich in ausschließlich **anonymisierter, aggregierter** Form aus (Themen-/Kategorie-Codes, keine Speicherung des Nachrichtentextes, kein Personenbezug). Diese anonymen Auswertungen erlauben keinen Rückschluss auf einzelne Personen."*

## Pre-Deploy-Checkliste
- [x] **C1** Pro-RLS (`0017_pro_content_rls.sql`) + `is_pro_user()` + Service-Client-Blanking — **Migration hochladen + Anon-Test = 0**
- [ ] **AI-Insights** `0022_ai_insights.sql` hochladen → danach RPCs live verifizieren; Datenschutz-Baustein §I in DSE übernehmen
- [ ] **C2** Supabase Redirect-URL-Allowlist
- [~] **C3** CSP — Report-Only live & verifiziert; nach Testphase auf enforce umstellen
- [~] **C4** Burst-Limit ✅ (0018); Turnstile offen (du)
- [ ] **C5** Mapbox-Token URL-Restriction
- [x] **C6** Analytics cookieless umgesetzt (kein Banner nötig); Datenschutz-Baustein §H übernehmen
- [~] **C7** Löschung/Export ✅ umgesetzt; Rechtstexte + AVVs offen (du)
- [ ] **C8** EU-Region + Supabase-Härtung (Leaked-PW, MFA, Backups)
