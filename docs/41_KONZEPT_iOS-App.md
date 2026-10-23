# 41 KONZEPT: Native iOS-App (Swift)

Stand: 23.10.2026. Grundlage: Code-Analyse vom 30.09.2026, Antons Entscheidungen vom
23.10.2026 und ein Faktencheck dieses Dokuments gegen den Code (23.10.2026). Dieses Dokument
ist die EINE Quelle für den Bau der App, so wie docs/40 für die Navigation. Wer daran baut,
liest es zuerst ganz. Ändert sich eine Entscheidung, wird sie HIER geändert, nicht nur im Code.

## 0. Ziel in einem Absatz

Eine native iPhone-App als Ergänzung zur Website. Sie nutzt dieselbe Datenbank und dieselben
Pro-Regeln, sieht aus wie SalzGuide und fühlt sich an wie eine App von Apple. Ihr eigentlicher
Grund sind die Audiotouren: Navigation zu Fuß und mit dem Rad, die bei gesperrtem Handy
weiterläuft, gesprochene Abbiegehinweise, Steuerung am Sperrbildschirm, Touren offline.
**Die Website darf dabei für keinen Nutzer schlechter werden.**

## 1. Entscheidungen (Anton, 23.10.2026)

| Thema | Entscheidung |
|---|---|
| Umfang v1 | Explore, Spots, Merkliste, Login, Pro erkennen + kaufen, Audiotouren mit nativer Navigation (Fuß + Rad), Touren offline |
| Später (v1.1+) | Toni, Events, Runden-Bauer (KI), Wasser, Story-Maker, Live-Aktivität, Apple Watch |
| Kauf | Apple-In-App-Kauf, Einmalkauf (kein Abo), **19,99 €**; nur angemeldet; im Web gekauftes Pro gilt in der App und umgekehrt |
| Login | **Code per Mail** (6-8 Stellen, siehe Abschnitt 5; kein Link), **Mit Apple anmelden**, **Google** |
| Login im Web | **Mit Apple anmelden** kommt auch ins Web (neben Google und Mail-Link), entschieden 23.10.2026. Grund: Wer sich in der App mit Apple und "E-Mail verbergen" anmeldet, hat eine fremde Relay-Adresse und käme sonst im Web nicht an sein Konto (und sein Pro). Ersetzt das Nein vom 17.07.2026. Der Knopf erscheint, wenn Apple in Supabase eingeschaltet UND `APPLE_SIWA_SERVICES_ID` gesetzt ist (`appleLoginEnabled()`, `lib/auth-providers.ts`) |
| Anbieter im App Store | Anton als Person (Apple-Entwicklerkonto existiert, bezahlt) |
| Bundle-ID | `com.salzguide.app` (23.10.2026): die Domain des Projekts statt einer Firma, damit sie auch nach einem späteren Umzug zu einer gemeinsamen Firma passt (App Transfer behält die Bundle-ID; Apple-Login-Nutzer brauchen dann einmal Apples Umzugsverfahren). Web-Kennung für Apple-Login: `com.salzguide.web` |
| Code | **eigenes privates Repo** für die App; die App-Schnittstelle kommt per PR ins Web-Repo, Simon merged |
| iOS-Version | aktuelle + vorige Hauptversion |
| Sprachen | alle 13 ab v1 (de, en, it, nl, ko, fr, zh, es, pt, pl, cs, hu, sk) |

Begründungen, damit sie nicht neu diskutiert werden:
- **Code statt Link:** Outlook Safe Links öffnet Mail-Links vorab und verbraucht Einmal-Tokens
  (Vorfall 18.10.2026, PR #304/#305). Ein Link müsste außerdem die App öffnen (Universal
  Link), was über umgeschriebene Safe-Links-Adressen nicht zuverlässig klappt. Einen Code
  tippt man ab, da kann kein Scanner etwas verbrauchen.
- **Apple-Login ist Pflicht**, weil die App Google-Login anbietet (Apple-Richtlinie). Fürs
  WEB galt Antons Nein vom 17.07.2026; es ist seit 23.10.2026 aufgehoben (Abschnitt 5, "Apple im Web"). In der App entfällt der Hauptgrund von damals:
  Der native Weg (`signInWithIdToken`) braucht laut Supabase-Doku nur die Bundle-ID, nicht das
  alle 6 Monate ablaufende Client-Secret. Beim Einrichten prüfen.
- **Kaufen nur angemeldet:** Pro hängt an `profiles.is_pro`. Nur mit Konto gilt ein App-Kauf
  auch im Web, und "Käufe wiederherstellen" findet das Konto.

## 2. Leitregeln

1. **Die App liest Inhalte NIE direkt aus Supabase.** RLS (0017) blendet Pro-Spots für
   Nicht-Pro ganz aus, es gäbe also keine Teaser. Audio liegt im privaten Bucket `tour-audio`
   und braucht signierte Links. Inhalte kommen ausschließlich über die App-Schnittstelle
   (Abschnitt 4), die dieselben Server-Funktionen wie die Website nutzt.
2. **Der Service-Key kommt nie in die App.** In der App stehen nur öffentliche Werte:
   Supabase-URL, Anon-Key (nur für den Login), Mapbox-App-Token.
3. **Nur Additives im Web-Repo.** Neue Routen unter `/api/app/v1/`, neue Tabellen/Spalten,
   neue Funktions-Varianten. Bestehende Web-Wege bleiben verhaltensgleich, belegt durch die
   Prüfungen in Abschnitt 10.
4. **NIE etwas Neues aus einer `"use server"`-Datei exportieren.** Jeder Export dort ist ein
   öffentlicher POST-Endpunkt, den jeder mit beliebigen Argumenten aufrufen kann. Eine
   Variante `getSpotRouteFor(slug, canSeePro)` in `spot-actions.ts` würde jede Pro-Route
   verschenken; ein `deleteAccountById(userId)` in `account-actions.ts` würde jedes Konto
   löschbar machen. Betroffen u. a.: `spot-actions.ts`, `account-actions.ts`,
   `saved-actions.ts`, `saved-state-actions.ts`, `user-tours.ts`, `stripe-actions.ts`.
   Neue Varianten und herausgelöste Kerne gehören in Module mit `import "server-only"`
   (Achtung, server-only-Falle: nie einen TYP aus so einem Modul in eine Client-Komponente
   importieren).
5. **Ein System statt Duplikate.** Pro-Regeln, Übersetzungen, Navigations-Logik und Texte
   haben eine Quelle im Web-Repo; die App übernimmt sie (Schnittstelle, Strings-Skript,
   Navigations-Fixtures), statt sie neu zu erfinden.
6. **Kleine, prüfbare Schritte.** Jede Phase endet mit "Fertig heißt" (Abschnitt 9) und
   einer Anleitung, was Anton am iPhone testet.

## 3. Modellwahl beim Bau

Antons Regel: für jede Arbeit das passendste Modell. Die Bau-Session selbst läuft auf **Opus**
(sie plant, verteilt, prüft). Umsetzung geht an Subagenten mit bewusst gesetztem `model`:

| Arbeit | Modell |
|---|---|
| Architektur, API-Vertrag, Datenmodell, Migrationen entwerfen | opus oder fable |
| Sicherheits-Review: Bearer-Auth, Pro-Gating, Apple-Kauf, Konto löschen, `"use server"`-Regel | opus oder fable |
| Übertragung des Navigations-Kerns prüfen, schwierige Fehlersuche | opus oder fable |
| Code-Review jedes PRs vor der Übergabe an Simon | opus oder fable |
| Rechtstexte (Datenschutz, AGB-Abschnitt), App-Review-Notizen | opus oder fable |
| SwiftUI-Ansichten, API-Routen nach Vertrag, Tests, Download-Manager, StoreKit nach Entwurf | sonnet |
| Strings-Umwandlung laufen lassen und abgleichen, Icon-/Farb-Export, Dateilisten, Status prüfen | haiku |

Im Zweifel eine Stufe höher. Alles, was Geld, Login oder Pro-Inhalte berührt, sieht vor dem
PR ein opus/fable-Review.

## 4. Die App-Schnittstelle (`/api/app/v1`, im Web-Repo)

### 4.1 Anmeldung an der Schnittstelle

- Die App schickt `Authorization: Bearer <Supabase-Access-Token>`. Ohne Header gilt sie als
  Gast (öffentliche Stufe), mit ungültigem oder abgelaufenem Token kommt **401**.
- **Lesen** (Katalog, Touren): Token lokal prüfen (`auth.getClaims(token)`, ES256), wie
  `currentUserId()` es für Cookies tut. Verlangt: nicht-leeres `sub` und
  `role = authenticated`.
- **Handeln** (Kauf verbuchen, Konto löschen, Einstellungen ändern): `auth.getUser(token)`
  beim Auth-Server, dieselbe Regel wie in `src/lib/viewer.ts`.
