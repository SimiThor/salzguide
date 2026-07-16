# Alt-Code-Analyse #11 — Action-Tiles: Anrufen + Tickets

Quelle: `Telefonnummer_v1.html` (197 Z.) + `Tickets_v2.html` (304 Z.). Stand: 2026-06-21.

---

## 1. Was es ist
Eine klickbare **Kachel „Anrufen"** mit animiertem klingelndem Telefon-Icon, die per **`tel:`-Link** direkt einen Anruf startet. Für **Food-Spots / Lokale** (Reservierung). Optik/Animation identisch zur Anfahrt-Kachel (gleiche „Action-Tile"-Familie).

## 2. Daten
- Nummer aus Shortcode-Attribut `tel` **oder** Post-Meta **`phone`**. → Spot-Feld `phone`.
- Nummer-Sanitizing (nur Ziffern + `+`), `href = tel:+43…`.
- Label/Untertitel „Jetzt anrufen", DE/EN.

## 3. Action-Tiles-Familie (Detailseiten)
Aus den Code-Kommentaren bekannt, gleiche Architektur (`static $done`, Shortcode, Animation):
- `sg_anfahrt` — Auto/Öffis (Doc 19)
- `sg_anrufen` — Telefon (dieses)
- `sg_tickets` — (Tickets-Link, noch kein Code gesehen)
- `sg_oeffnungszeiten` — Öffnungszeiten (Doc 14)

→ Im Neubau: **eine generische `<ActionTile>`-Komponente** (Icon + Label + Sub + Link/Aktion), Varianten: Anfahrt, Anrufen, Tickets, Website etc. Bedingt gerendert je nach vorhandenen Spot-Feldern.

## 4. Tickets-Widget (`sg_tickets`, `Tickets_v2.html`)
- Klickbare Kachel → **Ticket-/Buchungs-Shop bzw. Affiliate-Link** (z.B. Partner `gyg` = GetYourGuide). Animiertes Ticket-Icon.
- Felder: `ticket_url` (Meta-Fallback), `label` („was man bucht"), optional `price`/`currency`, `partner`/`provider`, `affiliate` (an/aus), `ad_label`.
- **🟢 Monetarisierung #2 (neben Pro):** **Affiliate-Umsätze** aus Touren/Tickets. Mit **Werbe-Kennzeichnung** („Anzeige"/„Ad") — rechtlich Pflicht. → Im Neubau Affiliate-Tiles + Kennzeichnung übernehmen; Klicks ggf. tracken (Analytics).

## 5. Konsequenzen Datenmodell
- Spot-Felder ergänzen: `phone` (Anruf), `ticket_url` + Affiliate-Metadaten (`partner`, `price`, `currency`), optional `website_url`.
- Telefon kann optional auch aus **Google Places** kommen (`nationalPhoneNumber`) → manuell `phone` oder aus Places-Cache.
- **`<ActionTile>`-Varianten:** Anfahrt · Anrufen · Tickets (Affiliate) · Öffnungszeiten · Website — bedingt je Spot-Feld.
