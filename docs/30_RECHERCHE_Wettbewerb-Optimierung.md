# Recherche — Vergleichbare Plattformen & Optimierungen für SalzGuide

Stand: 2026-06-21. Quellen unten verlinkt.

---

## 1. Benchmarks (was machen erfolgreichere Plattformen, was nehmen wir mit?)

| Plattform | Modell / Erfolg | Für SalzGuide übernehmen |
|---|---|---|
| **Rexby** (Creator-Reiseguides) | Karten-Guides mit gepinnten Spots, Fotos/Videos, Insider-Tipps + **„smart assistant trained on the creator's own recommendations"**, Premium-Upgrades, Buchungs-Provision. **= quasi unser Modell** | Validiert KI-„Anton" (Assistent auf eigenem Wissen). „My Rexby"-Hub (Saved + Trips + Tipps an einem Ort) als Vorbild für **Gespeichert/Profil**. Premium-Upgrades + Buchungs-Provision (= unsere Affiliate-Tickets). |
| **AllTrails** (65 Mio. User, Freemium) | Frei: Suche, Karte, **Listen zum Speichern**, Reviews/Fotos, GPX. Pro: Offline-Karten u.a. Stärke = **Community-Reviews + aktuelle Zustände** | **Saved als kuratierbare Listen** (nicht nur flache Merkliste). **Offline-Karten** als Pro-Hebel. Optional später: leichte Community-Signale (war ich da / aktuell?). |
| **Komoot** | **Eine Region gratis, weitere freischalten** (Region-Unlock, Bundles), personalisierte KI-Routen | Unser Free/Pro-Split (Gratis-Spots vs. Pro-Spots) = dieselbe Logik wie Region-Unlock → bewährt. Saubere **„X von Y freigeschaltet"-Optik**. |
| **Outdooractive** | Größte DB, **enge Tourismusverband-Integration**, KI-Routenvorschläge | Anton arbeitet schon mit **SalzburgerLand Tourismus** → Content-/Reichweiten-Partnerschaft als Wachstumshebel. |
| **Atlas Obscura** | Kuratierte Hidden Gems (Editor-geprüft) + UGC, **ganze DB auf einer Karte**, Custom-Listen, **„Been There"-Tracking**, Browse-by-Interest, Trips/Experiences als Umsatz | **„Schon besucht"-Tracking** (leichte Gamification), Browse-by-Interest/Vibe-Filter, kuratierte Qualität als Marken-USP. Experiences/Touren als zusätzlicher Umsatz (→ Affiliate). |
| **Visit Madeira** (Antons Vorbild) | Offizielle Destinations-Seite, sehr sauberer Header, Wishlist | siehe §2 |

## 2. Visit Madeira — konkret was gut ist (Antons Wunsch)
- **Header:** clean, **Live-Wetter (26 °C) direkt im Header**, Suche, Sprach-Switcher (DE/EN/ES/FR/PT), Logo + Claim. → **Live-Wetter/Temperatur im Header** ist ein schöner, leichter Trust-/Kontext-Anker (haben wir per Meteoblue eh).
- **„Zur Wishlist hinzufügen" (♡)** prominent **im Hero** jeder Spot-Seite → genau Antons „Speichern". Übernehmen: Speichern direkt im Hero, ein Tap, klare Herz-Interaktion.
- **Strukturierter „Einzelheiten"-Block:** Distanz · Schwierigkeit · Dauer · **Start/Ende** · **Höchster/Tiefster Punkt**. → Unsere Quick-Facts um **Höhenmeter (max/min) und Start/Ende** ergänzen (kriegen wir aus der ORS-Route gratis!).
- **Status „Derzeit OFFEN"** (Zugang/Öffnung) → passt zu unserem Öffnungszeiten-Status.
- **„Weitere Routen an der Ostküste"** = Related-Spots **nach Region** → eigene Related-Logik.
- **Mehrsprachige URLs pro Sprache** (sauberes hreflang/SEO) → bestätigt unser i18n-URL-Konzept.
- Starke **Foto-Galerien** + eingebettetes Video pro Spot.
- *Weniger gut (nicht übernehmen):* überladenes Mega-Menü, behördlich-statische Anmutung, kein App-Feel. Unser iOS-Look ist hier im Vorteil.

## 3. Conversion / Paywall — datenbasiert (RevenueCat/Airbridge 2026)
- **#1 Conversion-Treiber: 26 % upgraden für „full content access"** → unser **Pro-Spots-Gating ist genau richtig**. Gesperrte Highlights sichtbar (Teaser) machen, aber Inhalt erst nach Kauf.
- **Hard Paywall ~10,7 % vs. Freemium ~2,1 %** Conversion — aber Freemium gewinnt Top-of-Funnel/Reichweite. → Antons Wunsch (Free testet gut, konvertiert trotzdem) = **Freemium mit „soft walls"**: großzügig testen lassen, an den richtigen Stellen sanft zur Paywall führen.
- **Trial-Format-Screens gewinnen 64,5 %** der Tests ggü. reinen Bild-Paywalls; **Aha-Moment früh** (Onboarding mit kurzem Walkthrough) entscheidend, **80 % der Conversions an Tag 0**. → **Onboarding mit schnellem Wow** (Karte + 1–2 Wow-Spots + KI ausprobieren) und **gut platzierte, kontextuelle Paywalls** (beim 3. Pro-Spot-Tap, beim KI-Limit, beim Video-Maker).
- **Längere „Trials" konvertieren besser** (17–32 Tage: 45,7 % vs. 3–7 Tage: 26,8 %). Für unser **Einmalkauf-Modell** heißt das: Free-Tier **großzügig** halten (genug Wert über Tage erlebbar) statt hart früh dichtmachen → höhere spätere Conversion. Deckt sich mit „kein Abo"-Positionierung.

