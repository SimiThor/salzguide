# Alt-Code-Analyse #5 — Öffnungszeiten (Google Places)

Quelle: `sg-oeffnungszeiten_v1.php` (532 Zeilen). Stand: 2026-06-21.

---

## 1. Architektur (sehr sauber — Vorbild fürs Neubau)
- **Google Places API (new / v1)** wird **nicht direkt vom Browser** aufgerufen, sondern über einen **Cloudflare Worker** als Proxy: `https://googlekey.anton-ab0.workers.dev/?place_id=...`.
- Der **Worker hält den Google-API-Key geheim** und **cached die Antwort 1×/Tag am Edge**. Der Browser fetcht nur den Worker (`cache:"no-store"`, also genau 1 Fetch pro Widget, keine Doppel-Calls).
- → Das ist exakt das „kosteneffizient + sicher"-Muster: **Key serverseitig, 1 Call/Tag/Spot gecached.**
- `place_id` aus Shortcode-Attribut oder Post-Meta `place_id`.

## 2. Genutzte Google-Felder
`currentOpeningHours`, `regularOpeningHours` (jeweils `periods[]` + `weekdayDescriptions[]`), `utcOffsetMinutes`.

## 3. Logik läuft clientseitig (kein weiterer API-Call)
- `computeOpenStateLocal(periods, utcOffset)` rechnet in **Ortszeit** des Lokals: `openNow`, `nextCloseIso` („bis 18:00"), `nextOpenIso` („öffnet um…"), und welcher Wochentag hervorzuheben ist.
- Rendert `weekdayDescriptions` (Mo→So), **heute markiert** (`.today`), Status-Badge grün „Jetzt geöffnet · bis 18:00" / „Geschlossen · öffnet …".
- **Pflicht-Attribution „Powered by Google"** wird gesetzt.
- DE/EN über Shortcode-Variante (`data-lang`), ein gemeinsames JS.

## 4. Bonus: Feiertags-Logik
`holidaysAT(year)` berechnet österreichische Feiertage **inkl. Salzburg-spezifischem Rupertitag (24.9.)** und beweglicher Feiertage (Ostern per Gauß/Butcher → Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam). Feiertage werden in der aktuellen Wochenliste als Badge markiert. → Nice-to-have, im Neubau übernehmbar.

## 5. Konsequenzen fürs Neubau
1. **Worker-Muster übernehmen**, aber als **Next.js-Server-Route** (`/api/opening-hours?spotId=…`) oder Edge-Function: Google-Key in ENV, Antwort **täglich** in Supabase-Tabelle `places_cache(place_id, payload, fetched_at)` **oder** Vercel KV cachen. Client bekommt nur gecachte Daten.
   - *(Antons bestehender Cloudflare-Worker könnte sogar weiterlaufen — aber sauberer ist alles in einer Codebase/ENV.)*
2. **Open/Closed- + Feiertags-Berechnung clientseitig** als React-Hook/Util 1:1 portieren (spart Calls, immer live in Ortszeit).
3. `place_id` wird **Spot-Feld** (`google_place_id`), Quick-Eingabe im Admin.
4. „Powered by Google" beibehalten (ToS).
5. Caching-ToS beachten: place_id dauerhaft, Detailfelder ≤30 Tage → tägliche Aktualisierung konform.

## 6. Gemeinsames Caching-Bild (Wetter + Places)
| Quelle | Key/Granularität | Cache | Status-Berechnung |
|---|---|---|---|
| Meteoblue | Koordinaten ~1km gerundet | 24 h | serverseitig fertig geliefert |
| Google Places | `place_id` | 1×/Tag | **clientseitig** aus gecachten periods |

→ Im Neubau: **eine** generische Server-Caching-Schicht (Supabase-Tabelle oder KV) + täglicher Refresh (Cron) für beide. Keys nur in ENV.
