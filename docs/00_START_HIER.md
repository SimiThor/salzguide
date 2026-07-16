# 🚀 START HIER — So baust du SalzGuide (für Anfänger)

Du hast alles, was du brauchst: Architektur (`02`), Masterprompt (`03`), Analysen (`10–33`).
Hier der konkrete Weg vom Nichts bis zur ersten lauffähigen Seite.

---

## Schritt 1 — Accounts & Keys anlegen (heute, ~1 Std.)
Leg diese an und schreib die Keys in eine sichere Notiz (Passwort-Manager):
- [ ] **Supabase** → neues Projekt, **Region Frankfurt (EU)**. Keys: URL, anon, service_role.
- [ ] **Vercel** → mit GitHub verbinden (Hosting).
- [ ] **GitHub** → neues leeres Repo `salzguide-app`. *(hast du)*
- [ ] **Stripe** → Produkt „SalzGuide Pro 19,90 € einmalig". *(hast du)*
- [ ] **Mapbox** → ein sauberer Token. **Meteoblue** + **Google Places** Key. *(Meteoblue hast du im Altcode)*

> Claude (Anthropic), OpenRouteService, Cloudflare brauchst du erst in Phase 2 — jetzt überspringen.

## Schritt 2 — VS Code + Claude Code installieren & Projekt öffnen (empfohlen)
- [ ] **VS Code** installieren (code.visualstudio.com) — anfängerfreundlich: Dateibaum + Diffs sichtbar.
- [ ] **Claude Code** installieren & in VS Code nutzen: integriertes Terminal öffnen (`Ansicht → Terminal`), in den Projektordner wechseln, `claude` starten (klinkt sich automatisch in VS Code ein). Alternativ die „Claude Code"-Extension aus dem Marktplatz. Anleitung: https://code.claude.com/docs
- [ ] Projektordner in VS Code öffnen (`Datei → Ordner öffnen`).
- [ ] **Wichtig:** Kopiere den ganzen `docs/`-Ordner **in das Projekt**, damit Claude Code ihn lesen kann.
- 💡 Vorteil VS Code: Du siehst jede Änderung als **Diff** und nimmst sie per Klick an. Lass dir Änderungen anfangs kurz erklären.

## Schritt 3 — Claude Code „briefen"
Gib Claude Code als allererste Nachricht:
> „Lies `docs/02_ARCHITEKTUR.md`, `docs/03_MASTERPROMPT.md` und `docs/33_SICHERHEIT_DSGVO.md`. Wir bauen Phase 1. Bestätige kurz, dass du den Plan verstanden hast, dann starten wir mit Auftrag 0."

Dann arbeitest du die Aufträge aus `03_MASTERPROMPT.md` **einzeln** ab:
**Auftrag 0** (CLAUDE.md) → **A** (Setup) → **B** (Datenbank) → **C** (Design) → **D** (Explore) → **E** (Spot-Detail) → **F** (Sprachen) → **G** (Login/Saved) → **H** (Stripe/Pro) → **I** (Wetter/Öffnungszeiten) → **J** (Migration) → **K** (Deploy).

## Schritt 4 — Goldene Regeln beim Bauen
1. **Immer nur EINEN Auftrag** geben, dann den „✅ Test" machen, erst dann weiter.
2. Fehler? → Fehlermeldung kopieren + „bitte beheben" an Claude Code. Ganz normal.
3. Nach jedem Auftrag: **„commit bitte"**.
4. **Keys** in `.env.local` (lokal) + Vercel (online) — **nie** in den Code.
5. Unsicher? Frag Claude Code „erklär mir das einfach" — oder frag mich.

## Schritt 5 — Wann ist Phase 1 fertig?
Wenn `salzguide.com` live ist und man: Karte+Karussells nutzen, Spots ansehen, Sprache wechseln, einloggen, speichern und **Pro kaufen** kann (siehe „Definition of Done" in `03`).
→ Dann sag mir Bescheid, ich schreibe **Phase 2** (KI, Admin-Anlegen, Events).

---

### Allererster Schritt jetzt
👉 **Supabase-Projekt (EU) anlegen** und **Claude Code installieren.** Sobald das steht, gib Claude Code die Briefing-Nachricht aus Schritt 3. Los geht's. 💪
