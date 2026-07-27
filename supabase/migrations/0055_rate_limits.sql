-- Ein allgemeiner Kurzzeit-Zähler für alles, was Geld oder Zustellbarkeit kostet.
--
-- WARUM ER JETZT GEBRAUCHT WIRD: Der Anmeldelink kam bisher von Supabase, und damit brachte
-- Supabase auch die Bremse mit (GoTrue lässt pro Adresse nur alle paar Sekunden eine Mail
-- raus). Seit die Anmelde-Mail von uns kommt (lib/login-link.ts), ist diese Bremse weg. Ohne
-- Ersatz könnte jemand mit einem gelösten Roboter-Check ein fremdes Postfach zuschütten und
-- nebenbei unser Resend-Kontingent verbrennen.
--
-- WARUM NICHT public.ai_burst MITBENUTZEN: Die Tabelle heisst nach ihrer einen Aufgabe und
-- steht seit 0018 im Betrieb. Ein Anmelde-Zähler in einer Tabelle namens „ai_burst" wäre
-- beim nächsten Aufräumen der erste Kandidat zum Löschen. Diese hier ist von Anfang an
-- allgemein und nimmt den nächsten Zähler ohne neue Migration auf.
--
-- Bauart 1:1 wie hit_ai_burst: Fixed Window, EINE Zeile pro Subjekt (in-place aktualisiert,
-- kein Zeilen-Flooding), atomar in einem Statement, serverless-tauglich (Zustand in Postgres).

create table if not exists public.rate_limits (
  subject       text        primary key,
  window_start  timestamptz not null default now(),
  count         integer     not null default 0
);

alter table public.rate_limits enable row level security;
-- Keine Policy -> nur der Service-Client (serverseitig) kommt ran.

-- Die Subjekte sind IMMER Hashes, nie Klartext (siehe lib/login-link.ts): In dieser Tabelle
-- stünde sonst eine Liste aller Adressen, die sich je anmelden wollten, samt Zeitpunkt.
comment on table public.rate_limits is
  'Kurzzeit-Zähler gegen Missbrauch. subject ist pseudonymisiert (SHA-256 + Server-Salt), nie eine Klartext-Adresse oder -IP.';

-- Rückgabe: true = erlaubt, false = über dem Limit. Fenster abgelaufen -> Reset auf 1.
-- Die ON-CONFLICT-Ausdrücke sehen konsistent die ALTE Zeile (window_start),
-- RETURNING sieht die NEUE count.
create or replace function public.hit_rate_limit(
  p_subject text,
  p_window_seconds integer,
  p_max integer
)
returns boolean
language plpgsql
as $$
declare
  allowed boolean;
begin
  insert into public.rate_limits (subject, window_start, count)
  values (p_subject, now(), 1)
  on conflict (subject) do update set
    window_start = case
      when now() - public.rate_limits.window_start >= make_interval(secs => p_window_seconds)
      then now() else public.rate_limits.window_start end,
    count = case
      when now() - public.rate_limits.window_start >= make_interval(secs => p_window_seconds)
      then 1 else public.rate_limits.count + 1 end
  returning count <= p_max into allowed;
  return allowed;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer)
  from public, anon, authenticated;
