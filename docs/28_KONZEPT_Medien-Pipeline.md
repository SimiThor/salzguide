# Konzept — Medien-Upload, Komprimierung & WebP/Video-Pipeline

Anforderung (Anton): Foto-Upload (JPG/PNG), **automatisch komprimieren + in WebP umwandeln**; **MP4-Videos hochladen + komprimieren**. Teil des „super einfach anlegen"-Flows.
Stand: 2026-06-21.

---

## 1. Bilder
- **Eingang:** JPG, PNG (auch **HEIC** vom iPhone abdecken — häufig bei Handy-Uploads).
- **Verarbeitung (serverseitig, beim Upload):** mit **`sharp`** (Node) →
  - **Umwandlung in WebP** (primär) + optional **AVIF** (noch kleiner, moderne Browser) mit `<picture>`-Fallback.
  - **Responsive Größen** generieren: z.B. Thumbnail (Karten ~400/800w), Detail/Hero (~1600w), evtl. 2× für Retina. Spart massiv Bandbreite (Karussells/Hero).
  - **EXIF strippen** (Datenschutz: GPS aus Handyfotos raus — DSGVO! — + kleiner).
  - Sinnvolle Qualität (z.B. WebP q≈75–80), max-Dimensionen begrenzen.
- **Speicher:** Supabase Storage (EU) **oder** Cloudflare R2 (schon vorhanden). Auslieferung über CDN + **`next/image`** (lazy, responsive `srcset`).
- **UX im Admin:** Drag&Drop, Upload-Progress, Hero markieren, Reihenfolge per Drag, Alt-Text (auto-Vorschlag aus Spot-Name/KI), Live-Vorschau.
- → Löst das heutige manuelle „_Explore_Vorschaubild.webp"-Erstellen ab (lief bisher per Hand).

## 2. Videos (MP4)
- **Eingang:** MP4 (Handy/Kamera, oft groß/H.265).
- **Verarbeitung/Komprimierung:** Transcoding ist rechenintensiv → **nicht** in der normalen Serverless-Funktion (Vercel-Zeitlimits). Optionen:
  - **A) Cloudflare Stream (empfohlen):** Upload → automatisches Transcoding, adaptive Bitraten, **Poster/Thumbnail**, web-optimierte Auslieferung. Passt zu R2/Cloudflare-Stack, wenig eigener Code.
  - **B) Mux** (Video-API, ähnlich) — Alternative.
  - **C) `ffmpeg` in Background-Job/Worker** (z.B. eigener Worker/Queue) → kleines web-optimiertes **MP4 (H.264) + WebM**, Poster-Frame. Mehr Kontrolle, mehr Eigenbau.
- **Anwendungsfälle:** Spot-Hero-/Inhalts-Videos, **kleine Loop-Preview-Videos** (Karten-Hintergründe, vgl. Video-Maker `preview_video_url` ~500 KB), Founder-/Story-Videos.
- **Optional clientseitige Vorkomprimierung** für kleine Clips (schnellerer Upload), aber Server bleibt „source of truth".

## 3. Gemeinsame Medien-Architektur
- **`media`-Tabelle pro Spot:** `id, spot_id, type (image|video), role (hero|gallery|preview|content), url, variants(jsonb: Größen/Formate), poster_url, alt, sort_order`. (Meist sprachneutral; Alt-Text optional je Sprache.)
- **Ein Upload-Service/Route** `/api/admin/upload` (Bilder: sharp→WebP/AVIF+Sizes; Videos: an Stream/Worker übergeben), Admin-only, Größen-/Typ-Validierung, Progress.
- **DSGVO:** EU-Storage, EXIF-Strip (GPS!), klare Rechte an Bildern (Kooperations-Hinweis SalzburgerLand/Gastein wie heute).
- **Abgrenzung zum Video-Maker (Doc 25):** dort sind es **User-Uploads** (R2, 24h-Delete, Creatomate-Render). Hier sind es **Admin-/Redaktions-Medien** (dauerhaft, Spot-Content). Können **dieselbe Storage-Schicht (R2/Supabase)** + ähnliche Transcoding-Wege nutzen, sind aber getrennte Buckets/Prefixe & Lebenszyklen.

## 4. Einordnung in „Spot anlegen"
Schritt „Bilder/Videos hochladen" im Anlege-Flow (Doc 27 §5): Drag&Drop → **automatisch WebP/AVIF + Größen** (Bild) bzw. **Transcode + Poster** (Video) → Hero/Reihenfolge setzen → fertig. Kein manuelles Vor-Komprimieren mehr.

## 5. Architektur-Auswirkung
- Lib **`sharp`** für Bilder; **Cloudflare Stream** (empfohlen) oder ffmpeg-Worker für Video.
- `media`-Tabelle + Upload-Route + CDN-Auslieferung (`next/image`).
- EU-Storage + EXIF-Strip (DSGVO).
- Performance-Gewinn ggü. Alt-Seite: konsequent WebP/AVIF + responsive + lazy → schnelle, leichte Explore/Detailseiten (Antons „langsam"-Problem gelöst).
