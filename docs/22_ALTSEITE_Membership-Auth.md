# Alt-Analyse #12 — Membership / Kauf / Auth (aktueller Stand)

Quelle: Antons Beschreibung. Stand: 2026-06-21.

---

## 1. Aktueller Flow
- **WordPress-Plugin „WP Membership"** + **Stripe-Kauf-Button**.
- User klickt Kauf-Button → **Weiterleitung zu Stripe** (Checkout) → Zahlung (**19,90 € Einmalzahlung**).
- Nach Kauf: **E-Mail mit Link zum Passwort-Festlegen** → Account wird passwortbasiert aktiviert.
- Login danach klassisch (Passwort), Login-Seite `/membership-login/`.
- Pro-Status steuert Freischaltung (eingeloggt = `body.logged-in` → Pro-Spots sichtbar, KI-Limit hoch).

## 2. Schwachstellen / Gründe für Neubau
- Pro-Gating clientseitig (siehe Doc 10) — unsicher.
- Account erst nach Kauf; kein „Free-Account" zum Testen/Speichern. Antons Briefing will aber: **Free-User mit Account** (Spots speichern, KI testen) → höhere Conversion.
- Passwort-Reset-Flow ist Reibung (gerade für Tourismus-Zielgruppe).

## 3. Empfehlung Neubau — Auth
**Magic-Link (E-Mail) als primäre Methode** (Supabase Auth). Begründung:
- Keine Passwörter → keine „Passwort vergessen"-Reibung, ideal für Gelegenheits-/Tourismus-User.
- **Migration trivial:** bestehende ~100 Pro-User nur per **E-Mail + Pro-Status** importieren — **kein** Passwort-Transfer/Reset nötig. Beim ersten Login bekommen sie einen Magic-Link, fertig.
- Optional zusätzlich **Social-Login** (Apple/Google) für 1-Tap auf Mobile (passt zum iOS-Look).
- Passwort als Option später nachrüstbar, aber nicht nötig.

## 4. Empfehlung Neubau — Kauf
- **Stripe Checkout** (gehosted) beibehalten — bewährt, PCI-sicher.
- **Wichtige Änderung:** Erst **Account (Free) anlegen** (Magic-Link), Kauf passiert **eingeloggt** → Stripe-`customer` direkt mit User verknüpft, **kein** separater „Passwort-Mail nach Kauf"-Schritt mehr. Pro-Status wird per **Stripe-Webhook** serverseitig gesetzt (sicher, sofort).
- Einmalzahlung 19,90 € bleibt; **Abo-/Stufen-Optionen** im Monetarisierungs-Konzept (Architektur) ausarbeiten.

## 5. Migration der ~100 Pro-User (Konzept)
1. **Export** aus WordPress/WP-Membership: E-Mail + Kauf-/Pro-Status (+ ggf. Stripe-Customer-ID, Kaufdatum).
2. **Import** in Supabase: `users` (E-Mail) + `entitlements` (Pro=lifetime, `source='migration'`).
3. Bestehende **Stripe-Customer** möglichst per E-Mail matchen/verknüpfen (für Rechnungs-Historie).
4. **Ankündigungs-Mail** an alle: „neue App unter salzguide.com, einfach mit deiner E-Mail per Link einloggen — dein Pro-Zugang ist schon da." → **Null-Reibung**, kein Passwort.
5. Alte Seite → Landingpage mit Weiterleitung (Briefing).

→ Magic-Link macht die Migration am saubersten/schnellsten (Antons Ziel: „robust, schnell, sauber, unkompliziert").

## ✅ Entscheidung (2026-06-21, Anton)
- **Auth = Magic-Link** (Supabase) als primäre Methode bestätigt. (Social-Login optional, Passwort nicht nötig.)

## 6. Offene Punkte → in Architektur/Monetarisierung
- [ ] Abo zusätzlich/statt Einmalzahlung? Mehrere Stufen? (Konzept folgt)
- [ ] Free-Account-Umfang (was Free-User ohne Kauf können: speichern, X KI-Anfragen/Tag, ~20–30 Spots).
- [ ] Genaue Migrations-Felder (hängt vom WP-Export ab) — Beispiel-Export von Anton hilfreich.