## 4. Konkrete Optimierungen für SalzGuide (priorisiert)

**Hoch (in MVP-Architektur einplanen):**
1. **Speichern als Listen** (z.B. „Sommer-Trip", „Mit Kindern", „Food") statt flacher Merkliste — wie AllTrails/Rexby. Gespeichert-Seite = persönlicher Hub (Karte + Listen).
2. **Live-Wetter/Temperatur im Header** (leicht, Meteoblue vorhanden) — Madeira-Stil.
3. **Speichern prominent im Spot-Hero** (1-Tap-♡), nicht versteckt.
4. **Quick-Facts erweitern** um Höhenmeter (max/min), Distanz, Start/Ende — automatisch aus ORS-Route. Hebt Detailtiefe auf AllTrails/Madeira-Niveau.
5. **Onboarding mit schnellem Aha** + **kontextuelle Soft-Paywalls** (Pro-Spot-Tap, KI-Limit, Video-Maker). Trial-/Wert-betonte Paywall-Screens.
6. **Related-Spots nach Region/Vibe** auf Detailseiten (mehr Tiefe, mehr Seitenaufrufe, SEO).

**Mittel (Phase 2):**
7. **„Schon besucht"-Tracking** (Atlas-Obscura-Stil) — leichte Gamification, Bindung.
8. **Offline-Karten/Spots** als zusätzlicher Pro-Vorteil (PWA „zur Startseite hinzufügen", offline-fähig → echtes App-Gefühl ohne App-Store).
9. **Leichte Frische-Signale** (z.B. „zuletzt geprüft", saisonale Hinweise) statt voller Community-Reviews — passt zur kuratierten Marke.
10. **Tourismusverband-Partnerschaft** (SalzburgerLand) für Reichweite/Content.

**Conversion-spezifisch:**
11. Gesperrte Pro-Spots als **attraktive Teaser** (Blur + „🤫 Geheimtipp") — haben wir, beibehalten/verfeinern.
12. **Wert sichtbar machen:** „X von Y Spots freigeschaltet", „Du hast N Spots gespeichert" → FOMO + Fortschritt (Komoot/AllTrails-Logik).

## 5. Strategische Einordnung
SalzGuide trifft mit **kuratiert + local + Karte + KI-Assistent auf eigenem Wissen + Freemium** exakt das **Rexby/Atlas-Obscura-Erfolgsmuster**, aber **fokussiert auf eine Region (Salzburg) mit Founder-Trust (Anton & Simon)** — das ist ein starker, verteidigbarer Nischen-USP. Die größten Hebel: (a) **Saved/Listen + Profil-Hub** ausbauen, (b) **Onboarding/Aha + kontextuelle Paywalls** für Conversion, (c) **Detailtiefe** (Höhen, Status, Related) auf Top-Niveau, (d) **Offline/PWA** für echtes App-Gefühl.

---

### Quellen
- AllTrails: [alltrails.com](https://www.alltrails.com/), [Pro-Benefits](https://support.alltrails.com/hc/en-us/articles/37200882853140-The-benefits-of-AllTrails-premium-membership), [Review](https://sheexplorestheusa.com/2025/11/alltrails-app-review-free-vs-paid-is-it-worth-it/)
- Komoot vs Outdooractive: [magazintime.de](https://magazintime.de/outdooractive-oder-komoot-welche-app-passt-besser-zu-deinen-abenteuern/), [outdoor-renner.de](https://www.outdoor-renner.de/blog/die-top-5-wander-apps-fuer-unvergessliche-outdoor-abenteuer.html)
- Rexby: [rexby.com](https://www.rexby.com/), [Creator-Plattform](https://www.rexby.com/blog/the-all-in-one-platform-for-creators-to-host-and-sell-travel-guides)
- Thatch: [thatch.travel](https://www.facebook.com/thatch.travel/)
- Atlas Obscura: [atlasobscura.com](https://www.atlasobscura.com/), [Business/Next chapter](https://www.therebooting.com/p/atlas-obscuras-next-chapter)
- Conversion/Paywall: [RevenueCat 2026 Benchmarks](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/), [Airbridge Hard vs Soft Paywall](https://www.airbridge.io/en/blog/hard-vs-soft-paywalls), [Adapty Trial Conversion](https://adapty.io/blog/trial-conversion-rates-for-in-app-subscriptions/)
- Visit Madeira (Vorbild Header/Wishlist): [visitmadeira.com](https://visitmadeira.com/de/)
