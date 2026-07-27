# 36 — Betrieb: Alarme & Logbuch

Wie die Plattform sich meldet, wenn etwas kaputt ist oder jemand daran rüttelt.
**Stand: Juli 2026.** Schliesst den offenen Punkt aus `34_SICHERHEIT_AUDIT.md` §G
(„Query-Pattern-Monitoring/Alerting = organisatorisch (empfohlen)") und §D („Log-Hygiene").

---

## Warum überhaupt

Vor diesem Umbau gab es genau einen Ort, an dem ein Fehler landete: `console.error`.
Hundert solcher Zeilen stehen im Code. In Produktion heisst das Vercels Laufzeit-Log, und das
hat drei Löcher:

1. **Niemand wird benachrichtigt.** Ein Kauf, der nicht freigeschaltet wird, ist eine graue
   Zeile in einem Log, das niemand offen hat.
2. **Es ist nach Stunden weg.** „Seit wann geht das schon?" lässt sich nicht beantworten.
3. **Es gibt kein Muster.** Fünfzig fehlgeschlagene Anmeldungen sehen aus wie fünfzig
   einzelne Zeilen, nicht wie ein Angriff.

Das ist exakt **OWASP A09:2025 — Security Logging and Alerting Failures**. Die Recherche dazu
(OWASP Logging Cheat Sheet, A09:2025) nennt als Pflichtprogramm: den vollen Auth-Lebenszyklus
mitschreiben, Admin-Aktionen mitschreiben, auf Häufungen alarmieren, keine Zugangsdaten oder
PII ins Log, und für ein Produkt mit Bezahlung ausdrücklich **Billing- und Auth-Alarme vor dem
Start** einrichten.

---

## Die Bauteile

| Datei | Aufgabe |
| --- | --- |
| `supabase/migrations/0056_ops_log.sql` | `ops_events` (Logbuch), `ops_alerts` (Bremse), `ops_heartbeats` (Totmannschalter) + `claim_ops_alert` / `bump_ops_counter` |
| `src/lib/ops-events.ts` | **Der Katalog.** Jede Ereignis-Art mit Stufe, Schwelle, Ruhefenster, Überschrift und Handlungshinweis. Kein `server-only` (die Admin-Ansicht liest ihn im Browser). |
| `src/lib/ops-scrub.ts` | Der Schwärzer. Reine Funktionen, keine Datenbank. |
| `src/lib/ops.ts` | `logOps()`, `logAdminAction()`, Heartbeats, Totmannschalter. |
| `src/lib/ops-mail.ts` | Die Alarm-Mail und die globale Stundengrenze. |
| `src/lib/ops-read.ts` | Lesen für die Admin-Seite (prüft selbst die Admin-Rolle). |
| `src/lib/ops-client.ts` | Melden aus dem Browser. Kein Import aus `ops.ts` (server-only!). |
| `instrumentation.ts` | `onRequestError` — jeder unbehandelte Serverfehler. |
| `src/lib/cron-guard.ts` | Ein Wächter für beide Cron-Routen, inkl. Lebenszeichen. |
| `/admin/settings/system` | Das Logbuch zum Anschauen, Job-Zustand, Test-Knopf. |

---

## Die vier Stufen

| Stufe | Wann | Mail? |
| --- | --- | --- |
| `info` | Nachschlagewerk (Admin-Aktionen, geblockte Bots) | nie |
| `warn` | Auffällig, aber allein kein Grund aufzustehen | erst ab einer Schwelle |
| `error` | Etwas hat nicht funktioniert | ja, gedrosselt |
| `critical` | Geld, Zugang oder Rechtsfrist betroffen | sofort |

Die Zuordnung folgt EINER Frage: **Kostet es Geld, sperrt es jemanden aus, oder bricht es eine
Zusage aus der Datenschutzerklärung?** Wenn ja, ist es `critical`.

---

## Was sofort eine Mail auslöst (`critical`, Schwelle 1)

- **`stripe_fulfillment_failed`** — bezahlt, aber Pro nicht freigeschaltet. Der teuerste
  Fehler, den diese App machen kann.
