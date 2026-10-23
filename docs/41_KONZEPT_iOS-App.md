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
| Anbieter im App Store | Anton als Person (Apple-Entwicklerkonto existiert, bezahlt) |
| Code | **eigenes privates Repo** für die App; die App-Schnittstelle kommt per PR ins Web-Repo, Simon merged |
| iOS-Version | aktuelle + vorige Hauptversion |
| Sprachen | alle 13 ab v1 (de, en, it, nl, ko, fr, zh, es, pt, pl, cs, hu, sk) |

Begründungen, damit sie nicht neu diskutiert werden:
- **Code statt Link:** Outlook Safe Links öffnet Mail-Links vorab und verbraucht Einmal-Tokens
  (Vorfall 18.10.2026, PR #304/#305). Ein Link müsste außerdem die App öffnen (Universal
  Link), was über umgeschriebene Safe-Links-Adressen nicht zuverlässig klappt. Einen Code
  tippt man ab, da kann kein Scanner etwas verbrauchen.
- **Apple-Login ist Pflicht**, weil die App Google-Login anbietet (Apple-Richtlinie). Fürs
  WEB bleibt es bei Antons Nein vom 17.07.2026. In der App entfällt der Hauptgrund von damals:
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
| `POST /purchases/apple` | App-Store-Transaktion prüfen und Pro verbuchen (Abschnitt 7) | Pflicht |
| `POST /apple/notifications` | App Store Server Notifications V2 (Erstattung u. a.) | Apple-Signatur |
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
- **Online-Routing in der App** wie im Web: Mapbox Directions direkt aus der App (mit dem
  App-Token), Kette ab GPS-Position.

### 6.3 Offline-Paket

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

**Server (Web-Repo):**
- **Zwei Migrationen:** `ALTER TYPE ... ADD VALUE 'apple'` darf nicht in derselben
  Transaktion stehen, die den Wert benutzt. Also erst den Enum-Wert (eigene Migration),
  dann Tabelle + Funktionen.
- Tabelle `apple_purchases` (`original_transaction_id` PK, `user_id` **on delete set null**,
  `product_id`, `environment`, `purchased_at`, `revoked_at`, `app_account_token`); RLS: nur
  eigene Zeilen lesen, schreiben nur Service.
- Transaktion mit Apples Server-Bibliothek (`@apple/app-store-server-library`) prüfen:
  Signaturkette, Bundle-ID, Produkt-ID, Umgebung.
- **Eigene Funktion `grantApplePro`, NICHT `grantPro` erweitern.** `grantPro` ist
  Stripe-spezifisch (Idempotenz über `pro_source === "stripe"`, überschreibt jede andere
  Quelle, setzt `stripe_customer_id`, loggt `stripe_fulfillment_failed`). Regel für beide
  Wege: **ist `is_pro` schon true, wird `pro_source` nie geändert.** Sonst überschreibt ein
  Apple-Kauf `stripe`, und eine spätere Stripe-Erstattung (`revokePro` filtert auf
  `pro_source = 'stripe'`) griffe nicht mehr.
- **SQL-Funktionen kennen nur Stripe als bezahlt:** `set_user_pro` (0038) schützt nur
  aktives `'stripe'`. Ohne Anpassung könnte ein Admin-Geschenk `'apple'` überschreiben (die
  Erstattung griffe dann nicht) oder ein Admin bezahltes Apple-Pro entziehen. Anpassen:
  `'apple'` gilt wie `'stripe'` als bezahlt. Ebenso `handle_new_user` (0053) und die
  Erstattungsfunktion (0054) prüfen.
- **Zuordnung zum Konto (Wiederherstellen):** Gibt es die `original_transaction_id` schon:
  gehört sie einem lebenden anderen Konto → ablehnen + Ops-Meldung; ist `user_id` null (Konto
  gelöscht) → an das angemeldete Konto binden. Neue Transaktion: `appAccountToken` muss zum
  angemeldeten Nutzer passen; fehlt er (alte Transaktion), an das angemeldete Konto binden.
  Opus-Review dieser Regel Pflicht.
- `POST /apple/notifications`: `REFUND`/`REVOKE` → Pro nur entziehen, wenn
  `pro_source = 'apple'` (Geschenk/Migration/Stripe bleiben unberührt).
- Conversion-Ereignis wie beim Stripe-Kauf, mit App-Kennung (Feld aus 4.3).
- Schlüssel für die App Store Server API (.p8, Key-ID, Issuer-ID) nur in Vercel-ENV.

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
  Geräte-Kennung; Mapbox-Telemetrie im SDK abschalten (Kein-Cookie-Banner-Linie).
- **Standort:** wird nur auf dem Gerät verarbeitet; an Mapbox gehen Koordinaten nur für
  Routing und Karten. So in den Apple-Datenschutzangaben und in der Datenschutzerklärung.
- **Datenschutzerklärung** (Webseite, deutsch fest im Code) um einen App-Abschnitt ergänzen:
  Apple als Zahlungsabwickler, Standort, Mapbox SDK, Anmeldung über Apple/Google.
- **KI-Kennzeichnung:** Stimmen-Offenlegung wie im Web (docs/39); Toni ist nicht in v1.
- **Konto löschen in der App** ist Apple-Pflicht (Phase 3).

## 12. Was Anton außerhalb des Codes erledigt

- [x] Apple-Entwicklerkonto (als Person, bezahlt)
- [ ] App Store Connect: Vertrag für kostenpflichtige Apps, Bank, Steuer; EU-Händlerangaben
- [ ] App anlegen (Name, Bundle-ID), In-App-Produkt 19,99 €
- [ ] App Store Server API Schlüssel (.p8) erzeugen, an Simon für Vercel-ENV
- [ ] **Anton, VOR dem Merge:** Migration `0073_saved_lists_one_default.sql` im SQL Editor einspielen (eindeutiger Index: höchstens eine Standard-Merkliste je Nutzer; bricht mit klarer Meldung ab, falls es Doppelte gibt, Stand 23.10.2026: 0). Der Code läuft auch ohne sie
- [ ] Sign-in-with-Apple-Schlüssel (.p8, eigener Schlüssel) für den Token-Widerruf; Vercel-ENV `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_TEAM_ID`, `APPLE_SIWA_PRIVATE_KEY` (PEM, `\n` als Text erlaubt), `APPLE_SIWA_CLIENT_ID` (Bundle-ID). Ohne sie löscht `DELETE /me` trotzdem, meldet aber `appleRevoked: false` und `config_missing`
- [ ] Supabase: Apple-Provider mit Bundle-ID aktivieren; **offen: Antons Entscheidung** zur Code-Länge (heute 8, Empfehlung 8; bei 6 "Email OTP Expiration" auf 10 bis 15 Minuten)
- [ ] Simon: `APP_EMAIL_CODE_ENABLED=1` in Vercel setzen, VOR dem TestFlight-Start (bis dahin ist die Code-Route dunkel)
- [ ] Google Cloud: iOS-OAuth-Client-ID
- [ ] Mapbox: eigener Token für die App (nur nötige Rechte), Preise für mobile Apps ansehen
- [ ] Privates Repo für die App anlegen, Simon Zugriff geben
- [ ] Simon über Phase 1 informieren (neue Routen unter `/api/app/v1`)
