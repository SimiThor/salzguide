-- ═══════════════════════════════════════════════════════════════════════════════════════
--  Das Betriebs-Logbuch: was schiefgeht, und wer daran rüttelt.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- WARUM ES DAS BRAUCHT. Bis hierher gab es genau einen Ort, an dem ein Fehler dieser App
-- landete: `console.error`. Hundert solcher Zeilen stehen im Code. In Produktion heisst das
-- Vercels Laufzeit-Log — es hält bei uns nur Stunden, niemand liest es freiwillig, und es
-- schickt niemandem eine Nachricht. Ein Kauf, der nicht freigeschaltet wird, ein Anmeldelink,
-- der nicht rausgeht, ein Aufräum-Cron, der seit Wochen nicht mehr läuft: alles Dinge, die
-- monatelang unbemerkt bleiben können. Genau das ist der Fehler, den das eigene Audit unter
-- OWASP A09 („Security Logging and Alerting Failures") notiert hat, und der Punkt
-- „Query-Pattern-Monitoring/Alerting" in docs/34 §G stand bis heute offen.
--
-- DREI TABELLEN, DREI AUFGABEN, bewusst getrennt:
--
--   ops_events      Das Logbuch. Jeder Vorfall eine Zeile, für die Admin-Ansicht und für
--                   das Nachvollziehen im Nachhinein („seit wann geht das schon?").
--   ops_alerts      Der Zustand der Alarmierung je Fingerabdruck. Sorgt dafür, dass aus
--                   tausend gleichen Fehlern EINE Mail wird und nicht tausend.
--   ops_heartbeats  Der Totmannschalter. Ein Cron, der NICHT läuft, erzeugt keinen Fehler —
--                   er erzeugt Stille. Stille kann man nur bemerken, wenn jemand mitschreibt,
--                   wann zuletzt etwas da war.
--
-- KEINE PERSONENBEZOGENEN DATEN. Diese Tabellen sind Betriebsdaten, kein zweites Analytics.
-- `subject` ist immer pseudonym (SHA-256 + Server-Salt) oder eine Admin-UUID; nie eine
-- Klartext-Adresse, nie eine Klartext-IP. Was in `message`/`detail` landet, läuft im Code
-- vorher durch einen Schwärzer (lib/ops-scrub.ts). Das ist keine Kür: Ein Fehler-Log ist die
-- Stelle, an der aus Versehen ein Token oder eine E-Mail landet, weil jemand „das ganze
-- Objekt" mitgeloggt hat.

-- ─────────────────────────────────────────────────────────────────────────────────────
--  1. Das Logbuch
-- ─────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.ops_events (
  id           uuid        primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- Wie schlimm. Bestimmt Farbe in der Ansicht und ob überhaupt gemailt wird.
  severity     text        not null check (severity in ('info', 'warn', 'error', 'critical')),

  -- Grobe Ecke der Plattform ('auth', 'payment', 'ai', 'admin', 'cron', 'mail', …).
  -- Zum Filtern in der Admin-Ansicht.
  area         text        not null,

  -- Die Art des Vorfalls, z. B. 'stripe_fulfillment_failed'. Der Schlüssel in den
  -- Katalog in lib/ops-events.ts — dort steht, was zu tun ist.
  kind         text        not null,

  -- Ein Satz auf Deutsch, gekürzt und geschwärzt. Was in der Liste steht.
  message      text        not null,

  -- Gruppierung. Gleicher Fehler an gleicher Stelle = gleicher Fingerabdruck, auch wenn
  -- die Uhrzeit oder eine ID darin abweicht. Ohne ihn wären 500 identische Fehler
  -- 500 Mails.
  fingerprint  text        not null,

  -- Wo es passiert ist ('/api/stripe/webhook'). Ohne Query-String (der trägt Tokens).
  path         text,

  -- WER, aber pseudonym: 'admin:<uuid>' bei Admin-Aktionen (das sind wir selbst), sonst
  -- ein Hash. Erlaubt „derselbe Absender wieder", ohne zu wissen, wer das ist.
  subject      text,

  -- Strukturierte Zusatzangaben (Statuscode, Zähler, gekürzter Stacktrace). Geschwärzt.
  detail       jsonb,

  -- Welcher Stand lief? Vercel setzt VERCEL_GIT_COMMIT_SHA. Beantwortet die erste Frage
  -- bei jedem neuen Fehler: „kam das mit dem letzten Deploy?"
  release      text
);

alter table public.ops_events enable row level security;
-- KEINE Policy, also Default-Deny: nur der Service-Client kommt heran, wie bei
-- rate_limits, api_cache und ai_usage. Gelesen wird ausschliesslich über die
-- Admin-Seite, die vorher requireAdmin() fragt. Zwei Schlösser bräuchte es hier nicht:
-- Die Tabelle ist für anon UND authenticated komplett zu, es gibt keinen App-Pfad, der
-- sie mit einem Session-Client anfasst.

comment on table public.ops_events is
  'Betriebs-Logbuch (Fehler, Missbrauch, Admin-Aktionen). Keine Klartext-IP, keine Klartext-Adresse: subject ist pseudonym, message/detail sind geschwärzt.';

-- Die Ansicht zeigt „das Neueste zuerst", oft eingeschränkt auf eine Schwere oder eine Art.
create index if not exists ops_events_created_idx on public.ops_events (created_at desc);
create index if not exists ops_events_severity_idx on public.ops_events (severity, created_at desc);
create index if not exists ops_events_kind_idx on public.ops_events (kind, created_at desc);
-- Für „wie oft kam dieser eine Fehler zuletzt?" in der Alarm-Mail.
create index if not exists ops_events_fingerprint_idx on public.ops_events (fingerprint, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────────────
--  2. Die Alarm-Bremse
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- ZWEI DINGE AUF EINMAL, und deshalb eine Tabelle statt zweier:
--
--   SCHWELLE  Manches ist erst als Muster interessant. Ein fehlgeschlagener Roboter-Check
--             ist Alltag; fünfzig in zehn Minuten sind ein Angriff. `p_threshold` sagt, ab
--             dem wievielten Vorfall im Fenster gemailt wird.
--   RUHE      Danach ist für den Rest des Fensters Ruhe. Genau EIN Alarm je Fingerabdruck
--             und Fenster, egal wie oft es noch knallt.
--
-- Die Alternative wäre gewesen, das im Code zu zählen. Geht nicht: Vercel startet für jede
-- Anfrage womöglich eine andere Instanz, ein Zähler im Arbeitsspeicher zählt dort jeweils
-- bei eins los. Der Zustand muss in die Datenbank, und die Erhöhung muss atomar sein, sonst
-- schicken zwei gleichzeitige Fehler zwei Mails (dieselbe TOCTOU-Falle wie beim KI-Limit,
-- docs/34 §G).
--
-- Bauart 1:1 wie hit_rate_limit (0055) und hit_ai_burst (0018): Fixed Window, EINE Zeile je
-- Fingerabdruck, in-place aktualisiert, alles in einem Statement.

create table if not exists public.ops_alerts (
  fingerprint   text        primary key,

  -- Beginn des laufenden Fensters.
  window_start  timestamptz not null default now(),

  -- Vorfälle im laufenden Fenster.
  seen          integer     not null default 0,

  -- Vorfälle im VORHERIGEN Fenster, beim Fensterwechsel herübergerettet. Nur dafür da,
  -- dass die nächste Mail sagen kann „und N weitere, über die nicht gemailt wurde".
  -- Ohne diese Spalte ginge die Zahl beim Zurücksetzen verloren: Die ON-CONFLICT-Ausdrücke
  -- sehen zwar noch die alte Zeile, RETURNING aber nur die neue.
  carried       integer     not null default 0,

  -- Vorfälle insgesamt, über alle Fenster. Beantwortet „ist das neu oder seit Monaten so?".
  total         integer     not null default 0,

  -- Hat der letzte Aufruf eine Mail ausgelöst? Als Spalte, damit RETURNING sie lesen kann.
  alerted       boolean     not null default false,

  last_sent_at  timestamptz
);

alter table public.ops_alerts enable row level security;
-- Keine Policy -> service-only.

comment on table public.ops_alerts is
  'Zustand der Alarm-Bremse je Fingerabdruck: Schwelle und Ruhefenster. Enthält keine Inhalte, nur Zähler.';

/**
 * Einen Alarm anmelden. Rückgabe: { alert, suppressed, total, seen }.
 *
 *   alert       true = JETZT mailen (genau einmal je Fenster, beim Erreichen der Schwelle).
 *   suppressed  Vorfälle im vorherigen Fenster, über die nicht gemailt wurde (für die Mail).
 *   total       Vorfälle insgesamt, seit es diesen Fingerabdruck gibt.
 *   seen        Vorfälle im laufenden Fenster (inklusive diesem).
 *
 * Die ON-CONFLICT-Ausdrücke sehen konsistent die ALTE Zeile, RETURNING die NEUE — dieselbe
 * Mechanik wie in hit_rate_limit. `alerted` wird deshalb als Spalte gesetzt statt als
 * Ausdruck berechnet: nur so kommt der Wert aus demselben atomaren Statement heraus.
 */
create or replace function public.claim_ops_alert(
  p_fingerprint text,
  p_window_seconds integer,
  p_threshold integer
)
returns jsonb
language plpgsql
as $$
declare
  v_alerted    boolean;
  v_carried    integer;
  v_total      integer;
  v_seen       integer;
begin
  insert into public.ops_alerts as a
    (fingerprint, window_start, seen, carried, total, alerted, last_sent_at)
  values
    -- Der allererste Vorfall: Fenster beginnt jetzt, seen = 1. Gemailt wird nur, wenn die
    -- Schwelle 1 ist (also „sofort melden"); bei höherer Schwelle wird erst gezählt.
    (p_fingerprint, now(), 1, 0, 1, p_threshold <= 1,
     case when p_threshold <= 1 then now() else null end)
  on conflict (fingerprint) do update set
    -- Fenster abgelaufen -> von vorn. Sonst weiterzählen.
    window_start = case
      when now() - a.window_start >= make_interval(secs => p_window_seconds)
      then now() else a.window_start end,
    seen = case
      when now() - a.window_start >= make_interval(secs => p_window_seconds)
      then 1 else a.seen + 1 end,
    -- Beim Fensterwechsel den alten Stand aufheben, sonst unverändert lassen.
    carried = case
      when now() - a.window_start >= make_interval(secs => p_window_seconds)
      then a.seen else a.carried end,
    total = a.total + 1,
    -- Genau beim Erreichen der Schwelle, und danach im selben Fenster nie wieder.
    alerted = case
      when now() - a.window_start >= make_interval(secs => p_window_seconds)
      then p_threshold <= 1
      else a.seen + 1 = p_threshold end,
    last_sent_at = case
      when now() - a.window_start >= make_interval(secs => p_window_seconds)
      then case when p_threshold <= 1 then now() else a.last_sent_at end
      when a.seen + 1 = p_threshold then now()
      else a.last_sent_at end
  -- UNQUALIFIZIERT, wie in hit_rate_limit: In RETURNING steht die NEUE Zeile. Ein `a.`
  -- davor wäre genau die Verwechslung, die in den SET-Ausdrücken oben die ALTE Zeile meint.
  returning alerted, carried, total, seen
  into v_alerted, v_carried, v_total, v_seen;

  return jsonb_build_object(
    'alert', v_alerted,
    -- Was im vorherigen Fenster über die eine Mail hinaus passiert ist.
    'suppressed', greatest(0, v_carried - greatest(1, p_threshold)),
    'total', v_total,
    'seen', v_seen
  );
end;
$$;

revoke all on function public.claim_ops_alert(text, integer, integer)
  from public, anon, authenticated;

/**
 * Ein reiner Zähler auf dem allgemeinen Kurzzeit-Speicher aus 0055.
 *
 * hit_rate_limit sagt nur ja/nein. Für Muster-Erkennung („wie viele Fehlversuche waren es
 * denn?") und für die globale Mail-Obergrenze braucht der Code die ZAHL. Bewusst dieselbe
 * Tabelle: 0055 wurde ausdrücklich allgemein gebaut, damit der nächste Zähler ohne neue
 * Tabelle hineinpasst. Zwei Zähler-Tabellen wären zwei Aufräum-Regeln und zwei Gelegenheiten,
 * eine davon zu vergessen.
 *
 * Rückgabe: der Stand im laufenden Fenster, nach dieser Erhöhung.
 */
create or replace function public.bump_ops_counter(
  p_subject text,
  p_window_seconds integer
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as r (subject, window_start, count)
  values (p_subject, now(), 1)
  on conflict (subject) do update set
    window_start = case
      when now() - r.window_start >= make_interval(secs => p_window_seconds)
      then now() else r.window_start end,
    count = case
      when now() - r.window_start >= make_interval(secs => p_window_seconds)
      then 1 else r.count + 1 end
  returning count into v_count;
  return v_count;
end;
$$;

revoke all on function public.bump_ops_counter(text, integer)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
--  3. Der Totmannschalter
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- Der gefährlichste Ausfall ist der, der keinen Fehler wirft. Bleibt der tägliche
-- Aufräum-Cron aus (Vercel-Cron abgeschaltet, Secret rotiert, Plan-Grenze erreicht), dann
-- passiert: nichts. Keine Ausnahme, kein roter Eintrag, keine Mail. Nur die Löschfristen
-- aus der Datenschutzerklärung laufen still ab — dieselbe Art Fehler, die schon einmal
-- monatelang unbemerkt lief (siehe .env.local.example zu NEXT_PUBLIC_SITE_URL).
--
-- Jeder Job schreibt hier bei jedem Lauf einen Zeitstempel. Der tägliche Cron prüft
-- anschliessend ALLE Einträge und schlägt Alarm, wenn einer überfällig ist. Der Wächter
-- ist damit selbst der tägliche Cron — fällt der aus, meldet ihn niemand. Deshalb prüft der
-- Code zusätzlich beim Blick auf die Admin-Seite (lib/ops-heartbeat.ts).

create table if not exists public.ops_heartbeats (
  job          text        primary key,
  -- Wann zuletzt gelaufen, egal mit welchem Ergebnis.
  last_run_at  timestamptz not null default now(),
  -- Wann zuletzt ERFOLGREICH gelaufen. Ein Job, der täglich läuft und täglich scheitert,
  -- sieht ohne diese Trennung gesund aus.
  last_ok_at   timestamptz,
  ok           boolean     not null default true,
  -- Was der Lauf gemacht hat (gelöschte Zeilen o. ä.). Nur Zahlen, keine Inhalte.
  detail       jsonb
);

alter table public.ops_heartbeats enable row level security;
-- Keine Policy -> service-only.

comment on table public.ops_heartbeats is
  'Letzter Lauf je Hintergrund-Job. Grundlage für den Totmannschalter: ein Job, der ausbleibt, wirft keinen Fehler.';

-- ─────────────────────────────────────────────────────────────────────────────────────
--  4. Aufräumen
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- Die Aufbewahrung steht im Code (lib/data-retention.ts), damit alle Fristen an EINER
-- Stelle stehen. Hier nur die Indizes, die das Löschen billig machen — ops_events wird nach
-- created_at beschnitten, ops_alerts nach window_start (ein Fingerabdruck, der seit Monaten
-- ruhig ist, braucht keine Zeile mehr).
create index if not exists ops_alerts_window_idx on public.ops_alerts (window_start);