- Neues Modul `src/lib/app-auth.ts` (`server-only`):
  - `appViewer(request) -> { userId | null }`
  - `appCanSeePro(userId)`: liest `profiles.is_pro` und `role` per Service-Client für die
    GEPRÜFTE User-ID; **Admins zählen mit** (`is_pro || role === "admin"`), genau wie
    `viewerCanSeePro()` in `spots.ts`.
  - `createBearerClient(token)`: für JEDE Anfrage ein **frischer** Supabase-Client mit dem
    Nutzer-Token im Header und `persistSession: false`, damit RLS für eigene Daten greift.
    **Nie** eine Sitzung auf den geteilten Singleton `createServiceClient()` setzen.
- Der Proxy (`src/proxy.ts`) lässt `/api` aus; Anfragen ohne `Origin`-Header (native App)
  passieren `foreignOrigin`. CSP und Header blockieren JSON-Routen nicht.

### 4.2 Andocken an die Web-Funktionen, ohne sie zu verändern

Die Kern-Funktionen fragen den Betrachter heute selbst über Cookies. **Muster:** je eine
Variante mit expliziten Betrachter-Werten in einem `server-only`-Modul; die bestehende
Web-Funktion ruft sie mit ihren Cookie-Werten auf und bleibt nach außen gleich. Kein
AsyncLocalStorage, keine versteckte Umschaltung. Die Maskierung (Geheimtipp-Titel, ~1 km
verwischte Koordinaten, `locked-${i}`-Slugs, Kostprobe statt Vollfassung) läuft damit für
App und Web aus DERSELBEN Funktion.

| Web-Funktion | Was an Cookies hängt | Variante |
|---|---|---|
| `getExploreData(locale)` (spots.ts) | `viewerCanSeePro()` | `loadExploreData(locale, canSeePro)` existiert intern schon, exportieren |
| `getSpotDetail(slug, locale)` (spots.ts) | `viewerCanSeePro()` | `loadSpotDetail(slug, locale, canSeePro)` existiert intern schon. Liefert für freie Spots schon die volle `route`, eine eigene Routen-Route ist deshalb unnötig |
| `getRelatedSpots`, `getNearbyLockedSpots` (spots.ts) | `viewerCanSeePro()` | nur falls die App "Ähnliche"/"Geheimtipps in der Nähe" zeigt |
| `getTourDetail(slug, locale)` (tours.ts) | `viewerCanSeePro()` (Zeile 1) **und** die Admin-Entwurfsvorschau über `getAdminUserId()` (cookie + `auth.getUser`, loggt `admin_page_denied`) | `getTourDetailFor(slug, locale, canSeePro, isAdmin: () => Promise<boolean>)`. `isAdmin` MUSS ein **fauler** Callback sein: das Web fragt nur, wenn die veröffentlichte Suche leer bleibt; eifrig berechnet hinge an jeder Tour-Seite ein Netzwerk-Aufruf. Die App übergibt `() => false` |
| `getPublishedTours(locale)` (tours.ts) | nichts | direkt nutzbar |
| `getSavedSlugs`, `getSavedSpots`, `getOrCreateDefaultList` (saved.ts) | Cookie-Client | Varianten mit Client-Parameter (`createBearerClient`) |
| `getSpotOpeningWeek` (opening-hours-server.ts) | Cookie-Client | Variante mit Parameter |
| `deleteMyAccount` (account-actions.ts, `"use server"`) | cookie `getUser`, danach `ai_usage` löschen + `auth.admin.deleteUser` + `signOut` | Kern (`ai_usage` + `deleteUser`) in ein `server-only`-Modul herauslösen; Web-Action ruft den Kern auf |
| `setNewsletter` (account-actions.ts, `"use server"`) | Cookie-Client | Logik (Ja/Nein + Zeitstempel bzw. null) in `server-only`-Kern |
| `getSpotRoute` (spot-actions.ts, `"use server"`) | Pro-Prüfung | **nicht** anfassen, die App braucht sie nicht (Route steckt im Spot-Detail) |

Caching: Nur die Spot-Funktionen (Explore, Spot-Detail, Ähnliche) sind gecacht, ihre
Schlüssel enthalten schon `pro|public`. Touren und Merkliste sind ungecacht, das bleibt so.

### 4.3 Routen v1

| Methode + Pfad | Zweck | Auth |
|---|---|---|
| `GET /bootstrap?lang=` | Kategorien, App-Einstellungen, `minAppVersion` (Zwangs-Update), Inhalts-Version | optional |
| `GET /explore?lang=` | wie `getExploreData` (maskiert je Stufe) | optional |
| `GET /spots/{slug}?lang=` | wie `getSpotDetail`, inkl. Route bei freien Spots | optional |
| `GET /spots/{slug}/live?lang=` | Wetter, Öffnungszeiten, Wassertemperatur. **Nur aus dem maskierten Spot-Detail** berechnen: bei gesperrten Spots sind lat/lng und `googlePlaceId` null, dann gibt es nichts. Sonst verrät Wetter oder Öffnungszeit den Ort. Antwort `{ weather: { days } \| null, opening: { source, week, todayIndex, open, changeAt, holidays } \| null, waterTemp: { lake, tempC, at, source } \| null }`, gesperrt = alles `null`. Gleiche Bedingungen wie die Webseite: Öffnungszeiten bei `hasOpeningHours`, See bei `lakeName`, Wetter nur bei Aktiv-Spots (Position, sonst Routenstart). `Cache-Control: private, max-age=300`. **Die Antwort hängt vom Betrachter ab** (Öffnungszeiten werden mit seiner Sicht gelesen): die App leert beim Abmelden ihren URL-Cache. Code: `spot-live.ts` | optional |
| `GET /tours?lang=` | wie `getPublishedTours` | optional |
| `GET /tours/{slug}?lang=` | wie `getTourDetail` (Stopps, gesperrt/frei, signierte Links 2 h) | optional |
| `GET /tours/{slug}/package?lang=` | Offline-Paket-Manifest (Abschnitt 6.3) | optional |
| `GET /me` | E-Mail, `canSeePro` (inkl. Admin, damit Admins keinen Kauf-Knopf sehen), Sprache, Newsletter | Pflicht |
| `PATCH /me` | Body `{ locale?, newsletter? }`, mindestens ein Feld, `locale` aus den 13 Codes, unbekannte Felder = `400 invalid`. Antwort wie `GET /me`. Kerne in `account-core.ts` (auch `setNewsletter`/`rememberLocale` im Web) | Pflicht, **Handeln** (`auth.getUser`, keine anonymen Konten) |
| `DELETE /me` | Konto löschen (Kern `account-delete.ts`; bei Apple-Login zusätzlich Apple-Token widerrufen, Abschnitt 5). Body optional `{ appleAuthorizationCode }`. Antwort `200 { deleted: true, appleRevoked: true \| false \| null }`: `null` = kein Apple-Konto, `false` = Apple-Konto, Widerruf nicht gelungen. **Das Konto wird immer gelöscht**, der Apple-Widerruf ist Best Effort und meldet Fehler über `logOps`: `apple_revoke_failed` (Apple hat abgelehnt oder war nicht erreichbar, oder die App hat keinen `authorizationCode` mitgeschickt), `config_missing`, wenn die `APPLE_SIWA_*`-Werte in Vercel fehlen | Pflicht, **Handeln** |
| `GET /saved?lang=`, `PUT /saved/{slug}`, `DELETE /saved/{slug}` | Merkliste. `GET` liefert `{ lang, slugs, spots }`, `PUT`/`DELETE` liefern `{ saved: true \| false }`; ein Pro-Spot, den die RLS dem Nutzer ausblendet, ist `404 not_found` wie ein unbekannter Slug (auch bei `DELETE`). Das `spot_save`-Ereignis fällt nur beim tatsächlich neuen Eintrag an, mit Gerät `other` (siehe `/track`). Kern in `saved-core.ts`. PUT/DELETE sind **Handeln** und nehmen optional `?lang=` für die Analytics-Sprache (ohne den Parameter wird keine Sprache gezählt). `toggleSaved` ist ein Umschalter über `saved_lists`/`saved_items` und nicht idempotent; PUT/DELETE werden **idempotent** neu gebaut (gleiche Tabellen, Standardliste über `getOrCreateDefaultList`), samt `spot_save`-Ereignis wie im Web | Pflicht |
| `POST /auth/email-code` | Anmelde-Code per Mail senden (Abschnitt 5). Body `{ email, locale }` (JSON, max. 2000 Byte, `locale` aus den 13 Codes), Antwort `200 { ok: true }` auch für unbekannte Adressen; `400 invalid`, `429 rate_limit`, `503 unavailable`. Ein Authorization-Header wird ignoriert | keine |
| `POST /purchases/apple` | Signierte App-Store-Transaktionen prüfen und Pro verbuchen (Abschnitt 7). Body `{ signedTransactions: string[] }` (1 bis 50, je höchstens 10 000 Zeichen, nur dieses Feld), Antwort `{ canSeePro, results: [{ originalTransactionId, status }] }`, `status` = `granted` (verbucht), `already` (war schon dieses Kontos), `foreign` (gehört einem anderen, noch bestehenden Konto, nichts geändert), `invalid` (Signatur, Bundle-ID, Umgebung, Produkt oder Form falsch; `originalTransactionId` dann `null`), `revoked` (erstattet, kein Pro). Ergebnis i gehört zu Eingabe i. `400 invalid`, `401 auth`, `429 rate_limit` (zusätzlich 20 Anfragen je Konto in 10 Minuten), `503 unavailable` (Datenbank/Konfiguration; die App wiederholt, die Verbuchung ist idempotent). Code: `apple-purchase.ts`, Entscheidungen in `apple-purchase-core.ts` | Pflicht, **Handeln** |
| `POST /apple/notifications` | App Store Server Notifications V2. Body mit `signedPayload` (JSON, höchstens 100 KB; weitere Felder von Apple sind erlaubt und werden ignoriert). **Kein Authorization-Header:** die Apple-Signatur ist die Anmeldung. `REFUND` und `REVOKE` entziehen Pro (Regeln in Abschnitt 7), `REFUND_REVERSED` meldet `apple_purchase_manual`, alle anderen Typen nur `apple_notification_ignored`. `200 { ok: true }` erst nach fertiger Verarbeitung (auch bei "nichts zu tun" und bei einer echten Benachrichtigung der anderen Umgebung), `400 invalid` bei ungültiger Signatur oder anderer App, `503 unavailable`, wenn die Verarbeitung gerade scheitert (Apple stellt erneut zu, die Verarbeitung ist idempotent) | Apple-Signatur |
| `POST /track` | Analytics-Ereignisse der App (Regeln unten) | optional |

