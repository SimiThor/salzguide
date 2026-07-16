# SalzGuide — Masterprompt für Claude Code (Phase 1: MVP)

> **Für wen:** Anton (Anfänger in Claude Code). **Erklärungen Deutsch, Code Englisch.**
> **Was:** Schritt-für-Schritt-Aufträge, die du **einzeln** in Claude Code einfügst. Jeder Auftrag baut auf dem vorigen auf und liefert ein lauffähiges Zwischenergebnis.
> Grundlage: `01_REQUIREMENTS.md`, `02_ARCHITEKTUR.md` + Analysen `10–31`.

---

## 0. So arbeitest du diesen Masterprompt ab (bitte zuerst lesen)
1. Du gibst Claude Code die Aufträge **nacheinander** (A, B, C …). **Nicht alle auf einmal.**
2. Nach jedem Auftrag: **kurz testen** (Abschnitt „✅ Test" am Ende jedes Auftrags), erst dann weiter.
3. Wenn etwas nicht klappt: schick Claude Code die **Fehlermeldung** + „bitte beheben". Keine Panik.
4. **Commit nach jedem Auftrag** (Claude Code macht das; sonst sag „commit bitte").
5. **Secrets/Keys** kommen in `.env.local` (lokal) und in Vercel (online) — **nie** in den Code committen.

> 💡 Tipp: Halte `02_ARCHITEKTUR.md` griffbereit. Wenn Claude Code etwas anders bauen will als dort beschrieben, verweise darauf.

---

## 1. Vorbereitung — Accounts & Keys (einmalig)
Lege diese Accounts an und sammle die Keys (du brauchst sie in Auftrag A/H/I):
- **GitHub** (hast du) — neues leeres Repo `salzguide-app`.
- **Vercel** (neu anlegen, mit GitHub verbinden) — Hosting.
- **Supabase** (neu) — Projekt in **EU-Region** (Frankfurt). Notiere: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Mapbox** — `MAPBOX_TOKEN` (hast du schon Tokens; einen sauberen, domain-restricted anlegen).
- **Stripe** (hast du) — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, ein **Produkt „SalzGuide Pro" 19,90 € einmalig**.
- **Meteoblue** — `METEOBLUE_KEY` (hast du im Altcode).
- **Google Places** — `GOOGLE_PLACES_KEY`.
- **OpenRouteService** — `ORS_KEY` (kostenlos registrieren) — erst ab Phase 2 nötig.
- **Claude (Anthropic)** — `ANTHROPIC_API_KEY` — erst ab Phase 2 nötig.
- **Resend** (E-Mail) — `RESEND_KEY` (für Magic-Link-Mails optional; Supabase kann auch eigenes SMTP).

> Domain `salzguide.com`: DNS-Zugriff hast du — richten wir in Auftrag K (Deploy) ein.

---

## 2. Einmal einrichten: `CLAUDE.md` (Projekt-Kontext für Claude Code)
**Auftrag 0 — gib Claude Code genau das:**

> Erstelle im Projekt-Root eine Datei `CLAUDE.md` mit folgendem Inhalt (das ist der Dauer-Kontext für dich):
>
> ```markdown
> # SalzGuide App — Projektkontext
> Wir bauen salzguide.com: eine mobile-first Reise-Spot-Plattform für das Salzburger Land,
> die sich wie eine **Apple iOS 2026 App** anfühlt. Neuaufbau einer langsamen WordPress-Seite.
>
> ## Prinzipien
> - Mobile First, iOS-2026-Feel: super aufgeräumt, minimalistisch, leicht navigierbar.
> - MAP-FIRST: Explore-Karte vollflächig (wie Apple Maps). Inhalte in iOS-BOTTOM-SHEETS
>   (ziehbar, Detents Peek/Halb/Voll, Grabber, Spring-Animation, Blur).
> - Robust & sicher: TypeScript strict, alle Secrets in ENV, Pro-Inhalte serverseitig gaten
>   (nie nur per CSS verstecken), Supabase Row Level Security.
> - Performance: Bilder als WebP/AVIF + next/image, externe APIs serverseitig cachen.
> - Ein System statt Duplikate: Saison (summer/winter) & Spot-Typ (activity/food) als Daten-Dimension.
>
> ## Design-Tokens
> - Akzent/Rot: #cc2924 · Text: #111 · Sekundärtext: #6C5B57 · Hintergrund (Creme): #faf6ec
> - Radien: Cards 16px, Sheets/Promo 22px · Font: Inter / SF (system-ui Fallback)
> - Viel Weißraum, Glas/Blur (backdrop-filter), weiche Schatten, Emoji als Section-Icons.
>
> ## Stack
> Next.js (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres/Auth/Storage, EU) ·
> Mapbox GL JS · Stripe · i18n via next-intl. (Phase 2+: Claude API, OpenRouteService, Cloudflare.)
>
> ## Sprache
> Code, Variablen, Commits = Englisch. (Nutzer-Texte/Inhalte mehrsprachig, DE-Basis.)
>
> ## Arbeitsweise
> - Kleine, überprüfbare Schritte. Nach jedem Schritt kurz erklären, was zu testen ist.
> - Keine Secrets committen. Bei Unsicherheit: nachfragen statt raten.
> ```

✅ **Test:** Datei `CLAUDE.md` existiert im Root.

---

## 2b. Querschnitt: Sicherheit & DSGVO (gilt für ALLE Aufträge)
Diese Regeln gelten in **jedem** Auftrag automatisch — sag Claude Code einmal diesen Satz und verweise bei Bedarf darauf. Details: `33_SICHERHEIT_DSGVO.md`.

> **Sicherheits-/DSGVO-Grundregeln (immer einhalten):** TypeScript strict. Alle Secrets nur in ENV, nie committen. **Supabase Row Level Security (Default deny) auf jeder Tabelle.** Pro-Inhalte **serverseitig** gaten (nie nur CSS). Alle Eingaben serverseitig validieren (`zod`), Output sanitizen. **Security-Header + CSP + HSTS** setzen. **Rate-Limits** auf öffentliche/teure Routen (Auth, Upload, später KI), **Bot-Schutz (Turnstile)** vorsehen. **Stripe-Webhook-Signatur prüfen.** Uploads: Typ/Größe prüfen, **EXIF strippen**, in Storage-Buckets (EU). **EU-Datenresidenz** (Supabase Frankfurt). Betroffenenrechte vorbereiten (Account-Löschung/Export). **KI als KI kennzeichnen** (EU AI Act). Vor Produktivgang: Security-Check + Hinweis an mich, was rechtlich (Anwalt/DSB) zu prüfen ist.

✅ Jeder Auftrag unten setzt diese Regeln voraus.

## 3. Die Aufträge (Phase 1 — der Reihe nach)

### Auftrag A — Projekt-Setup
> Initialisiere ein **Next.js**-Projekt (App Router, **TypeScript**, **Tailwind CSS**, ESLint) im aktuellen Ordner. Richte ein:
> - **Supabase-Clients** (Browser + Server) über `@supabase/ssr`, mit ENV-Variablen aus `.env.local`.
> - **next-intl** für Mehrsprachigkeit mit Routen `/[lang]/...` (Sprachen vorerst `de`, `en`; `de` ist Default).
> - **Design-Tokens** aus `CLAUDE.md` als Tailwind-Theme (Farben, Radien, Font Inter via `next/font`).
> - Globales Layout mit Creme-Hintergrund, Safe-Area-Insets (iOS), und einem leeren `<BottomNav>`-Platzhalter.
> - `.env.local.example` mit allen Variablennamen (ohne Werte).
> Erkläre mir am Ende, welche Werte ich in `.env.local` eintragen muss.

✅ **Test:** `npm run dev` startet, Seite lädt mit Creme-Hintergrund unter `/de`.

### Auftrag B — Datenbank-Schema (Phase 1) + Seed
> Erstelle eine **Supabase-SQL-Migration** für Phase 1 nach `02_ARCHITEKTUR.md` Abschnitt 2 (nur die für MVP nötigen Tabellen):
> - `spots` (inkl. type, seasons, is_pro, status, geo-Felder parking/transit, route_geojson, quick-fact-Felder, loc/kids/bus/vibes, google_place_id, phone, lake_name, ticket_*, has_opening_hours, sort_weight, emoji).
> - `spot_translations` (lang, title, short_desc, general, insider_tip, section_a, section_b, location_text, insider_author).
> - `categories` (key, season, title_translations jsonb, sort_order) + `spot_categories` (m:n).
> - `media` (spot_id, type, role, url, variants, poster_url, alt, sort_order).
> - `profiles` (id=auth.user, email, is_pro, pro_source, stripe_customer_id, role, locale).
> - `saved_lists` + `saved_items`.
> - `api_cache` (cache_key pk, payload jsonb, fetched_at, ttl).
> Aktiviere **Row Level Security**: `spots`/`categories`/`media` öffentlich lesbar nur wenn `status='published'`; `profiles`/`saved_*` nur für den eigenen User; Schreibrechte nur `role='admin'`.
> Lege ein **Seed-Skript** an, das die **8 Sommer-Kategorien** (favs, hike-ez, lakes, food, hills, gorges, roads, hike-hard) und **3 Winter-Kategorien** (food, view, action) anlegt und **5 Beispiel-Spots** (aus `10_ALTSEITE_Explore.md`, z.B. Jägersee, Aignerpark, Karaffu) mit DE+EN-Übersetzungen einfügt.

✅ **Test:** Migration läuft in Supabase durch; im Table-Editor stehen Kategorien + 5 Spots.

### Auftrag C — Design-System & App-Shell (iOS-Feel)
> Baue die wiederverwendbaren UI-Grundlagen im iOS-2026-Stil:
> - **`<BottomNav>`** (Glas/Blur, 4 Tabs: Entdecken · KI · Gespeichert · Profil; Phosphor-Icons). KI ist eine **Aktion** (öffnet später ein Sheet), nie „active". Active-State aus dem Router. Auf Detailseiten wird „Entdecken" zu Router-Back.
> - **`<BottomSheet>`** — ziehbares iOS-Sheet mit **Detents** (Peek ~12% / Halb ~55% / Voll ~92%), Grabber-Handle, Spring-Animation (z.B. Framer Motion), Backdrop-Blur, Scroll-Lock, Safe-Area. Desktop-Fallback: zentriertes Sheet/Sidebar.
> - **`<SpotCard>`** — Bild 4:3 (radius 16), Titel, Kurzbeschreibung; Pro-Variante mit „🤫 Geheimtipp"-Badge.
> - **`<Carousel>`** — horizontales Scroll-Snap mit Drag (Touch nativ, Desktop Click&Hold), wie `10_ALTSEITE_Explore.md`.
> - Header (Logo „SalzGuide" rot, Sprach-Switcher) — schlicht.
> Halte alles streng an die Design-Tokens. Mobile-first, große Touch-Targets.

✅ **Test:** Eine Demo-Seite zeigt BottomNav, ein Karussell mit SpotCards und ein per Button geöffnetes BottomSheet, das sich ziehen lässt.

### Auftrag D — Explore-Seite (Map-First + Saison-Toggle)
> Baue die **Explore-Startseite** map-first:
> - **`<SpotMap>`** (Mapbox GL JS) **vollflächig** im Hintergrund, Style `outdoors-v12`, Emoji-Marker aus den Spots, fitBounds, Geolocate, Center-Button. Token aus ENV.
> - Darüber ein **`<BottomSheet>`** (Peek zeigt die Karussells): pro Kategorie ein `<Carousel>` mit `<SpotCard>` (Daten aus Supabase, nach `sort_weight`).
> - **Saison-Toggle** (Segmented Control, iOS-Stil) oben im Sheet: schaltet `seasons`-Filter zwischen Sommer/Winter → Spots, Kategorien **und** Marker wechseln. Default automatisch nach Datum (Dez–März = Winter), in localStorage merkbar.
> - **Marker-Tap** öffnet ein Spot-Sheet (Vorschau + „Mehr") — Detail kommt in Auftrag E.
> - Pro-Spots für nicht-eingeloggte: nur Teaser (Badge + Blur), Daten **serverseitig** schon gefiltert (kommt final in H).

✅ **Test:** `/de` zeigt vollflächige Karte mit Markern + ziehbares Sheet mit Karussells; Saison-Toggle wechselt die Inhalte.

### Auftrag E — Spot-Detailseite (beide Typen)
> Baue die **Spot-Detailseite** `/[lang]/spot/[slug]` nach `11_` (activity) & `12_` (food), als Seite **und** als Bottom-Sheet-Variante über der Karte:
> - **Hero-Bild** mit prominentem **Speichern-♡** (oben rechts).
> - **Quick-Facts** (4, typabhängig): activity = Dauer/Schwierigkeit/Saison/Erreichbarkeit; food = Art/Preis/Standort/Bekanntheit. Als schwebende weiße Card.
> - **Titel + Kategorie-Label**.
> - **Allgemeines** (+Bild) · **Insider-Tipp** (+Byline „Anton, Local").
> - **`<SpotMap mode=detail>`**: Route (🅿️→🏁) wenn `route_geojson`, sonst Punkt.
> - **`<ActionTile>`-Reihe (Auftrag C-Stil):** Anfahrt Auto (`parking_*`, driving) + Öffis (`transit_*`, transit) als Google-Maps-Deeplinks (`buildMapsLink`); bei food nur Auto; Anrufen wenn `phone`; Tickets wenn `ticket_url` (mit „Anzeige"-Kennzeichnung).
> - **3 Kurztexte** (typabhängig): activity = Dauer&Schwierigkeit/Beste Jahreszeit/Lage; food = Küche&Stil/Preisniveau/Lage.
> - Platzhalter-Bereiche für **Wetter** (activity) und **Öffnungszeiten** (food) — befüllt in Auftrag I.
> - **Related-Spots** (gleiche Region/vibes) als Karussell unten.

✅ **Test:** Detailseiten von einem activity- und einem food-Spot rendern korrekt mit den richtigen Facts/Texten und funktionierenden Maps-Buttons.

### Auftrag F — Mehrsprachigkeit finalisieren
> - **Sprach-Switcher** im Header (einfach, prominent), wechselt `/de` ↔ `/en`, merkt Wahl (Cookie/Profil).
> - **hreflang**-Tags + saubere `<head>`-Metadaten (Title/Description aus `spot_translations`) pro Sprache für SEO.
> - Alle UI-Strings über next-intl (DE/EN Messages). Inhalte kommen aus `spot_translations` je `lang`.
> - 404/Fallback wenn Übersetzung fehlt → DE.

✅ **Test:** Umschalten DE/EN ändert UI + Spot-Inhalte; Seitenquelltext enthält hreflang.

### Auftrag G — Auth (Magic-Link) + Profil + Saved-Listen
> - **Supabase Auth Magic-Link** (E-Mail-Login ohne Passwort). Login-Screen schlicht, iOS-Stil. Bei erstem Login `profiles`-Zeile anlegen (Trigger oder Server-Action).
> - **Profil-Tab:** eingeloggt → Profil (E-Mail, Pro-Status, Sprache, Logout); ausgeloggt → Login/Join-CTA.
> - **Speichern:** ♡ auf Spots schreibt in `saved_items` (Default-Liste). **Gespeichert-Tab:** Listen-Ansicht (Default + eigene Listen anlegen/umbenennen) + **kleine Karte** der gespeicherten Spots (`<SpotMap mode=saved>`).
> - Alles über RLS abgesichert (nur eigene Daten).

✅ **Test:** Magic-Link-Login funktioniert; Spot speichern erscheint unter Gespeichert (Liste + Karte); Logout funktioniert.

### Auftrag H — Membership, Stripe & serverseitiges Pro-Gating
> - **Pro-Gating serverseitig:** Server-Queries liefern für `is_pro`-Spots an nicht-Pro-User **nur Teaser-Daten** (kein echter Titel/Link/Detail). Detailseite eines Pro-Spots → Paywall statt Inhalt.
> - **Join/Upgrade-Screen** mit Value-Props + „€19,90 einmalig" (Inhalte aus `26_ALTSEITE_Verkaufsseite.md`).
> - **Stripe Checkout** (eingeloggt) für das Produkt „SalzGuide Pro"; nach Zahlung **Webhook** `/api/stripe/webhook` setzt `profiles.is_pro=true` (+ `stripe_customer_id`). Signatur prüfen.
> - **Kontextuelle Paywalls:** beim Öffnen eines Pro-Spots + Platzhalter-Hook fürs spätere KI-Limit.
> - „X von Y Spots freigeschaltet"-Anzeige als sanfter Conversion-Hebel.

✅ **Test:** Als Free-User ist ein Pro-Spot gesperrt (auch im Quelltext keine echten Daten); Test-Kauf (Stripe-Testmodus) setzt den User auf Pro und schaltet frei.

### Auftrag I — Caching-Layer: Wetter + Öffnungszeiten
> Baue **serverseitige API-Routen mit Cache** (`api_cache`-Tabelle), Keys aus ENV, nach `13_`/`14_`:
> - `/api/weather?lat&lon` → Meteoblue `basic-day`, **24h-Cache**, Koordinaten ~1km gerundet (geteilter Key), Fehler-Backoff. Pictocode-Heuristik + Inline-SVG-Icons. → befüllt den Wetter-Block (activity).
> - `/api/opening-hours?placeId` → Google Places (v1), **24h-Cache**; Open/Closed-Status + AT-Feiertage **clientseitig** aus den gecachten `periods`; „Powered by Google". → befüllt Öffnungszeiten-Block (food).
> - Optional Vercel-Cron für täglichen Refresh.

✅ **Test:** Wetter-Block zeigt 7-Tage-Vorschau (heute markiert); Öffnungszeiten-Block zeigt Status + Wochenliste; bei Reload keine neuen Drittanbieter-Calls (Cache greift).

### Auftrag J — Migration der Pro-User + Landingpage-Redirect
> - **Import-Skript:** liest einen CSV-Export (E-Mail + Pro-Status + optional Stripe-Customer-ID) und legt `profiles` mit `is_pro=true, pro_source='migration'` an (idempotent). Anleitung, wie ich den WordPress-Export erzeuge.
> - **301-Redirect-Map** alt→neu (alte Spot-URLs `/alle/<slug>/` → `/de/spot/<slug>`), als Next.js `redirects()` oder Middleware.
> - Hinweis-Text/Template für die **Ankündigungs-Mail** an Bestands-User („mit deiner E-Mail per Link einloggen, Pro ist schon da").

✅ **Test:** Testimport von 2–3 Beispiel-Usern erzeugt Pro-Profile; alte URL leitet korrekt um.

### Auftrag K — Deploy auf Vercel + Domain
> - Projekt mit **Vercel** verbinden (GitHub), alle ENV-Variablen in Vercel eintragen (Production + Preview).
> - **Domain `salzguide.com`** einrichten (CNAME zu Vercel) — gib mir die genauen DNS-Einträge.
> - Stripe-Webhook-URL auf die Production-Domain setzen.
> - Supabase Auth Redirect-URLs auf die Domain setzen.
> - Production-Build testen.

✅ **Test:** `salzguide.com` lädt die App live; Login + ein Test-Kauf funktionieren in Production.

---

## 4. Definition of Done — Phase 1 (MVP)
Ein Besucher kann auf **salzguide.com**: die Explore-Karte mit Karussells nutzen (Sommer/Winter), Spot-Detailseiten (beide Typen) mit Wetter/Öffnungszeiten/Anfahrt ansehen, Sprache wechseln (DE/EN), sich per Magic-Link einloggen, Spots in Listen speichern, **SalzGuide Pro per Stripe einmalig kaufen** und Pro-Spots freischalten (serverseitig gegated). Bestands-User sind migriert, alte URLs leiten weiter.

---

## 5. Ausblick (Phase 2 & 3 — separate Masterprompts, wenn MVP steht)
- **Phase 2:** KI-Assistent „Anton" (Chat + Spot-Vorschläge + Voice + Regel-Engine + Free-Limit/Paywall), Admin-Anlege-Flow (ORS-Auto-Route, KI-Texte mit Brand-Voice, Medien-Pipeline WebP/Video, 1-Klick-Übersetzung), Analytics-Dashboard, Events/Weekly, Wassertemperatur-Seite.
- **Phase 3:** Video-Maker, Audio-Tour (TTS, SalzGuide-Branding), Offline/PWA, „Schon besucht", weitere Sprachen, Abo-Add-on.

> Sag Bescheid, wenn Phase 1 steht — dann schreibe ich den **Phase-2-Masterprompt** in gleicher Tiefe.
