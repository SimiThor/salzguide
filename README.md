# SalzGuide

Mobile-first Reise-Spot-Plattform für das Salzburger Land — [salzguide.com](https://salzguide.com).

Stack: Next.js (App Router, TypeScript) · Tailwind CSS · Supabase (EU/Frankfurt) ·
Mapbox GL JS · Stripe · next-intl.

Projektkontext und Prinzipien: siehe [CLAUDE.md](CLAUDE.md).
Fachliche Doku: siehe [docs/](docs/) — Einstieg über [docs/00_START_HIER.md](docs/00_START_HIER.md).

## Setup

Voraussetzung: Node.js 20+.

```bash
npm install
cp .env.local.example .env.local   # danach echte Werte eintragen (siehe unten)
npm run dev
```

Läuft dann auf http://localhost:3000. Die App startet mit Locale-Präfix, also `/de`.

Zum Testen am Handy: Der Dev-Server zeigt beim Start auch eine Network-URL
(`http://192.168.x.x:3000`) — die im selben WLAN am iPhone öffnen.

## Environment-Variablen

Alle Variablen sind in [.env.local.example](.env.local.example) dokumentiert — das ist die
gemeinsame Referenz im Team. Die echten Werte gehören ausschließlich in
`.env.local`, das nie committet wird.

**Ohne diese vier startet die App nicht bzw. bleibt die Karte leer:**

| Variable | Woher |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | mapbox.com → Account → Tokens (Public, `pk.*`) |

Alles andere (Stripe, Anthropic, Resend, ElevenLabs, ORS, Google Places) wird erst
gebraucht, wenn du am jeweiligen Feature arbeitest. Leer lassen ist in Ordnung —
die betroffenen Routen antworten dann mit einem Fehler, der Rest der App läuft.

Regeln:

- **Keine Secrets committen.** `.env.local` ist per `.gitignore` gesperrt.
- **Keys nie per Chat oder Mail teilen** — Passwort-Manager benutzen.
- **Neue Variable im Code?** Immer auch in `.env.local.example` eintragen (ohne Wert),
  damit sie im Team sichtbar ist.
- `SUPABASE_SERVICE_ROLE_KEY` umgeht Row Level Security. Nur serverseitig
  verwenden, niemals im Client-Code.
- In Produktion kommen dieselben Variablen in die Vercel-Projekt-Settings,
  nicht in eine Datei.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server (Turbopack, Hot Reload) |
| `npm run build` | Produktions-Build — vor dem Pushen laufen lassen |
| `npm start` | Produktions-Build lokal starten |
| `npm run lint` | ESLint |

Hinweis: Next.js liest `.env.local` nur beim Start ein. Nach Änderungen an der
Datei den Dev-Server neu starten — Hot Reload greift dort nicht.

## Cron

[vercel.json](vercel.json) konfiguriert einen wöchentlichen KI-Recherche-Lauf
(montags 05:00) auf `/api/cron/events`. Der Endpunkt ist über `CRON_SECRET`
abgesichert und antwortet ohne gesetztes Secret mit 401 — in den
Vercel-Projekt-Settings muss `CRON_SECRET` also gesetzt sein, sonst läuft der
Job ins Leere. Lokal wird er nicht gebraucht.

## Konventionen

Code, Variablennamen und Commit-Messages auf Englisch. Nutzer-Texte mehrsprachig
mit Deutsch als Basis (`messages/`).