Regeln für alle Routen:
- JSON, Fehlerformat `{ error: "<code>" }` mit festen Codes (`auth`, `pro`, `not_found`,
  `rate_limit`, `invalid`, `unavailable`), nie rohe Fehlermeldungen. `unavailable` (503) heißt:
  Auth-Server oder Datenbank sind gerade nicht erreichbar; die App meldet den Nutzer dabei
  NICHT ab.
- **Ratenbegrenzung** über `hit_rate_limit` (0055), Schlüssel gehasht. `/auth/email-code`
  nutzt **dieselben Schlüssel wie der Web-Login** (`login-mail:<hash>`, `login-ip:<hash>` aus
  `login-link.ts`; `withinLimit`/`subject` dafür exportieren), sonst bekommt ein Mail-Bomber
  Web- plus App-Kontingent, und die App hat kein Turnstile.
- `Cache-Control: private` bei allem, was vom Betrachter abhängt.
- Fehler über `logOps()`. Neue Ereignisarten (z. B. Apple-Kauf fehlgeschlagen, Prüfkonto
  benutzt, Code-Mail-Limit) **erst in den Katalog `OPS_EVENTS` (ops-events.ts) eintragen**,
  sonst nimmt `logOps` sie nicht an. `logOps` und `/api/track` schreiben nur bei
  `VERCEL_ENV=production`: Tests gegen Preview/lokal tauchen dort nicht auf.
- Antworttypen in `src/lib/app-api-types.ts` (reine Typen, kein `server-only`); die App
  spiegelt sie als Swift-`Codable`. Änderungen nur additiv; Bruch heißt `/v2`.
- **`/track`:** `analytics_events.source` bedeutet heute die Herkunft (direct/search/social),
  also NICHT mit `"ios"` überladen; die App-Kennung braucht ein eigenes Feld (additive
  Spalte, z. B. `client`). Pfade so senden, dass `classifyPath` sie versteht
  (`/de/spot/<slug>`, `/de/touren/<slug>`). Der Standard-User-Agent von URLSession enthält
  kein "iPhone", `classifyDevice` hielte die App für Desktop: Gerät aus dem neuen Feld
  ableiten. (`npm run analytics:check` prüft nur Seiten, nicht API-Routen.)
- **Conversion aus der App:** Das Kauf-Ereignis (`conversion`) trägt bis zum Feld `client` das Gerät `other` und die Sprache der Anfrage, `source` bleibt leer. Es fällt genau einmal je neu verbuchter Transaktion an (nie bei Wiederherstellen oder Umbinden), nur für `Production`-Käufe und nur auf dem echten Deployment (`isRealSite()`).

## 5. Login in der App

- **Mail-Code:** `POST /auth/email-code { email, locale }`. Der Server prüft die Login-Limits
  (s. o.), erzeugt per `auth.admin.generateLink` den Link UND liest daraus
  `properties.email_otp` (in auth-js vorhanden), und schickt eine eigene Mail **nur mit dem
  Code** über `mail-layout.ts` (Texte im `Mail`-Namensraum, alle 13 Sprachen, kein Em-Dash).
  Die App löst den Code mit supabase-swift `verifyOTP(email:token:type: .email)` ein.
  Fallen und Regeln:
  1. Für eine **neue** Adresse legt `generateLink` das Konto an und liefert ein
     **signup**-Token (in `login-link.ts` dokumentiert, hat schon einmal gebissen).
     `type: .email` sollte beides annehmen: mit einer nagelneuen Adresse testen.
  2. Der Web-Notausgang `signInWithOtp` nutzt die Supabase-Mailvorlage, und die enthält nur
     einen Link mit `{{ .TokenHash }}`. **Der App-Pfad hat bewusst keinen Vorlagen-Notausgang:**
     Er schickt seine eigene Code-Mail über Resend; fällt sie aus, antwortet die Route mit
     `unavailable`. Für das Web bleibt, wie es ist (Link, keine `{{ .Token }}` nötig).
  3. **Länge des Codes: offen, Antons Entscheidung.** Supabase stellt heute **8 Stellen** aus.
     Empfehlung: bei 8 bleiben (6 Stellen sind mit vielen IPs erratbar, weil Supabase die
     Prüfversuche nur je IP begrenzt). Server und App nehmen 6 bis 8 Stellen an. Wird es 6,
     "Email OTP Expiration" auf 10 bis 15 Minuten verkürzen.
  4. **Nur der neueste Code gilt:** App-Code und Web-Link teilen sich den Token-Platz von
     Supabase, ein neuer Code oder Link macht den vorigen ungültig. Die App sagt das
     (`App.login.newestOnly`).
  5. **Schalter:** Die Route antwortet 503 `unavailable`, solange `APP_EMAIL_CODE_ENABLED` nicht
     `1` ist (Server-ENV). Sie bleibt in Produktion dunkel, bis die App in TestFlight geht.
     Zusätzliche Grenzen nur für die App: IPv6-/64-Eimer und ein globaler Deckel von 200 Codes
     pro Stunde. Aufrufe mit `Origin`-Header oder ohne `application/json` bekommen 400.
  Kein Turnstile in der App; Ersatz sind die Limits (App Attest als spätere Härtung).
- **Mit Apple anmelden:** AuthenticationServices → `signInWithIdToken(provider: .apple)`.
  In Supabase den Apple-Provider mit der App-Bundle-ID aktivieren.
  **Konto löschen** verlangt bei Apple-Konten den Widerruf des Apple-Tokens. Supabase
  speichert Apples Refresh-Token beim nativen Login nicht. Weg: Beim Löschen meldet sich der
  Nutzer noch einmal mit Apple an, die App schickt den frischen `authorizationCode` mit
  `DELETE /me`, der Server tauscht ihn bei Apple und widerruft. Dafür braucht der Server einen
  **eigenen Sign-in-with-Apple-Schlüssel (.p8)**, getrennt vom App-Store-Server-Schlüssel.
- **Apple im Web (23.10.2026):** Knopf "Mit Apple anmelden" über dem Google-Knopf (Login-Screen,
  `components/auth/AppleSignInButton.tsx`), sichtbar nur, wenn Apple in Supabase eingeschaltet UND `APPLE_SIWA_SERVICES_ID` gesetzt ist (`appleLoginEnabled()`; Apple in Supabase allein trägt auch den nativen App-Login und genügt deshalb nicht).
  Ablauf: Der Browser-Client ruft `signInWithOAuth({ provider: "apple" })` selbst auf (keine neue
  Server-Action). Das geht, weil `@supabase/ssr` den PKCE-Verifier als Cookie
  (`sb-<ref>-auth-token-code-verifier`, Pfad `/`, Lax) ablegt und `/[locale]/auth/callback` den `code` mit
  dem Server-Client tauscht, der dieselben Cookies liest. Rücksprung: `<origin>/<locale>/auth/callback?next=<next>`,
  `next` mit derselben Regel wie bei Google geprüft, im Callback nochmal (`safeNextPath`). Apple
  schickt per POST an Supabase (`https://<ref>.supabase.co/auth/v1/callback`), nicht an uns; Supabase leitet
  mit `code` per GET zu uns. Darum keine CSP-Änderung nötig (Top-Level-Navigation; `form-action`/`connect-src`
  greifen nicht). Mail-Links und Callback bleiben unberührt.
  **Konto-Verknüpfung:** Supabase verknüpft gleiche E-Mail automatisch. Wer in der App "E-Mail verbergen"
  wählte, hat eine `@privaterelay.appleid.com`-Adresse; sein App-Konto ist im Web über denselben Apple-Knopf
  erreichbar, weil Apple für dieselbe Team-ID und Person dieselbe Relay-Adresse liefert.
  **Secret-Rotation:** Apple verlangt für den Web-Ablauf ein Client-Secret (ES256-JWT), höchstens 6 Monate gültig.
  Der Cron `/api/cron/apple-secret` (`vercel.json`, `0 4 1 * *`, Schutz `CRON_SECRET`, Job `apple-secret` im
  Totmannschalter, überfällig nach 45 Tagen) baut mit `buildAppleClientSecret()` (`lib/apple-revoke.ts`,
  `sub` = `APPLE_SIWA_SERVICES_ID`, Laufzeit 180 Tage) ein frisches Secret und schreibt es per
  `PATCH https://api.supabase.com/v1/projects/<ref>/config/auth` mit dem Körper `{ "external_apple_secret": "<jwt>" }`
  (Bearer `SUPABASE_MANAGEMENT_TOKEN`; Projekt-Referenz aus `NEXT_PUBLIC_SUPABASE_URL`). **Nur dieses eine Feld**:
  `external_apple_client_id` (Services-ID + Bundle-ID) bleibt unberührt. Erfolg = Heartbeat, Fehler = `cron_failed`
  (Alarm), fehlende ENV = `config_missing`, aber nur wenn die Services-ID gesetzt ist (sonst still). Das Secret
  steht nie im Log. Prüfung: `npm run apple-web-secret:check`.