- **`stripe_webhook_failed`**, **`stripe_not_configured`** — die Zahlungskette hakt.
- **`login_mail_failed`** — weder eigener Versand noch Supabase bekommen den Anmeldelink raus.
  Ohne Google kommt dann NIEMAND mehr in sein Konto.
- **`admin_forbidden`** — ein angemeldeter Nutzer ohne Admin-Rolle hat eine mutierende
  Server-Action aufgerufen. Durch Klicken unmöglich; wer hier auftaucht, hat den POST-Endpunkt
  von Hand angesprochen.
- **`retention_failed`**, **`cron_missing`** — die Löschfristen der Datenschutzerklärung.
- **`db_unreachable`**, **`config_missing`**.

## Was erst als Muster meldet (Schwelle > 1)

`login_rate_limited` (20), `auth_callback_failed` (5), `admin_page_denied` (10),
`turnstile_failed` (50), `stripe_bad_signature` (5), `ai_ip_cap_hit` (10),
`suspicious_request` (30), `client_error` (10), `server_error` (2), `abuse_blocked` (100).

Die Zahlen sind bewusst grosszügig. Ein Alarm, der oft grundlos kommt, wird weggeklickt —
und zwar genau dann, wenn er einmal stimmt.

---

## Drei Bremsen gegen die Alarmflut

Alarmflut ist kein Schönheitsfehler, sondern ein Ausfall: Sie verbrennt dasselbe
Resend-Kontingent, aus dem der Anmeldelink kommt.

1. **Fingerabdruck.** Zahlen und UUIDs fliegen aus der Meldung, bevor gehasht wird. „Spot 41
   nicht gefunden" und „Spot 82 nicht gefunden" sind derselbe Vorfall.
