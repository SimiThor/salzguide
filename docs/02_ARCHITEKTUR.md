# SalzGuide — Architektur (salzguide.com)

> Vollständige technische Architektur, abgeleitet aus `01_REQUIREMENTS.md` + Analysen `10–31` + Konzepten `20/27/28/29` + Recherche `30`.
> Stand: 2026-06-21. Status: **Entwurf v1** (Grundlage für `03_MASTERPROMPT.md`).

---

## 0. Leitprinzipien
1. **Mobile First, echtes Apple-iOS-2026-App-Gefühl** — ruhig, super aufgeräumt, minimalistisch, schnell, leicht verständlich & navigierbar. Native Gesten, Glas/Blur, Creme-BG, Rot-Akzent `#cc2924`.
   - **Map-First:** Die Explore-Karte ist **vollflächig** (wie Apple Maps / Airbnb), nicht klein eingebettet.
   - **Bottom-Sheets (iOS-2026-Stil):** Spot-Details, KI-Assistent, Filter öffnen als **ziehbare Bottom-Sheets** mit Rasterpunkten (Peek/Halb/Voll), weichen Spring-Animationen, abgerundeten Ecken, Grabber-Handle, Blur-Hintergrund. Karte bleibt darunter sichtbar/bedienbar.
   - **Klarheit:** wenig gleichzeitig sichtbar, große Touch-Targets, eine klare Aktion pro Screen, keine Überladung.
2. **Robust & sicher statt gepfuscht** — eine saubere Codebase, alle Secrets serverseitig, Pro-Gating serverseitig, getypt.
3. **Ein System statt Duplikate** — Saison (Sommer/Winter), Spot-Typen (activity/food), Sprachen, Subsysteme alle über **eine** Engine + Flags/Dimensionen.
4. **Kosteneffizienz** — alle externen APIs gecached, Keys in ENV, seltene Admin-Operationen.
5. **Einfaches, schnelles Anlegen** — Karte-Klick→Route, KI-Texte, Auto-Medien, 1-Klick-Übersetzung.
6. **Conversion-orientiert** — großzügiges Free-Erlebnis, kontextuelle Soft-Paywalls.

---

## 1. Tech-Stack (final)
| Schicht | Wahl | Begründung |
|---|---|---|
| Framework | **Next.js (App Router, TypeScript)** auf **Vercel** | SSR/SSG für SEO, schnell, Server-Routes für sichere API-Calls |
| DB | **Supabase Postgres (EU-Region)** | relational, RLS, pgvector (KI), Realtime, DSGVO |
| Auth | **Supabase Auth — Magic-Link** (optional Apple/Google) | null Reibung, triviale Migration |
| Storage | **Supabase Storage (EU)** für Redaktions-Medien; **Cloudflare R2** für Video-Maker-User-Uploads | EU/DSGVO; R2 schon vorhanden |
| Bilder | **`sharp`** → WebP/AVIF + responsive; `next/image` | Performance |
| Video | **Cloudflare Stream** (Transcoding/Poster) | wenig Eigenbau, Cloudflare-Stack |
| Karten | **Mapbox GL JS** (1 Token, ENV, domain-restricted) | bewährt, gut gestylt |
| Routing | **OpenRouteService** (`foot-hiking`/`foot-walking`, Höhen) | Wanderwege + Höhenprofil |
| KI Chat/Text/Übersetzung | **Claude (Anthropic)** API, Tool-Calling, JSON-Mode | Entscheidung Anton |
| Embeddings | **OpenAI/Voyage Embeddings → pgvector** | RAG fürs Local-Wissen |
| STT (Voice) | **OpenAI Whisper** o.ä. (entkoppelt) | Spracheingabe |
| TTS (Audio-Tour) | **ElevenLabs / OpenAI TTS** | Audio-Generierung |
| Zahlung | **Stripe Checkout + Webhooks** | bewährt, sicher |
| E-Mail | **Resend** (Transaktional + Alerts) | Magic-Link-Begleitmails, Cap-Alerts |
| Wetter/Öffnungszeiten/Wassertemp | Meteoblue / Google Places / Behörden-Open-Data, **alle serverseitig gecached** | Kosteneffizienz |
| Analytics | **Plausible/PostHog (EU, cookieless)** + eigene DB-Events | DSGVO-konform |