- **Google:** GoogleSignIn-SDK → `signInWithIdToken(provider: .google)`; dafür eine
  iOS-OAuth-Client-ID in der Google Cloud Console.
- Sitzung im Schlüsselbund (supabase-swift Standard), Token-Erneuerung durch die Bibliothek.
- **Altkäufer:** Wer mit derselben Adresse wie im Web anmeldet, landet im selben Konto und hat
  sein Pro. Apple "E-Mail verbergen" erzeugt eine fremde Adresse; der Login-Bildschirm sagt
  bei Apple kurz, dass Web-Käufer die Mail-Anmeldung nehmen sollen.
- **Prüfkonto für Apples App-Review:** Prüfer können keine Mail empfangen. Festlegen in
  Phase 8 (Vorschlag: eine Prüfadresse per ENV, für die der Server einen festen Code
  annimmt; nur diese eine Adresse, mit Ops-Meldung bei jeder Nutzung). Opus-Review Pflicht.

## 6. Touren, Navigation, Offline

### 6.1 Navigations-Kern in Swift, nachweislich gleich

- `src/lib/bike-nav-core.ts` (stepNav, NAV/WALK_NAV-Tabellen), die reinen Teile von `geo.ts`,
  `nav-steps.ts`, `nav-format.ts`, `tour-route.ts` und von `bike-directions.ts`
  (`buildBikeChain`, `selectNavVias`, `alongFromViaWaypoints`) werden 1:1 als Swift-Paket
  `SalzNavCore` übertragen, ohne UI und ohne CoreLocation (Zeit kommt als `fix.at` herein).
- **Gleichheit wird bewiesen, nicht behauptet:** Ein neues Skript im Web-Repo
  (`scripts/nav-fixtures.ts`) fährt die 32 Fälle aus `scripts/nav-check.ts` mit dem echten
  TS-Code und schreibt Eingaben + Ergebnis als JSON-Fixtures. 31 Fälle sind `stepNav`-Fahrten
  (Zustand nach jedem Fix); **Fall 21** prüft `isMereCurve`/`prepareSteps` aus
  `nav-steps.ts` und wird als eigener Fixture-Typ exportiert. Dazu Fixtures aus
  `scripts/tour-route-check.ts` (`selectNavVias`/`reconcileVia`). Das Swift-Paket spielt alle
  Fixtures in XCTest ab und muss übereinstimmen (Zahlen mit kleiner Toleranz). Ändert sich
  der TS-Kern, werden die Fixtures neu erzeugt.
- **Die Banner-Schwellen** (Rad 30/120 m, Fuß 10/40 m) stehen nicht im Kern, sondern in
  `ManeuverBanner.tsx`. Sie gehören als eigene Konstanten in die Fixtures und nach Swift.
- Die Konstanten (Rad/Fuß) bleiben in docs/40 erklärt; in Swift stehen sie mit Verweis.

### 6.2 Was nativ dazukommt

- **Hintergrund:** `CLLocationManager` mit `allowsBackgroundLocationUpdates`,
  `activityType` `.fitness` (Fuß) bzw. `.otherNavigation` (Rad), Hintergrundmodi `location`
  und `audio`. Navigation läuft bei gesperrtem Handy weiter.
- **Audio:** `AVAudioSession` `.playback` mit `.duckOthers` für Hinweise; Geschichten über
  `AVPlayer`; Sperrbildschirm und AirPods über `MPNowPlayingInfoCenter` +
  `MPRemoteCommandCenter`. Lautheit ist schon in den Dateien (−16 LUFS), nicht nachregeln.
- **Gesprochene Abbiegehinweise** (`AVSpeechSynthesizer`, Sprache der App) mit den
  Banner-Schwellen. Texte in den Strings, alle 13 Sprachen.
- **Haptik** bei Abbiegungen und Ankunft am Stopp.
- **Stopps:** gleiche Logik wie im Web (Abstand entlang der Route, eine Einladung zur Zeit,
  Ruhezone vor Abbiegungen). Neu als Einstellung: **automatisch abspielen** beim Ankommen
  (Standard aus, damit das Verhalten dem Web entspricht).
- **Kompass/Kartendrehung** über `CLHeading`, kein Extra-Erlaubnis-Tipp.
- **Offenlegung der Stimme** (synthetisch/geklont/Mensch) vor dem Abspielen, wie im Web
  (docs/39).
- **Online-Routing in der App:** offen, siehe 6.4. Mapbox erlaubt in Apps den Zugriff nur über
  seine Mobile-SDKs (Product Terms 2.9.1), ein eigener Aufruf der Directions-API aus der App
  entfällt damit.

### 6.3 Offline-Paket

**Achtung, Stand 23.10.2026: der Server-Teil unten ist so nicht erlaubt, siehe 6.4.** Die
Tabelle `tour_nav_routes` mit gespeicherter Mapbox-Linie und Mapbox-Schritten verstößt gegen
die Mapbox Product Terms. Offline-Karten über das Maps SDK (`TileStore`) sind erlaubt.

**Server (Web-Repo):**
- Heute holt die Navigation die Route bei jedem Start live von Mapbox; gespeichert ist nur die
  Linie (`route_geo`), nicht die Abbiegehinweise. Neu: Tabelle `tour_nav_routes`
  (`tour_id`, `lang`, `route_hash`, `geometry`, `steps`, `via_along`, `created_at`),
  befüllt beim ersten Paket-Abruf, neu berechnet, wenn sich `route_hash` ändert.
- **Server-Routing braucht einen anderen Schlüssel:** `fetchBikeRoute` bindet
  `NEXT_PUBLIC_MAPBOX_TOKEN` fest auf Modulebene; der ist URL-beschränkt und gibt auf dem
  Server 401 (Kommentar in `bike-directions.ts`). Den Token als Parameter herausziehen und
  serverseitig `MAPBOX_SERVER_TOKEN` übergeben (wie `tour-actions.ts`). Web-Verhalten
  unverändert lassen.
- **Andere Kette:** Das Web routet ab der GPS-Position; das Offline-Paket routet ab dem
  Tour-Start (Start → Stopps → Wegpunkte → Ziel, Profil nach `tours.mode`,
  `language=<lang>`). Die Nav-Fixtures decken das NICHT ab: eigener Test für die Paket-Kette.
- **Migrationsnummer:** nächste freie Nummer prüfen (Stand 23.10.: 0073). Nichts ist dafür
  reserviert. Der in 0071 angekündigte Rückbau der 0068-Pfadspalten hat keine Nummer mehr
  und wird hier NICHT miterledigt (`loadStopAudio` liest die alten Spalten noch).
- `GET /tours/{slug}/package?lang=` liefert ein Manifest: Tour-Detail, Route + Schritte,
  Kartenausschnitt (bbox + Puffer), Bild-URLs, Audio-URLs (signiert, 2 h, die App lädt sofort),
  `contentHash`. Gesperrte Stopps bekommen nur die Kostprobe (gleiche Regel wie
  `stopAudioAccess`), freie die Vollfassung. Eine Sprache, eine Stimme.

### 6.4 Mapbox-Bedingungen und Routing (offen, Antons Entscheidung)

Recherche 23.10.2026 gegen die Mapbox Product Terms (Stand 20.10.2026); Bericht mit
wörtlichen Zitaten im privaten App-Repo (`doku/mapbox-recherche-2026-10-23.md`). Keine
Rechtsberatung.

