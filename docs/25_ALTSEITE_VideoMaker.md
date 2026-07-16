# Alt-Analyse #15 — SalzGuide Video Maker (entwickelt, noch nicht released)

Quelle: `SalzGuide_VideoMaker_Doku.docx` (v1.4) + 2 HTML-Snippets (UI + R2-Endpoint). Stand: 2026-06-21.
> ⚠️ Secrets aus der Doku werden hier **bewusst nicht** notiert (liegen in Antons Passwort-Manager / kommen in ENV).

---

## 1. Was es ist
Auf einer Spot-Seite kann der Besucher **ein eigenes Story-Video** erstellen: lädt ein kurzes Wandervideo hoch, wählt per **Trim-Selektor die besten 5 Sek**, das System rendert ein **15-Sek-9:16-Story-Video** = **10 Sek vorgerenderte 3D-Spot-Animation + 5 Sek User-Video + SalzGuide-Watermark + Spot-Label**. Ergebnis: ansehen / **herunterladen / teilen** (Web-Share-API → Instagram-Story etc.), via gebrandeter Short-URL `salzguide.com/r/abc123`.
- **Zero Friction:** kein Login, < 1 Min. **DSGVO:** Originale nach 24 h gelöscht, EU-Storage.
- Geplant: **80 Spots × 2 Sprachen = 160 Animationen** (pro Spot eigene 10-Sek-3D-Animation in Final Cut).

## 2. Aktueller Stack
| Teil | Heute |
|---|---|
| Frontend | WordPress WPCode-Shortcode `[salzguide_videomaker]`, Modal/Bottom-Sheet, State-Machine (idle→trim→uploading→processing→done/error), Custom-Video-Player |
| Upload-Storage | **Cloudflare R2** (EU), Direct-Browser-Upload via **Presigned URL** (AWS SigV4), Auto-Delete 24 h |
| Render-Storage | Backblaze B2 (Creatomate-Default), 30 Tage |
| Render-Engine | **Creatomate** API (Template 1080×1920/15s), Plan $41/Mon, 1000 Credits |
| Orchestrierung | **n8n** (self-hosted, Frankfurt): render-trigger, render-status-Polling, Daily-Cap-Check, Email-Alert |
| REST-Endpoints (WP) | `upload-url` (Presigned + IP-Rate-Limit 3/h), `shorten` (`/r/{slug}`), `cap-check` (Daily-Cap 80/Tag, Transients) |
| Sicherheit | IP-Rate-Limit 3/h, Daily-Cap 80/Tag (+1×/Tag Email-Alert), geplant: Cloudflare Turnstile (Bot) |

Datenfluss: Spot-Seite → Modal → Upload (Validierung: video/*, ≤200 MB, 5 s–5 min) → Presigned-URL holen → Direct-Upload R2 → n8n render-trigger → Creatomate → Status-Polling → Short-URL → Done (Player + Share/Download).

## 3. 🟢 Integration in die neue Architektur (Next.js)
**Konsolidieren statt WordPress+n8n-Sprawl, aber bewährte externe Dienste behalten:**
1. **WP-REST-Endpoints → Next.js Server-Routes:** `/api/videomaker/upload-url` (Presigned R2), `/api/videomaker/render` (Creatomate-Trigger), `/api/videomaker/status`, `/api/r/[slug]` (Shortener). Eine Codebase, ENV-Secrets.
2. **R2 behalten** (EU, schon eingerichtet) — Presigned PUT, Lifecycle Auto-Delete 24 h `originals/`. **Creatomate behalten** (Render-Engine).
3. **n8n entfällt** (optional): Orchestrierung als Server-Route + leichte Job-/Polling-Logik (Status-Poll Client→Route→Creatomate). Daily-Cap/Rate-Limit in **Supabase** statt WP-Transients. Email-Alert via Server (Resend o.ä.).
4. **URL-Shortener** → Supabase-Tabelle `short_links(slug, target_url, expires_at)` + `/r/[slug]`-Route. Whitelist Backblaze/R2.
5. **Spot-Felder ergänzen:** `intro_video_url` + `preview_video_url` **je Sprache** (die 10-Sek-Animation + Karten-Loop-Vorschau). Feature ist **pro Spot opt-in** (nur Spots mit Animation zeigen den Maker).
6. **Limits an User-Tier koppeln (Conversion-Hebel!):** Die Doku plant bereits „Free 3 Renders/Tag, Pro unbegrenzt" (zurückgestellt). Im Neubau mit Accounts **natürlich umsetzbar** → **zusätzlicher Pro-Vorteil**. Harte Kosten-Caps (Creatomate-Credits, Daily-Cap, Per-User-Limit) beibehalten; Creatomate Auto-Recharge AUS.

## 4. Architektur-Konsequenzen (zusammengefasst)
- Neues Subsystem **„Media/Render"**: R2-Storage + Creatomate + Shortener + Cap/Rate-Limit (in DB, pro User/IP).
- **Spot-Modell** bekommt Video-Maker-Felder (intro/preview je Sprache) — passt ins mehrsprachige Spot-Schema.
- **Monetarisierung:** Video Maker als **Pro-Lever** (Free begrenzt) — stützt Conversion-Ziel.
- **DSGVO:** EU-Storage, 24-h-Löschung, Datenschutzhinweis im Flow — übernehmen.
- **Kostenwächter:** Creatomate $41/Mon-Cap, Daily-Cap, Per-User-Limit — Pflicht.
- **Launch-Status:** noch nicht released; Architektur **reserviert sauber den Platz**, Rollout nach Spot-Animationen (Antons Content-Aufgabe).

## 5. Offene Fragen an Anton (Video Maker)
- [ ] Soll der Video Maker **mit der neuen Plattform live gehen**, oder weiter separat/später? (Architektur hält den Platz so oder so frei.)
- [ ] **n8n** behalten (falls du es eh nutzt) oder in Next.js-Routes auflösen (Empfehlung: auflösen)?
- [ ] Free/Pro-Render-Limits final (z.B. Free 1–3/Tag, Pro mehr/unbegrenzt)?