2. **Ruhefenster je Fingerabdruck.** Genau EIN Alarm pro Fenster, egal wie oft es knallt. Die
   nächste Mail meldet nach, was dazwischen war („und N weitere").
3. **Globale Stundengrenze: 12 Mails/Stunde.** Der Notausgang für den schlimmsten Fall — ein
   Deploy, der alles gleichzeitig kaputtmacht, erzeugt Fehler mit einem Dutzend verschiedener
   Fingerabdrücke, die Ruhefenster greifen dann NICHT.

Dazu ein vierter Riegel für die Datenbank selbst: **höchstens 20 Zeilen je Fingerabdruck und
Fenster** (`ROWS_PER_WINDOW`). Gezählt wird weiter, geschrieben nicht — sonst füllt ein Bot
das Logbuch, und ein volllaufendes Logbuch ist selbst ein Ausfall.

---

## Datenschutz

Diese Tabellen sind **Betriebsdaten, kein zweites Analytics**. Es kommt kein neuer
Auftragsverarbeiter dazu (Resend und Supabase sind bereits gelistet), und es geht keine Mail
an Nutzer — nur an uns.

- **Keine Klartext-IP, keine Klartext-Adresse.** `subject` ist immer ein SHA-256-Hash mit
  Server-Salt (dasselbe Muster wie `login-link.ts` und `api/track`) oder eine Admin-UUID.
- **`ops-scrub.ts` schwärzt** JWTs, Stripe-/Resend-/Anthropic-Schlüssel, `Authorization`-Köpfe,
  `token_hash`/`code`/`secret`-Parameter, E-Mail-Adressen und IP-Adressen — in Meldung,
  Zusatzangaben und Stacktrace.
- **Query-Strings werden abgeschnitten, nicht geschwärzt.** Dort stehen die Anmelde-Tokens.
  Gar nicht erst aufnehmen ist besser als hinterher entfernen.
- **Aufbewahrung 90 Tage** (`RETENTION_DAYS.opsEvents`), Bremszustand 30 Tage. Der tägliche
  Cron räumt beides mit auf.
- **RLS:** beide Tabellen ohne Policy → Default-Deny, nur der Service-Client kommt heran. Die
  Admin-Seite liest über `ops-read.ts`, das selbst `getAdminUserId()` prüft.

---

## Bewusste Entscheidungen (und was dagegen sprach)

**Mail statt Sentry/Slack/Dashboard.** Ein externer Dienst wäre mächtiger, kostet aber einen
neuen Auftragsverarbeiter (DSGVO: AVV, Eintrag in die Datenschutzerklärung, Drittland-Frage),
Geld und Einrichtung. Mail läuft bereits, kommt auf jedem Gerät an und braucht kein Konto. Ein
Dashboard allein nützt nur dem, der hineinschaut — und die Fehler, um die es hier geht, sind
genau die, bei denen niemand hineinschaut.

**Keine 404-Scanner-Erkennung.** Naheliegend (`/wp-login.php`, `/.env`, `/.git/config`), aber
zweimal falsch: Das bekommt jede Seite im Netz rund um die Uhr, sagt also nichts. Und diese
Pfade tragen einen Punkt und fallen deshalb aus dem Middleware-Matcher — sie einzufangen
hiesse, eine zweite Meldekette in der Edge-Laufzeit zu bauen, wo es weder `node:crypto` noch
den Service-Client gibt. Stattdessen meldet `suspicious_request` das, was wir ohnehin prüfen
und was wirklich Absicht verrät: **POST auf unsere Schreib-Endpunkte mit fremdem `Origin`**
(`/api/track`, `/api/ai/chat`, `/api/ops/client-error`).

**Admin-Spur nur für das Unumkehrbare.** Rechte-Änderungen (`setUserPro`), Löschungen
(`deleteSpot`), Massen-Mails (`sendMigrationAnnouncement`). Jedes gespeicherte Spot-Textfeld
mitzuschreiben würde die Spur unbrauchbar machen: Man findet die eine wichtige Zeile nicht
zwischen tausend belanglosen.

**Kein Melden in der Entwicklung.** Es gibt EIN Supabase-Projekt. Ein lokaler Fehlversuch
würde als „Kritisch" neben den echten stehen. `OPS_LOCAL=1` hebt das auf, der Test-Knopf im
Admin umgeht es ausdrücklich.

---

## Inbetriebnahme

- [ ] **`0056_ops_log.sql` in Supabase einspielen.** Bis dahin läuft alles unverändert
      weiter — ohne die Tabellen schreibt `logOps()` nur auf die Konsole und wirft nicht.
- [ ] **`OPS_ALERT_EMAIL`** in Vercel setzen (optional; ohne sie geht es an die
      Impressums-Adresse).
- [ ] **Test-Knopf drücken:** `/admin/settings/system` → „Testalarm schicken". Beweist die
      ganze Kette bis ins Postfach. Nach jeder Änderung an den Mail-Einstellungen wiederholen.
- [ ] **Nach 24 h prüfen,** ob unter „Hintergrund-Läufe" beide Jobs auf „läuft" stehen. Vorher
      steht dort „noch nie gelaufen" — das ist richtig so und löst bewusst keinen Alarm aus.

---

## Offen (bewusst)

- **Ein zweiter, unabhängiger Wächter.** Der Totmannschalter läuft IN dieser App. Fällt Vercel
  komplett aus oder ist das Projekt pausiert, meldet sich niemand — es läuft ja nichts mehr,
  das melden könnte. Vollständig wäre nur ein externer Uptime-Dienst, der von aussen anklopft
  (z. B. eine kostenlose Prüfung alle fünf Minuten auf die Startseite). Empfohlen vor dem
  öffentlichen Start, gehört zu den Punkten in `vor-public-start`.
- **Log-Drain.** Die Konsolenzeilen haben eine feste Form (`[ops] <stufe> <ecke>/<art> …`),
  damit ein späterer Drain sie greifen kann, ohne dass heute einer gebraucht wird.
- **`ops_events` als Aggregat.** Die Zusammenfassung zählt heute im Code über die letzten
  Zeilen. Wenn die Seite je langsam wird, ist das der Moment für eine RPC — vorher wäre es
  Vorratsarbeit.