- **Speichern verboten:** 2.10.1 "Customer shall not export, download, cache or store results
  from any request to a Navigation API." Directions, Optimization und Map Matching sind
  Navigation APIs. Dazu 1.9 (v) und 1.10 (nichts speichern, nichts weitergeben).
- **Betrifft schon das Web:** `tours.route_geo` (aus `snapTourRoute`, Directions) und
  `user_tours.route_geo` (Optimization) sind gespeicherte Mapbox-Ergebnisse.
- **Apps nur über die SDKs** (2.9.1). Live-Routing ohne Speichern ist erlaubt, aber in der App
  nur über ein Mapbox-SDK.
- **Offline-Karte** über `TileStore` erlaubt (höchstens 750 Kachelpakete, nicht vorladen
  oder bündeln). Maps SDK bis 25.000 MAU gratis.
- **Empfehlung der Recherche:** eigener Router auf OpenStreetMap-Daten (z. B. Valhalla, MIT,
  auf einem EU-Server). Linie und Abbiegeschritte gehören dann uns (Hinweis "©
  OpenStreetMap-Mitwirkende"), dürfen gespeichert, offline ausgeliefert und für das
  Online-Umrouten über eine eigene Route (`/api/app/v1/route`) genutzt werden. Mapbox bleibt
  für die Kartenanzeige. Alternativen: Mapbox Navigation SDK mit Offline-Routing (teuer: ab
  100 MAU 0,30 $ je MAU, zweiter Navigations-Kern) oder eine Vertragsausnahme von Mapbox.
- **Bis zur Entscheidung angehalten:** Server-Teil von 6.3 (`tour_nav_routes`, `/package`),
  Online-Umrouten in der App, Umstellung von `route_geo` im Web. Weiter gebaut wird alles, was
  davon nicht abhängt: Karte, Spots, Merkliste, Touren mit Stopps und Audio (Sperrbildschirm,
  Hintergrund), Stopp-Einladungen nach Standort. Abbiegehinweise und Umrouten im
  Fahrbildschirm brauchen eine Routing-Quelle und warten auf die Entscheidung.

**App:**
- Download-Manager (Hintergrund-`URLSession`), Fortschritt je Tour, Größe vorher anzeigen.
- Ablage in Application Support, vom iCloud-Backup ausgenommen (lädt sich neu),
  Dateischutz **`completeUntilFirstUserAuthentication`** (bei `complete` könnte die App bei
  gesperrtem Handy die Audiodatei nicht öffnen).
- Karte offline über Mapbox `OfflineManager`/`TileStore` (Stil outdoors wie im Web,
  Zoom passend zur Navigation).
- **Ohne Netz kein neues Routing:** Kommt man vom Weg ab, zeigt die App "zurück zur Route"
  (Pfeil + Abstand zur nächsten Stelle der Linie).
- Aktualität: bei Netz `contentHash` vergleichen, Update anbieten.
- **Pro-Änderung:** Pro gekauft → Paket neu laden (Vollfassungen). Pro entzogen
  (Erstattung) → beim nächsten `/me` Vollfassungen löschen, Kostproben bleiben.

## 7. Apple-Kauf (StoreKit 2)

**App:**
- Ein Produkt, nicht verbrauchbar, z. B. `<bundle-id>.pro`, Preis 19,99 €.
- Kauf nur angemeldet; `appAccountToken` = Supabase-User-UUID.
- Nach dem Kauf die signierte Transaktion an `POST /purchases/apple` schicken, dann `/me`
  neu laden. "Käufe wiederherstellen" (`AppStore.sync`) schickt alle Transaktionen erneut.
- Bereits Pro (im Web gekauft, Geschenk, Admin): Kauf-Knopf ausblenden, wie im Web.

**Server (Web-Repo), Stand der Umsetzung (Phase 7, Web-Teil):**
- **Zwei Migrationen, in dieser Reihenfolge, beide VOR dem Merge:** `0074_pro_source_apple.sql`
  (nur `ALTER TYPE pro_source ADD VALUE 'apple'`; ein neuer Enum-Wert darf nicht in derselben
  Transaktion benutzt werden, deshalb allein) und `0075_apple_purchases.sql` (Tabelle,
  RLS, `set_user_pro`). 0075 prüft gleich am Anfang, ob `'apple'` im Enum steht, und bricht sonst mit
  "Migration 0075 abgebrochen: erst 0074 einspielen" ab, ohne etwas anzulegen (ohne diese
  Prüfung würde die Datei laufen und erst `set_user_pro` beim Aufruf scheitern).
- Tabelle `apple_purchases` (`original_transaction_id` PK, `user_id` **on delete set null**
  auf `auth.users`, `product_id`, `environment` nur `Production`/`Sandbox`, `purchased_at`,
  `revoked_at`, `app_account_token`, `created_at`, `updated_at`). RLS: Nutzer lesen nur eigene
  Zeilen; es gibt keine Insert/Update/Delete-Policy und die Tabellenrechte für `anon` und
  `authenticated` sind zusätzlich entzogen (nur `select` bleibt). Geschrieben wird nur mit dem
  Service-Key. Der Datenexport (`exportMyData`) enthält die eigenen Zeilen als `applePurchases`.
- **SQL-Funktionen:** `set_user_pro` (0038) liefert für aktives `'apple'`-Pro `apple_pro`
  (Schenken und Entziehen abgelehnt), wie `stripe_pro` für Stripe. `handle_new_user` (0054)
  bleibt UNVERÄNDERT: Es vergibt Pro nur beim Anlegen eines Profils aus Stripe-Kauf oder
  Übernahme-Liste; ein Apple-Kauf entsteht immer erst nach der Anmeldung, ein neues Konto
  bekommt Pro über "Käufe wiederherstellen". Die Stripe-Erstattung (`revokePro`) ist keine
  SQL-Funktion und filtert schon auf `pro_source = 'stripe'`; ihr Verhalten gegenüber Apple
  ist per SQL-Beweis abgesichert (Apple-Pro bleibt, auch bei gleicher Kunden-ID).
- **Prüfung der Transaktion** mit `@apple/app-store-server-library` (`SignedDataVerifier`,
  exakt 3.1.0): Signaturkette gegen Apples gebündelte Wurzeln (`src/lib/apple-roots/`, G3 und
  G2, mit Prüfsummen), Bundle-ID, App-ID (in Production), Umgebung, danach die Produkt-ID.
  **Familienfreigabe wird im Code abgelehnt:** nur `inAppOwnershipType = PURCHASED` zählt
  (andere oder fehlende Angabe = `invalid`); bei Benachrichtigungen gilt das nicht, eine
  Erstattung gilt immer.
  Die Online-Prüfung (OCSP-Widerruf der Zertifikate) ist **standardmäßig aus**
  (`APPLE_IAP_ONLINE_CHECKS=1` schaltet sie ein): Sie hängt jeden Kauf an Apples
  Erreichbarkeit (bis 30 s je Frage) für ein Risiko, das wir nicht besser bemerken als Apple;
  Kette, Wurzeln, Gültigkeit zum Signaturzeitpunkt und Apples Zertifikatserweiterungen werden
  weiter geprüft. Wir rufen Apple nie an, der **App-Store-Server-API-Schlüssel (.p8) wird nicht
  gebraucht.**
- **Umgebung:** `APPLE_IAP_ENVIRONMENT` = `Production` (Standard, lehnt Sandbox ab), `Sandbox`
  oder `Both` (erst Production, dann Sandbox). **TestFlight und die App-Store-Prüfung kaufen
  in der Sandbox, obwohl die App gegen den Produktions-Server spricht:** dafür muss `Both`
  gesetzt sein, sonst scheitert jeder Test-Kauf mit `invalid`. **Empfehlung: `Both` dauerhaft
  lassen** (die App-Prüfung kauft bei jedem Update in der Sandbox), TestFlight nur per
  Einladung, kein öffentlicher Link. Sandbox-Käufe schalten echtes Pro frei (kein Geld).
  Optional `APPLE_IAP_SANDBOX_USERS` (Komma-getrennte Supabase-Konto-IDs; eine kaputte Liste sperrt
  Sandbox für alle und wird gemeldet, Production und Erstattungen laufen weiter): ist sie gesetzt,
  bekommen NUR diese Konten Pro aus Sandbox-Käufen (andere: `invalid`, einmal gemeldet); ist
  sie leer, dürfen alle (nötig für die Prüfung durch Apple, deren Konto wir nicht kennen).
  Umgebungen bleiben getrennt: Dieselbe ID in der anderen Umgebung bindet und erstattet
  nichts, und nach einer Production-Erstattung hält nur ein anderer Production-Kauf das Pro
  am Leben.
- **Eigene Funktion `grantApplePro`, NICHT `grantPro` erweitert.** Regel für beide Wege:
  **ist `is_pro` schon true, wird `pro_source` nie geändert.** `grantApplePro` schreibt nur
  `WHERE is_pro = false` (die Bedingung steckt im UPDATE) und setzt gleich
  `pro_notice_seen_at`, damit das Web dem Käufer keinen Geschenk-Gruß zeigt. `grantPro`
  (Stripe) bekam genau die Schutzzeile für aktives `'apple'`-Pro; sein Verhalten gegenüber
  Geschenk und Übernahme ist bewusst unverändert (Stripe gewinnt, der Kauf bleibt
  erstattbar).
- **Zuordnung zum Konto (Wiederherstellen), je Transaktion einzeln:**
  1. Zeile schon erstattet (`revoked_at`): `revoked`, nie wieder freischalten.
  2. Zeile gehört einem lebenden anderen Konto: `foreign` + Ops `apple_purchase_foreign`,
     nichts umgebunden.
  3. Zeile gehört dem angemeldeten Konto: `already` (Pro wird bei Bedarf nachgezogen).
  4. `user_id` null (Konto gelöscht): an das angemeldete Konto binden (bedingtes UPDATE,
     `granted`).
  5. Neue Transaktion: `appAccountToken` muss die ID des angemeldeten Kontos sein, sonst
     `foreign`; fehlt er (alte Transaktion), an das angemeldete Konto binden. Neu angelegt
     heißt `granted`.
  **Opus-Review dieser Regeln bleibt Pflicht vor dem Merge.**
  Verlorene Rennen (anderer war schneller) werden neu gelesen und neu bewertet. Hat das Konto
  schon Pro aus anderer Quelle, bleibt die Quelle und der Kauf wird als doppelt bezahlt gemeldet
  (`apple_purchase_manual`, Erstattung bei Apple prüfen). Zeigt der Token einer NEUEN
  Transaktion auf ein Konto, das es nicht mehr gibt (Käufer hat gelöscht und neu angemeldet),
  wird sie an das angemeldete Konto gebunden und gemeldet (`apple_purchase_manual`): Nur das
  Gerät des Zahlenden hat diese Transaktion.
  **Doppelt bezahlt, Stripe + Apple:** Zahlt jemand mit Apple-Pro zusätzlich bei Stripe,
  bleibt `pro_source = 'apple'` (`grantPro` meldet `apple_purchase_manual`). Wird Apple
  erstattet und das Konto hat einen aktiven Stripe-Kauf (`pro_purchases`: eingelöst, nicht
  erstattet), entzieht der Server Pro NICHT, sondern stellt die Quelle auf `stripe` UND setzt
  `stripe_customer_id` aus diesem Kauf (ohne sie fände `revokePro` das Profil nie; ein
  Gast-Kauf hat sie nie ans Profil geschrieben) und meldet es. Hat der Stripe-Kauf keine
  Kunden-ID, wird Pro entzogen und gemeldet (Handarbeit). Nach der Umstellung prüft der Server
  noch einmal und entzieht selbst, falls Stripe inzwischen auch erstattet wurde.
  **Die iOS-App muss bei jedem Start `Transaction.currentEntitlements` erneut an
  `POST /purchases/apple` schicken** (idempotent). Das deckt ab, was der Server nicht mitbekommt:
  Pro, das nach einer Stripe-Erstattung oder einem entzogenen Geschenk entfällt, während Apple
  weiter besteht, kommt so zurück.
- **`POST /apple/notifications`:** `REFUND`/`REVOKE` setzen `revoked_at` und entziehen Pro
  **nur, wenn `pro_source = 'apple'` (im UPDATE) und das Konto keinen anderen nicht erstatteten
  Apple-Kauf hat.** Geschenk, Übernahme und Stripe bleiben unberührt. Kennt der Server die
  Transaktion noch nicht, legt er sie als erstattete Zeile ohne Konto an, damit eine VOR der
  Erstattung signierte Transaktion später kein Pro bringt. Der Entzug läuft auch bei schon
  gesetztem `revoked_at` noch einmal (heilt eine halb gescheiterte Zustellung).
- **Conversion-Ereignis:** wie beim Stripe-Kauf (`trackConversion`), Gerät `other`, nur wenn die
  Zeile neu angelegt UND Pro dadurch gesetzt wurde, für `Production` und `isRealSite()`
  (Abschnitt 4.3).
- **ENV (nur Vercel, nichts davon ins Repo):** `APPLE_IAP_BUNDLE_ID` (Pflicht),
  `APPLE_IAP_PRODUCT_ID` (Pflicht), `APPLE_IAP_APP_APPLE_ID` (numerische App-ID aus App Store
  Connect, Pflicht bei `Production`/`Both`), `APPLE_IAP_ENVIRONMENT` (`Production` | `Sandbox` |
  `Both`, Standard `Production`), optional `APPLE_IAP_SANDBOX_USERS`, optional
  `APPLE_IAP_ONLINE_CHECKS=1`. Fehlt etwas, meldet
  der Server `config_missing` und antwortet 503.
- **Ops-Arten** (Katalog `ops-events.ts`): `apple_notification_app_mismatch` (error, sofort: echte Apple-Meldung mit falscher Bundle-/App-ID, Erstattungen kämen sonst nie an), `apple_purchase_failed` (error, sofort),
  `apple_purchase_invalid` (warn, ab 3, höchstens eine Meldung je Anfrage mit Anzahl), `apple_purchase_foreign` (warn, sofort),
  `apple_purchase_manual` (warn, sofort), `apple_notification_invalid` (warn, ab 3),
  `apple_notification_ignored` (info).
- **Prüfung:** `npm run app-purchase:check` (Wurzeln, Signaturprüfung mit eigener Testkette,
  Bindungs- und Entzugsregeln gegen einen Speicher im Arbeitsspeicher, Stripe-Weg).
  Die SQL-Seite ist als echter Client in einem lokalen Wegwerf-Postgres bewiesen (Migrationen
  0001 bis 0075, Gegenprobe ohne 0075 rot).

**Recht:** Kauf über Apple läuft nach Apples Bedingungen (Zahlung, Widerruf, Erstattung
über Apple). AGB um einen Abschnitt "Kauf in der iOS-App" ergänzen. Die FAGG-Zustimmung des
Webs gilt dort nicht; Text in Phase 8 mit opus prüfen.

**Vorbedingung außerhalb des Codes:** In App Store Connect müssen Vertrag für
kostenpflichtige Apps, Bankkonto und Steuerformulare ausgefüllt sein, sonst lässt sich der
Kauf nicht einmal im Test (Sandbox) ausprobieren. EU-Händlerangaben (Name, Adresse, Telefon,
Mail) erscheinen öffentlich im Store.

## 8. Aussehen und Bedienung

- **SwiftUI**, Apples aktueller Glas-Look nativ (Materialien), Mindest-iOS siehe Abschnitt 1.
- **Farben** aus `src/app/globals.css` als Asset-Katalog: Creme `#faf6ec` (Hintergrund),
  Tinte `#111111`, Sekundär `#6c5b57`, Akzent `#cc2924`; Navigation dunkel wie `.sg-nav`
  (`#181410`, Akzent `#ff6b60`). Radien 16 (Karten) / 22 (Sheets). Schrift: SF (System) mit
  Dynamic Type; das Web nutzt Inter mit SF als Rückfall, nativ ist SF der Apple-Standard.
- **Explore wie Apple Maps:** Karte vollflächig, darüber ein dauerhaftes Sheet mit Stufen
  Peek/Halb/Voll (`presentationDetents`, Hintergrund bis "Halb" bedienbar). Das ersetzt
  nativ, was im Web `BottomSheet.tsx`/`MobileSheet.tsx` nachbauen.
- **Tab-Leiste:** Im Web sind es Explore · KI (eine Aktion) · Gespeichert · Profil. **Die
  App ersetzt KI durch Touren** (Toni ist nicht in v1, die Touren sind der Kern der App):
  Explore · Touren · Gespeichert · Profil.
- **Emoji als Marker und Section-Icons**, Pillen-Knöpfe, 44-pt-Trefferflächen.
- **Gesperrte Inhalte** wie im Web: Geheimtipp-Karte mit Unschärfe, Tipp öffnet ein
  Kauf-Sheet (ProGate-Logik), Kauf-Knopf im Fuß des Sheets.
- **Texte:** BRAND_VOICE gilt (du, kurz, kein "losziehen", keine Beteuerungen, kein
  Prospekt-Vergleich, **kein Em-Dash**).
- **Strings:** Skript im App-Repo liest `messages/*.json` und `src/lib/facts-i18n.json` aus
  dem Web-Repo und erzeugt `Localizable.xcstrings` (nur die Namensräume, die die App nutzt;
  ICU-Plurale → xcstrings-Varianten; Prüfung: keine fehlenden Schlüssel, kein Em-Dash außer
  zh). App-eigene Texte (Abbiegehinweise, Offline, Kauf, Login-Code) kommen als neuer
  Namensraum `App` in `messages/*.json`, damit es EINE Quelle bleibt und `i18n:check` sie
  mitprüft. **Dafür muss der Filter in `src/app/[locale]/layout.tsx` `App` genauso
  ausschließen wie heute `Mail`**, sonst wird jede Webseite schwerer. `i18n:check` muss den
  Namensraum als "nicht im Web-Code benutzt" kennen (sonst meldet er tote Schlüssel).
- **Rechtliches** (Impressum, Datenschutz, AGB, Widerruf) öffnet die Webseiten.

## 9. Phasen

Jede Phase: eigener Branch, PR, opus-Review, Antons Test am Gerät, dann die nächste.
Web-Repo-PRs merged Simon; Migrationen spielt Anton VOR dem Merge im SQL Editor ein.

| Phase | Inhalt | Repo | Fertig heißt |
|---|---|---|---|
| 1 | App-Schnittstelle lesend: `app-auth.ts`, Varianten aus 4.2 (Explore, Spot, Tour), `/bootstrap`, `/explore`, `/spots/{slug}`, `/tours`, `/tours/{slug}`, `GET /me` | Web | **Eigenes** Gleichheits-Skript (mit `--env-file`, nicht in `pro:check`, das ist offline): API und Webseite liefern für Gast und Pro dieselbe Maskierung; 401 bei kaputtem Token; Prüfungen aus Abschnitt 10 grün; Webseiten im Browser unverändert |
| 2 | App-Gerüst: Xcode-Projekt, Farben, Strings-Skript, Namensraum `App` + Layout-Filter, API-Client, Login (Code, Apple, Google), `/auth/email-code` | App + Web | Anmeldung mit allen drei Wegen am iPhone, auch mit nagelneuer Adresse; Code-Mail in mindestens de/en geprüft; gleiches Konto wie im Web |
| 3 | Explore, Spot-Detail, Merkliste, Profil, Konto löschen; `/saved`, `PATCH/DELETE /me`, `/spots/{slug}/live` | App + Web | Explore mit Teasern wie im Web; Merkliste synchron mit dem Web; gesperrter Spot liefert über `/live` nichts; Konto löschen inkl. Apple-Widerruf |
| 4 | `SalzNavCore` + Fixtures aus `nav-check` und `tour-route-check` | App + Web (Skript) | Alle Fixtures grün in XCTest, inkl. Fall 21 und Banner-Schwellen |
| 5 | Touren + Navigationsbildschirm: Hintergrund, Sperrbildschirm, gesprochene Hinweise, Haptik, Online-Reroute | App | Simulator-Fahrt mit GPX für Rad und Fuß; Antons echte Testrunde zu Fuß und mit Rad bei gesperrtem Handy |
| 6 | Offline: `tour_nav_routes` (Migration), Token-Parameter in `bike-directions.ts`, `/package`, Download-Manager, Karten-Regionen, "zurück zur Route" | App + Web | Tour im Flugmodus komplett gehbar; Update bei geändertem `contentHash`; Web-Navigation unverändert (`nav:check`, Testfahrt im Browser) |
| 7 | Apple-Kauf: zwei Migrationen, `grantApplePro`, `set_user_pro`/0053/0054 angepasst, `/purchases/apple`, `/apple/notifications`, StoreKit 2, Wiederherstellen | App + Web | Sandbox-Kauf schaltet App UND Web frei; Erstattung (Sandbox) entzieht nur Apple-Pro; Stripe-Erstattung wirkt weiter; Admin-Geschenk überschreibt kein Apple-Pro; Web-Pro sieht keinen Kauf-Knopf |
| 8 | Store-Reife: Datenschutzerklärung (App-Abschnitt), AGB-Abschnitt, Apple-Datenschutzangaben, Prüfkonto, Screenshots, Review-Notizen, `/track` (+ Spalte), TestFlight extern | App + Web | Externe TestFlight-Tester ohne Fehlermeldung im Ops-Katalog; Einreichung |

## 10. Wie das Web sicher bleibt (bei jedem Web-PR)

- **`"use server"`-Regel** (Abschnitt 2, Punkt 4) im opus-Review ausdrücklich prüfen:
  `git diff` nach neuen Exporten in `"use server"`-Dateien durchsuchen.
- Nur additive Migrationen; Migration vor dem Merge live (Explore-leer-Falle).
- `npx tsc --noEmit`, `npm run lint`, `npm run pro:check`, `npm run nav:check`,
  `npm run tour-route:check`, `npm run routes:check`, `npm run i18n:check`,
  `npm run analytics:check`, `npm run build` (nicht bei laufendem Server bauen).
- Für jede geänderte Web-Funktion: eine Webseite vorher/nachher im Browser vergleichen
  (`verify`-Skill), z. B. Explore als Gast und als Pro, eine Tour-Seite, die Entwurfsvorschau
  als Admin.
- RLS-Regeln, auf die sich die App über `createBearerClient` verlässt (Merkliste, Profil),
  als echter Client beweisen (Rollback-Skript wie bei PR #303).
- Keine Kundendaten, Pro-Texte oder Schlüssel ins öffentliche Web-Repo.

## 11. Datenschutz und Recht

- **Kein Tracking, kein ATT-Dialog nötig:** Analytics bleibt cookiefrei und ohne
  Geräte-Kennung. **Mapbox-Telemetrie, offen:** Mapbox verbietet, die SDK-Daten
  einzuschränken, außer durch ein Opt-out, das der Nutzer selbst wählt (2.9.1; eingebaut im
  i-Symbol der Karte). Ob in der EU "Standard aus" erlaubt ist, steht nirgends: Mapbox und
  Datenschutzberatung fragen, VOR externem TestFlight entscheiden. Bis dahin steuert der
  App-Schalter `SG_MAPBOX_TELEMETRY` es an einer Stelle. Das Mapbox-SDK setzt laut seinem
  Privacy-Manifest kein Tracking, ein ATT-Dialog bleibt unnötig.
- **Standort:** wird nur auf dem Gerät verarbeitet; an Mapbox gehen Koordinaten nur für
  Routing und Karten. So in den Apple-Datenschutzangaben und in der Datenschutzerklärung.
- **Datenschutzerklärung** (Webseite, deutsch fest im Code) um einen App-Abschnitt ergänzen:
  Apple als Zahlungsabwickler, Standort, Mapbox SDK, Anmeldung über Apple/Google.
- **Apple-Käufe in Datenschutzerklärung und Export (Phase 8):** Die Tabelle `apple_purchases` speichert
  Transaktions-ID, Produkt, Umgebung, Kaufzeitpunkt, Erstattungszeitpunkt und den Konto-Token; bei
  Kontolöschung wird die Zeile vom Konto gelöst (`user_id` null), die Transaktions-ID bleibt als
  Zahlungsnachweis. In die Datenschutzerklärung aufnehmen (Zweck: Zahlungsabwicklung und Nachweis,
  Aufbewahrung nach den Fristen für Buchhaltung). Der Datenexport enthält die eigenen Zeilen
  bereits (`applePurchases`).
- **KI-Kennzeichnung:** Stimmen-Offenlegung wie im Web (docs/39); Toni ist nicht in v1.
- **Konto löschen in der App** ist Apple-Pflicht (Phase 3).

## 12. Was Anton außerhalb des Codes erledigt

- [x] Apple-Entwicklerkonto (als Person, bezahlt)
- [ ] **Anton, VOR dem Merge, in dieser Reihenfolge:** Migration `0074_pro_source_apple.sql`, danach `0075_apple_purchases.sql` im SQL Editor einspielen (beide ohne Datenverlust; 0074 ist eine einzelne Zeile und MUSS vor 0075 laufen)
- [ ] **Simon, Vercel-ENV (Production):** `APPLE_IAP_BUNDLE_ID`, `APPLE_IAP_PRODUCT_ID`, `APPLE_IAP_APP_APPLE_ID` (numerische App-ID aus App Store Connect, Seite "App-Informationen", "Apple-ID"), `APPLE_IAP_ENVIRONMENT`. **`Both` dauerhaft** (die App-Store-Prüfung kauft bei jedem Update in der Sandbox), TestFlight nur per Einladung, kein öffentlicher Link. Optional `APPLE_IAP_SANDBOX_USERS` (Konto-IDs der Tester, Komma-getrennt; leer = alle Sandbox-Käufe erlaubt). Ein In-App-Purchase-Schlüssel (.p8) wird dafür NICHT gebraucht
- [ ] **Anton, App Store Connect:** unter App-Informationen "App-Store-Server-Benachrichtigungen" die URL `https://<produktions-domain>/api/app/v1/apple/notifications` eintragen, Version 2, für Production UND Sandbox (bei `Production` allein die Sandbox-URL leer lassen: Sandbox-Benachrichtigungen werden sonst mit 400 abgelehnt). Danach "Testbenachrichtigung anfordern" (kommt als `apple_notification_ignored` im Logbuch an)
- [ ] **Anton, App Store Connect:** beim Produkt "Familienfreigabe" AUS lassen (der Server lehnt Familienfreigabe-Transaktionen ohnehin ab)
- [ ] App Store Connect: Vertrag für kostenpflichtige Apps, Bank, Steuer; EU-Händlerangaben
- [ ] App anlegen (Name, Bundle-ID), In-App-Produkt 19,99 €
- [ ] **Anton, VOR dem Merge:** Migration `0073_saved_lists_one_default.sql` im SQL Editor einspielen (eindeutiger Index: höchstens eine Standard-Merkliste je Nutzer; bricht mit klarer Meldung ab, falls es Doppelte gibt, Stand 23.10.2026: 0). Der Code läuft auch ohne sie
- [ ] **Apple-Login im Web: Anleitung unten ("Apple-Login im Web einrichten")**, ersetzt auch den Supabase-Punkt zur Bundle-ID (dort Services-ID + Bundle-ID eintragen)
- [ ] Sign-in-with-Apple-Schlüssel (.p8, eigener Schlüssel) für den Token-Widerruf; Vercel-ENV `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_TEAM_ID`, `APPLE_SIWA_PRIVATE_KEY` (PEM, `\n` als Text erlaubt), `APPLE_SIWA_CLIENT_ID` (Bundle-ID). Ohne sie löscht `DELETE /me` trotzdem, meldet aber `appleRevoked: false` und `config_missing`
- [ ] Supabase: Apple-Provider einschalten, Anleitung unten ("Apple-Login im Web einrichten", Client IDs: Services-ID zuerst, dann Bundle-ID; reine App-Einrichtung geht auch, der Web-Knopf braucht zusätzlich die ENV `APPLE_SIWA_SERVICES_ID`); **offen: Antons Entscheidung** zur Code-Länge (heute 8, Empfehlung 8; bei 6 "Email OTP Expiration" auf 10 bis 15 Minuten)
- [ ] Simon: `APP_EMAIL_CODE_ENABLED=1` in Vercel setzen, VOR dem TestFlight-Start (bis dahin ist die Code-Route dunkel)
- [ ] Google Cloud: iOS-OAuth-Client-ID
- [ ] Mapbox: eigener Token für die App (nur nötige Rechte). Preise: siehe 6.4 (Maps SDK bis 25.000 MAU gratis)
- [ ] **Entscheidung Routing (6.4):** eigener OSM-Router, Navigation SDK oder Vertragsausnahme; dazu, was mit `route_geo` im Web passiert
- [ ] **Entscheidung Mapbox-Telemetrie (11):** Standard an mit Opt-out oder Standard aus; Mapbox-Support und Datenschutz fragen
- [ ] App Store Connect: China als Verkaufsland ausschließen (Mapbox Product Terms 2.3)
- [ ] Privates Repo für die App anlegen, Simon Zugriff geben
- [ ] Simon über Phase 1 informieren (neue Routen unter `/api/app/v1`)

### Apple-Login im Web einrichten (Anton, Schritt für Schritt)

Es gibt keinen eigenen Schalter: Der Knopf erscheint (nach höchstens 5 Minuten), sobald die ENV `APPLE_SIWA_SERVICES_ID` gesetzt UND der Apple-Provider in Supabase eingeschaltet ist. Nur die App-Einrichtung (Bundle-ID, ohne Services-ID-ENV) zeigt also keinen Web-Knopf. Darum die Reihenfolge einhalten, Supabase kommt zuletzt. Platzhalter: `<ref>` = die Projekt-Kennung deiner Supabase-Adresse (`https://<ref>.supabase.co`), Bundle-ID = die der App.

**1. Apple Developer (developer.apple.com, Account)**
1. **Identifiers** öffnen. Prüfen, dass die App-ID (Bundle-ID) "Sign in with Apple" aktiviert hat (Haken setzen, Save).
2. Im Identifiers-Filter **Services IDs** wählen, **+** klicken, **Services IDs**, Continue.
3. Description: `SalzGuide Web`. Identifier: `com.salzguide.web` (beschlossen 23.10.2026; gleiche Vorsilbe wie die Bundle-ID `com.salzguide.app`, aber NICHT identisch). Continue, Register.
4. Die neue Services ID anklicken, **Sign in with Apple** abhaken, **Configure**:
   - Primary App ID: die App (Bundle-ID).
   - Domains and Subdomains: `<ref>.supabase.co` (Apple prüft die Domain, die den Rücksprung entgegennimmt, das ist Supabase) und `salzguide.com` (+ `www.salzguide.com`, falls genutzt).
   - Return URLs: `https://<ref>.supabase.co/auth/v1/callback`
   - Next, Done, Continue, Save.
5. **Keys**: Gibt es schon den Sign-in-with-Apple-Schlüssel (.p8) vom Konto-Löschen (`APPLE_SIWA_*`), **diesen weiterverwenden**: Ein Schlüssel gilt für App und Web, solange er mit der Primary App ID der App verknüpft ist. Sonst **+**, Name `SalzGuide Sign in with Apple`, "Sign in with Apple" abhaken, Configure, Primary App ID = die App, Register, **.p8 herunterladen (geht nur einmal)**, Key-ID notieren. Die Team-ID steht oben rechts unter deinem Namen / auf der Seite Membership.
6. **Zugriffstoken für den Cron (Entscheidung offen, Anton):** Ein persönliches Supabase-Zugriffstoken kann ALLES in ALLEN Projekten seines Kontos (kein Projekt-Token möglich). Empfehlung: das Token von einem **eigenen Supabase-Konto** erzeugen, das nur Mitglied einer Organisation ist, in der nur das SalzGuide-Projekt liegt; dann reicht das Token auch nur dorthin. supabase.com/dashboard/account/tokens, "Generate new token", Name `salzguide apple-secret cron`, Ablaufdatum setzen, falls angeboten (dann im Kalender erneuern). Nur in Vercel eintragen, nie ins Repo. Alternativen: (a) ein geplanter GitHub-Action-Lauf mit dem Token in den Actions-Secrets statt in Vercel; (b) keine Automatik: Alarm um Tag 150 und das Secret von Hand erneuern.

**2. Vercel-ENV (Simon, Production)**
- `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_TEAM_ID`, `APPLE_SIWA_PRIVATE_KEY`: wie beim Konto-Löschen (schon gesetzt, wenn dort eingerichtet).
- `APPLE_SIWA_SERVICES_ID` = `com.salzguide.web`
- `SUPABASE_MANAGEMENT_TOKEN` = das Token aus 1.6
- Danach Redeploy.

**3. Den Cron einmal von Hand auslösen (schreibt das erste Secret)**
In Vercel: Projekt, Settings, Cron Jobs, bei `/api/cron/apple-secret` auf **Run** (Vercel sendet das Geheimnis selbst; kein `curl` mit `$CRON_SECRET` nötig). Bei Erfolg `{"ok":true,...}` in der Antwort. Der Lauf braucht Apple in Supabase NICHT eingeschaltet, er schreibt das Secret in die Konfiguration des Providers. Antwortet er `skipped`, fehlt die ENV `APPLE_SIWA_SERVICES_ID` (Schritt 2). Kommt `ok:false`, steht im Logbuch `cron_failed` oder `config_missing` mit dem Grund.

**4. Supabase-Dashboard (Authentication, Sign In / Providers, Apple): zuletzt**
1. **Client IDs**: `com.salzguide.web,com.salzguide.app` (kommagetrennt, **Services-ID zuerst**, danach die Bundle-ID). Beide müssen drinstehen: Services-ID fürs Web, Bundle-ID für den nativen App-Login. Der Cron fasst dieses Feld nie an.
2. **Secret Key**: steht schon drin (vom Cron aus Schritt 3), nicht anfassen.
3. Apple einschalten, Save. Nach höchstens 5 Minuten erscheint der Knopf auf der Website.
4. Prüfen: Authentication, URL Configuration: `https://salzguide.com/**` steht in den Redirect URLs (steht bereits für Google).
5. Test: im Web "Mit Apple anmelden" (Knopf erscheint nach höchstens 5 Minuten), zurück auf der Seite angemeldet; ein Konto mit "E-Mail verbergen" einmal ausprobieren.
- Ab da erneuert sich das Secret monatlich selbst (Gültigkeit 180 Tage). Meldet das Logbuch `cron_failed` oder `config_missing` für `apple-secret`: Token/ENV prüfen, Cron von Hand starten.

**5. Apples E-Mail-Weiterleitung (Private Email Relay)**
Damit unsere Mails (Login, Pro-Quittung, Newsletter) bei "E-Mail verbergen"-Nutzern ankommen, muss Apple unsere Absender kennen: developer.apple.com, Certificates, Identifiers & Profiles, links **Services**, **Sign in with Apple for Email Communication**, **+** Domain/E-Mail-Adresse. Eintragen: die Absender-Domain und die Absenderadressen UND die `send.`-Subdomain, von der Resend tatsächlich sendet (der Envelope-From, "Return-Path", liegt dort; Apple prüft SPF/DKIM an dieser Domain). Domain per DNS bestätigen lassen. Ohne das werden Mails an `@privaterelay.appleid.com` verworfen.
**Testmail:** Mit einem Apple-Konto im Web "Mit Apple anmelden", "E-Mail verbergen" wählen, danach vom Admin eine Testmail (oder Anmelde-Code) an diese `...@privaterelay.appleid.com`-Adresse auslösen. Kommt sie an, ist es fertig; sonst die eingetragenen Absender prüfen.
