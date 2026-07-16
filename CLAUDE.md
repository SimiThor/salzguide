# SalzGuide App — Projektkontext
Wir bauen salzguide.com: eine mobile-first Reise-Spot-Plattform für das Salzburger Land,
die sich wie eine **Apple iOS 2026 App** anfühlt. Neuaufbau einer langsamen WordPress-Seite.

## Prinzipien
- Mobile First, iOS-2026-Feel: super aufgeräumt, minimalistisch, leicht navigierbar.
- MAP-FIRST: Explore-Karte vollflächig (wie Apple Maps). Inhalte in iOS-BOTTOM-SHEETS
  (ziehbar, Detents Peek/Halb/Voll, Grabber, Spring-Animation, Blur).
- Robust & sicher: TypeScript strict, alle Secrets in ENV, Pro-Inhalte serverseitig gaten
  (nie nur per CSS verstecken), Supabase Row Level Security.
- Performance: Bilder als WebP/AVIF + next/image, externe APIs serverseitig cachen.
- Ein System statt Duplikate: Saison (summer/winter) & Spot-Typ (activity/food) als Daten-Dimension.

## Design-Tokens
- Akzent/Rot: #cc2924 · Text: #111 · Sekundärtext: #6C5B57 · Hintergrund (Creme): #faf6ec
- Radien: Cards 16px, Sheets/Promo 22px · Font: Inter / SF (system-ui Fallback)
- Viel Weißraum, Glas/Blur (backdrop-filter), weiche Schatten, Emoji als Section-Icons.

## Stack
Next.js (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres/Auth/Storage, EU) ·
Mapbox GL JS · Stripe · i18n via next-intl. (Phase 2+: Claude API, OpenRouteService, Cloudflare.)

## Sprache
Code, Variablen, Commits = Englisch. (Nutzer-Texte/Inhalte mehrsprachig, DE-Basis.)

## Arbeitsweise
- Kleine, überprüfbare Schritte. Nach jedem Schritt kurz erklären, was zu testen ist.
- Keine Secrets committen. Bei Unsicherheit: nachfragen statt raten.