**Hosting-Konsolidierung:** Bestehende Cloudflare-Worker (Places) & n8n (Video-Maker) werden in **Next.js-Server-Routes** überführt; R2 + Creatomate + Cloudflare Stream bleiben als externe Dienste.

---

## 2. Datenmodell (Postgres / Supabase)

### 2.1 Kern: Spots & Übersetzungen
**`spots`** (sprachneutrale Stammdaten)
```
id (uuid, pk)
slug (text, unique)              -- URL-Slug (DE-Basis)
type (enum: activity | food)
subtype (text)                   -- z.B. "Wanderung","Café","Aussicht","Burg"
seasons (text[])                 -- ['summer'] | ['winter'] | ['summer','winter']
is_pro (bool)                    -- Pro-Gating
status (enum: draft|published)
sort_weight (int)                -- Performance-Sortierung (manuell/auto)
emoji (text)

-- Geo
lat, lng (float8)                -- Marker / Spot-Punkt
parking_lat, parking_lng (float8)-- Auto-Ziel
transit_lat, transit_lng (float8)-- Öffi-Ziel (Station)
route_geojson (jsonb)            -- LineString [lng,lat,ele] (optional)
distance_km, ascent_m, descent_m (float8)  -- aus ORS

-- Quick-Facts (Anzeige-Strings, typabhängig)
fact_1..fact_4 (text)            -- activity: Dauer/Schwierigkeit/Saison/Erreichbarkeit
                                 -- food: Art/Preis/Standort/Bekanntheit
difficulty (enum), best_season (text), access (enum: oeffis|auto|beides)
price_level (enum), area (text), fame (text)

-- KI-Guide-Tags
loc (enum: stadt|seen|berge|null), kids (bool), bus (bool), vibes (text[])
ai_tags (text), must_see (bool)  -- Audio-Tour

-- Integrationen
google_place_id (text)           -- Öffnungszeiten/Telefon
phone (text)                     -- Anruf-Tile (sonst aus Places)
lake_name (text)                 -- Wassertemperatur
ticket_url, ticket_partner, price, currency (text)  -- Affiliate-Tile
website_url (text)
has_opening_hours (bool)

created_at, updated_at
```

**`spot_translations`** (pro Spot × Sprache — **skalierbare i18n**)
```
id, spot_id (fk), lang (text)            -- 'de','en','it','fr','nl','es','cs','hu',...
title (text)
short_desc (text)                        -- Karten-/Startseiten-Beschreibung
general, insider_tip (text)              -- Inhaltsblöcke
section_a, section_b (text)              -- activity: Dauer&Schwierigkeit / Saison
                                         -- food: Küche&Stil / Preisniveau
location_text (text)
audio_text (text), audio_url (text)      -- Audio-Tour je Sprache
insider_author (text)                    -- "Anton, Local"
ai_generated (bool), reviewed (bool)
unique(spot_id, lang)
```
> 6 Textblöcke (Doc 27) = `short_desc, general, insider_tip, section_a, section_b, location_text`. DE = Basis, weitere Sprachen KI-übersetzt.

**`categories`** (Karussell-Reihen, saison-spezifisch)
```
id, key (text)            -- 'favs','hike-ez','lakes','food','hills','gorges','roads','hike-hard' | 'view','action'
season (text)             -- 'summer'|'winter'
title_translations (jsonb)-- {de,en,...}
sort_order (int)
```
**`spot_categories`** (m:n) `spot_id, category_id`.

**`media`** (Doc 28)
```
id, spot_id (fk), type (image|video), role (hero|gallery|content|preview),
url, variants (jsonb), poster_url, alt (text), sort_order
```

### 2.2 User, Membership, Saved
**`profiles`** (= auth.users erweitert)
```
id (uuid, = auth.user), email, display_name, locale,
is_pro (bool), pro_since, pro_source (enum: stripe|migration|comp),
stripe_customer_id, role (enum: user|admin), created_at
```
**`saved_lists`** `id, user_id, name, is_default` · **`saved_items`** `list_id, spot_id, created_at`
> Saved als **Listen** (Doc 30): Default-Liste „Merkliste" + eigene („Sommer-Trip"…).
**`visited`** `user_id, spot_id, visited_at` (Phase-2 „Schon besucht").
**`ai_usage`** `user_id|anon_id, date, count` (Free-Limit, serverseitig).

### 2.3 KI & Regeln
**`spot_embeddings`** `spot_id, lang, embedding vector, content` (pgvector, RAG).
**`ai_rules`** (Regel-Engine Doc 16) `id, name, triggers (text[]), block_spot_ids (uuid[]) | block_titles (text[]), note` — Baden-Verbote etc., greift für Chat **und** Vorschläge.
**`ai_conversations`** / **`ai_messages`** (optional Chat-Verlauf je User).

### 2.4 Subsysteme
**`events`** (Doc 29) `id, start, end, location_name, lat,lng, category (highlights|party|tradition|kultur|kids), is_highlight, source_url, status` + `event_translations(title, description)`.
**`tours`** (Doc 31) `id, title, start_spot_id, end_spot_id, region, is_pro` · **`tour_stops`** `tour_id, spot_id, sort_order, in_pool` · **`tour_connections`** `tour_id, geojson, duration`.
**`lakes`** (Doc 23) `id, name, lat, lng, source (ls|ages), match_name`.
**`short_links`** (Video-Maker/Share) `slug, target_url, expires_at`.
**`renders`** (Video-Maker) `id, user_ref, spot_id, status, result_url, created_at`.

### 2.5 Caches (kosteneffizient)
**`api_cache`** generisch: `cache_key (text pk), payload (jsonb), fetched_at, ttl` — Meteoblue (24h, ~1km-Key), Places (24h, place_id), Wassertemp (1h ls / 12h ages). Refresh per Cron + stale-while-revalidate.

---

## 3. Mehrsprachigkeit (i18n)
- **Sprachen (Vorschlag Salzburg-Tourismus):** DE (Basis), EN, IT, FR, NL, ES, CS (Tschechisch), HU (Ungarisch) — erweiterbar. Final mit Anton.
- **URL-Struktur:** `salzguide.com/{lang}/...`, DE ohne/`/de`, **hreflang**-Tags pro Sprache (SEO, Madeira-Vorbild).
- **Inhalt:** `spot_translations`/`event_translations` je Sprache; UI-Strings via i18n-Lib (`next-intl`).
- **Anlegen:** DE-Basis → **1-Klick KI-Übersetzung** (Claude) in alle Zielsprachen, Brand-Voice + Verbots-Wörter gelten auch in Übersetzung; `reviewed`-Flag. Robust für SEO + schnelle Prozesse.
- **Sprach-Switcher:** sehr einfach, prominent (Header), merkt Auswahl (Cookie/Profil).

---

## 4. Auth & Rollen
- **Supabase Auth, Magic-Link** (E-Mail) primär; optional Apple/Google (1-Tap Mobile).
- **Rollen:** `user`, `admin` (in `profiles.role`); RLS-Policies schützen Daten.
- **Profil-Tab** (Bottom-Nav): eingeloggt → Profil/Saved/Pro-Status/Einstellungen; ausgeloggt → Login/Join.
- **Sicherheit:** Row Level Security überall; Admin-Routen serverseitig per Rolle geprüft.

---

## 5. Membership & Monetarisierung
### 5.1 Free vs. Pro (Content-Gating = #1 Conversion-Hebel, Doc 30)
- **Free:** ~20–30 Gratis-Spots voll nutzbar, Spots speichern (Listen), **begrenzte KI-Nutzung** (z.B. 5–10 Anfragen/Tag), Explore/Karte/Events/Wassertemp komplett.
- **Pro (SalzGuide Pro):** alle ~60–70 Spots, **unbegrenzte KI**, Offline/PWA-Extras, ggf. Video-Maker- & Audio-Tour-Vollzugang.
- **🔴 Pro-Gating serverseitig:** Free-Clients erhalten für Pro-Spots **nur Teaser** (kein echter Titel/Link/Detail), nicht nur CSS-Blur. RLS + serverseitige Queries.

### 5.2 Preis-/Abo-Modell (Abwägung Doc 26)
- **Einmalzahlung 19,90 € bleibt Kern** („Kein Abo" = Marketing-Asset, Trust-Anker).
- **Empfehlung:** Lifetime-Einmalkauf als Standard; **optionales Abo nur als Add-on** für laufende Kosten-intensive Features (z.B. mehr KI-/Video-Renders/Audio-Touren) — **nicht** als Pflicht. Mehrstufig denkbar: Free / Pro (Lifetime) / Pro+ (Abo-Add-on). Entscheidung bei Anton; Stripe unterstützt beides.
- **Stripe:** Checkout eingeloggt → `customer` mit User verknüpft → **Webhook** setzt `is_pro` serverseitig (sicher, sofort). Kein „Passwort-Mail nach Kauf" mehr.

### 5.3 Affiliate (Monetarisierung #2, Doc 21)
- Affiliate-Tickets/Touren (GetYourGuide u.a.) als Action-Tiles, **Werbekennzeichnung** Pflicht, Klick-Tracking in Analytics.

### 5.4 Conversion-Mechanik
- **Onboarding mit schnellem Aha** (Karte + Wow-Spots + KI testen).
- **Kontextuelle Soft-Paywalls:** beim X. Pro-Spot-Tap, KI-Limit (HTTP 402), Video-Maker, Audio-Tour.
- **Fortschritt/FOMO:** „X von Y Spots freigeschaltet", gesperrte Pro-Spots als attraktive Teaser („🤫 Geheimtipp").

---

## 6. KI-Assistent „Anton" (vereint Chat + Spot-Vorschläge)
- **Ein** konversationeller Assistent (Claude, Tool-Calling), ein Eingabefeld, kein Moduswechsel.
- **Tools:** `search_spots(wish)` (Matching/Anti-Halluzination, Doc 16), `get_spot_details(slug)`, `build_audio_tour(wish)` (Doc 31), `get_events(timeframe)`, `get_water_temp(lake)`.
- **Wissen:** `spot_embeddings` (pgvector RAG) + Tool-Zugriff auf DB. Brand-Voice + Scope-/System-Prompt (Doc 17): nur Salzburg-Reiseplanung, kurze Antworten, HTML-Spot-Links, ehrliche Empty-States.
- **Anzeige:** **Spot-Cards UND Inline-Links** je Situation. Voice-Eingabe (STT) bleibt.
- **Regel-Engine** (`ai_rules`): Baden-Verbote/Unwetter — greift für Chat & Vorschläge, im Admin pflegbar.
- **Free-Limit:** `ai_usage` serverseitig pro User/Session/Tag → bei Überschreitung Paywall (402).
- **Persona:** „Anton", Avatar wählbar. Datenschutz-Hinweis (KI-Verarbeitung).

---

## 7. Externe APIs & Caching-Layer (kosteneffizient)
Alle externen Calls **serverseitig**, Keys in ENV, Ergebnisse in `api_cache` (oder Vercel KV). Besucher lösen nie direkte Drittanbieter-Calls aus.

| Dienst | Zweck | Cache | Key |
|---|---|---|---|
| **Meteoblue** `basic-day` | 7-Tage-Wetter (activity-Spots) | 24 h | Koordinaten ~1km gerundet (geteilt) |
| **Google Places** (v1) | Öffnungszeiten + Telefon (food/Spots m. Zeiten) | 24 h | `place_id`. Open/Closed-Status **clientseitig** aus gecachten `periods` (+ AT-Feiertage inkl. Rupertitag). „Powered by Google". |
| **Behörden-Open-Data** (Land Salzburg OGD + AGES) | Wassertemperaturen | 1 h / 12 h | Seename; **null Kosten** |
| **OpenRouteService** | Routen + Höhen (nur beim Anlegen) | persistiert in `spots.route_geojson` | — |
| **Mapbox** | Karten-Rendering | — (Token domain-restricted) | — |

- **Fehler-Backoff** (5–10 min) wie Alt-Code. **Cron** (Vercel) refresht Wetter/Places/Wassertemp täglich; sonst stale-while-revalidate.
- **Pictocode-Heuristik** (Doc 13) + Inline-SVG-Wetter-Icons übernehmen.

## 8. Karten & Bottom-Sheets — `<SpotMap>` + `<BottomSheet>`
**`<SpotMap>`** Props: `markers[]`, `route?` (GeoJSON), `mode (overview|detail|saved|watertemp)`, `fullscreen`. Deckt ab: Explore-Übersicht (viele Marker, Pro-Lock), Detail (Route 🅿️→🏁 oder Punkt), Gespeichert-Karte, Wassertemperatur-Karte. Geolocate, Center/Fit-Bounds, Emoji-Marker, Glas-Popups. Anti-Leak-Map-Trick entfällt (serverseitiges Gating).
**Map-First-Explore:** Karte **vollflächig** im Hintergrund; darüber ein **Bottom-Sheet** mit Saison-Toggle + Karussells (Peek = Karussells, hochziehen = Liste/Filter). Marker-Tap → Spot-Sheet.
**`<BottomSheet>`** (iOS-2026): wiederverwendbare Komponente mit **Detents** (z.B. 12% Peek / 55% Halb / 92% Voll), Drag-Grabber, Spring-Physics, Backdrop-Blur, Scroll-Lock, Safe-Area-Insets. Genutzt für: Spot-Detail (über der Karte), KI-Assistent, Filter, Saved. Desktop-Fallback: zentriertes Sheet/Sidebar.

## 8a. Knöpfe & Status — `src/lib/ui.ts` (verbindlich)

**Die Regel: gefüllt heisst anfassbar, umrandet heisst Zustand.**

Vorher trugen beide dieselbe graue Kapsel. In der Admin-Nutzerliste standen „Pro · geschenkt" (nur Text) und „Pro schenken" (ein Knopf) nebeneinander in derselben Zeile, unterschieden durch 4px Innenabstand und 1px Schriftgrösse. Die Oberfläche darf die Frage „welches davon kann ich drücken?" gar nicht erst stellen lassen.

| | Knopf | Status |
|---|---|---|
| Fläche | **gefüllt** (`bg-accent`, `bg-black/5`, `bg-accent/10`) | **keine**, nur `ring-1` in der Textfarbe |
| Schrift | `font-semibold`, ab `text-[13px]` | `font-medium`, `text-[11px]` |
| Berührung | **immer** `active:scale-[0.98]` (Icon-Knöpfe 0.95/0.90) | nie |

Konstanten: `BTN_PRIMARY`, `BTN_SECONDARY`, `BTN_DANGER` (je mit `_SM`-Variante), `STATUS_NEUTRAL`, `STATUS_ACCENT`, `STATUS_GOOD`. Keine neuen Kapseln von Hand stylen.

`active:scale-*` war schon vorher zu 100% richtig gerichtet (98 Vorkommen, kein einziges auf einem Badge), aber es erscheint erst beim Berühren. Die Füllung ist das Merkmal, das man **im Ruhezustand** sieht.

**Drei dokumentierte Ausnahmen**, alle mit unverwechselbarem eigenen Aussehen:
1. **`<ProBadge>`** ist gefüllt und nicht anfassbar. Es ist kein Status, sondern die Wortmarke, und trägt als einziges Element der App einen Verlauf.
2. **Zähler-Punkte** (kleiner roter Kreis mit einer *Zahl*, z.B. offene Anfragen in der Admin-Navigation) bleiben gefüllt: das ist das iOS-Mitteilungsabzeichen. Sobald ein *Wort* darin steht, ist es ein Status und gehört umrandet.
3. **Über Foto und Karte** darf Status gefüllt sein, sonst ist er nicht lesbar. Dort trennt der **Schatten**: Knöpfe schweben (`shadow-md`), Beschriftungen liegen flach auf (siehe `MapCard`/`SpotDetailMap`).

## 9. Action-Tiles — eine `<ActionTile>`-Komponente
Varianten je Spot-Feld: **Anfahrt** (Auto `parking_*` / Öffis `transit_*` → Google-Maps-Deeplink), **Anrufen** (`phone`/Places `tel:`), **Tickets** (Affiliate + Werbekennzeichnung), **Website**, **Öffnungszeiten** (Places). Optionale Mikro-Animationen (Auto/Bus/Telefon). Helper `buildMapsLink(coords, mode)`.

## 10. Spot-Detailseite (Komposition)
Hero (Speichern-♡ prominent) → Quick-Facts (4, typabhängig) → Titel + Kategorie-Label → Allgemeines (+Bild) → Insider-Tipp (+Byline) → [Wetter (activity) | Öffnungszeiten (food/Zeiten)] → `<SpotMap>` → Anfahrt-Tiles → 3 Kurztexte (typabhängig) → ggf. Wassertemp/Audio/Video-Maker/Tickets → Related-Spots (Region/Vibe). Erweiterte Facts (Distanz/Höhen/Start-Ende) aus ORS.

## 11. Admin-Dashboard & Anlege-Flow (super einfach)
**Anlege-Flow (Docs 20/27/28):** Name+Typ → Karte (Start/Ziel/Stops → ORS-Auto-Route + Auto-Facts) bzw. Punkt(+`place_id`) → Stichwort-Notizen → **„Texte mit KI erzeugen"** (Claude→JSON→6 Felder, je regenerierbar) → Quick-Facts prüfen → **Medien** (Drag&Drop → WebP/AVIF bzw. Stream-Transcode) → **1-Klick-Übersetzen** → Vorschau → Speichern/Publizieren.
**Weitere Admin-Bereiche:** Spots-Liste (Filter Saison/Typ/Pro/Status), Kategorien, **Events** (KI-Draft-Review), Touren, Regel-Engine (`ai_rules`), Analytics, User/Migration, Affiliate-Links.
**Server-Routen (admin-only, rollen-geprüft):** `/api/admin/generate-spot-text`, `/api/admin/translate`, `/api/admin/upload`, `/api/admin/route`.

## 12. Medien-Pipeline (Doc 28)
Bilder: `sharp` → WebP/AVIF + responsive Sizes + **EXIF-Strip** (DSGVO) → Supabase Storage/R2 → `next/image`. Video: Cloudflare Stream (Transcode/Poster) bzw. ffmpeg-Worker. `media`-Tabelle. Getrennt von Video-Maker-User-Uploads (eigene Buckets/Lifecycles).

## 13. Subsysteme (Architektur reserviert Platz)
- **Winter-Modus (Doc 24):** `seasons`-Dimension + globaler Toggle (Spots/Kategorien/Karte), Auto-Default nach Datum, überschreibbar. **MVP.**
- **Events / Weekly (Doc 29):** `events` + KI-Wochen-Recherche (Cron) → Draft-Review → publish; Auto-Ablauf; Sektion in Entdecken. **MVP-nah.**
- **Wassertemperatur-Seite (Doc 23):** `lakes` + `<SpotMap>` + Open-Data-Cache. **MVP-nah.**
- **Video-Maker (Doc 25):** R2 (Presigned, 24h-Delete) + Creatomate + Shortener + Cap/Rate-Limit in DB; WP/n8n → Next.js-Routes. Spot-Felder `intro/preview_video_url`. **Pro-Hebel.** Phase ≥2.
- **Audio-Tour (Doc 31):** Spots+Audio (`audio_url/text`), `tours/tour_stops/connections`, KI-Tool `build_audio_tour`, **TTS-Pipeline**. ⚠️ Branding = SalzGuide (kein „nookmate", keine Prototyp-Farben). Phase ≥2.

## 14. Analytics (DSGVO-konform)
- **Cookieless EU-Tool** (Plausible oder PostHog-EU) + **eigene DB-Events** (`analytics_events`: spot-view, save, ai-query, paywall-view, purchase, affiliate-click, render).
- **Admin-Dashboard-Metriken:** Spot-Performance (Views×Verweildauer → speist `sort_weight`), Conversion-Funnel (Free→Pro), KI-Nutzung, Affiliate-Klicks, Top-Suchanfragen.
- **DSGVO:** Consent-Banner nur falls nötig (cookieless minimiert), Datensparsamkeit, EU-Hosting, Auftragsverarbeitungsverträge.

## 15. Migration der ~100 Pro-User (Doc 22)
1. Export WP/WP-Membership: E-Mail + Pro-Status (+ Stripe-Customer-ID, Kaufdatum).
2. Import → `profiles` (E-Mail) + `is_pro=true, pro_source='migration'`; Stripe-Customer per E-Mail matchen.
3. Slug-/URL-Mapping alt→neu für **301-Redirects** (SEO erhalten).
4. **Ankündigungs-Mail:** „Neue App unter salzguide.com — mit deiner E-Mail per Link einloggen, Pro ist schon da." → **null Reibung** (Magic-Link, kein Passwort).
5. Landing-/Trust-Inhalte (Founder-Video, Value-Props aus Doc 26) sind Teil der App auf **salzguide.com** (eigene Route), keine separate Subdomain mehr. *(Update 2026-07-13: App läuft direkt auf der Apex-Domain salzguide.com.)*

## 16. Projektstruktur (Next.js App Router)
```
/app
  /[lang]/(public)        explore, spot/[slug], events, wassertemperaturen, tour/[id], join, ...
  /[lang]/(auth)          profil, gespeichert, login
  /admin                  dashboard (rollen-geschützt)
  /api                    spots, ai/chat, ai/search, opening-hours, weather, water-temp,
                          videomaker/*, r/[slug], stripe/webhook, admin/*, cron/*
/components               SpotMap, SpotCard, ActionTile, Carousel, SpotWeather, OpeningHours,
                          AiAssistant, BottomNav, SeasonToggle, SaveButton, Paywall, ...
/lib                      supabase, claude, mapbox, ors, places, meteoblue, cache, brand-voice, i18n
/content                  brand-voice.ts (zentrale Voice-Konstante)
```

## 17. Sicherheit & DSGVO (Querschnitt — **verbindlich**, Details in `33_SICHERHEIT_DSGVO.md`)
**Pflicht in jedem Baustein** (AT/EU-Recht, Stand Juni 2026):
- Alle Keys in **ENV** (Meteoblue, Places, Mapbox, ORS, Claude, Stripe, R2, Creatomate, ElevenLabs).
- **Pro-Gating serverseitig** + **RLS (Default deny)** auf allen Tabellen. Admin-Routen rollen-geprüft.
- **Security-Header/CSP/HSTS**, CORS restriktiv, Input-Validierung (`zod`), Output-Sanitizing (KI-HTML).
- **Rate-Limits + Bot-Schutz (Turnstile)** auf KI/Upload/Auth/Video-Maker; **CSRF**; **Stripe-Webhook-Signatur**.
- **Sicherer Upload** (Whitelist, Größen/Typ-Check, EXIF-Strip, Presigned, Storage außerhalb Web-Root).
- **EU-Datenresidenz** überall, **AVVs** mit allen Auftragsverarbeitern, Drittland (USA) per **DPF/SCCs**.
- **Betroffenenrechte** (Auskunft/Löschung/Export-Self-Service), **Aufbewahrungsfristen** (Video-Originale 24h u.a.), **72h-Breach-Meldung** an DSB.
- **Cookieless EU-Analytics** (Consent minimieren); **Rechtstexte** (Impressum/ECG, Datenschutz, AGB, **Widerruf/FAGG**).
- **EU AI Act (ab 2.8.2026):** KI „Anton" klar als **KI kennzeichnen** (Transparenzpflicht Art. 50).
- **Dependency-Scanning, Logging/Monitoring, Backups, Pre-Launch-Security-Review + Anwalt/DSB-Review.**

## 18. Roadmap / Phasen (Empfehlung)
- **Phase 1 — MVP Kern:** Stack/DB/Auth, Spots+i18n, Explore (Karte+Karussells+Saison-Toggle), Spot-Detail (beide Typen, Wetter/Öffnungszeiten/Anfahrt), Saved-Listen, Membership/Stripe + Pro-Gating, Migration, Landingpage-Redirect.
- **Phase 2 — KI & Admin-Komfort:** Assistent „Anton" (Chat+Vorschläge+Voice+Regeln+Limit), Admin-Anlege-Flow (ORS-Route, KI-Texte, Medien-Pipeline, 1-Klick-Übersetzung), Analytics-Dashboard, Events/Weekly, Wassertemperatur-Seite.
- **Phase 3 — Differenzierer:** Video-Maker, Audio-Tour (TTS), Offline/PWA, „Schon besucht", Affiliate-Ausbau, Abo-Add-on.

→ Der **Masterprompt** (`03_MASTERPROMPT.md`) setzt diese Phasen in konkrete, anfängerfreundliche Claude-Code-Schritte um.

