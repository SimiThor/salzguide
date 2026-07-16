-- Burst-Rate-Limit für den KI-Endpunkt (docs/34 §C4): ergänzt die Tages-/IP-Caps
-- um einen Kurzzeit-Schutz (z.B. 6 Anfragen/Minute pro Subjekt) gegen schnelles
-- Hämmern/Concurrency – auch für Pro (die haben unbegrenztes Tages-, aber kein
-- unbegrenztes Sekunden-Kontingent). Serverless-tauglich (Zustand in Postgres),
-- EINE Zeile pro Subjekt (in-place aktualisiert -> kein Zeilen-Flooding).

create table if not exists public.ai_burst (
  subject       text        primary key,
  window_start  timestamptz not null default now(),
  count         integer     not null default 0
);

alter table public.ai_burst enable row level security;
-- Keine Policy -> nur der Service-Client (serverseitig) kommt ran.

-- Fixed-Window-Zähler, atomar in einem Statement. Rückgabe: true = erlaubt,
-- false = über dem Limit. Fenster abgelaufen -> Reset auf 1; sonst +1.
-- Die ON-CONFLICT-Ausdrücke sehen konsistent die ALTE Zeile (window_start),
-- RETURNING sieht die NEUE count.
create or replace function public.hit_ai_burst(
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
  insert into public.ai_burst (subject, window_start, count)
  values (p_subject, now(), 1)
  on conflict (subject) do update set
    window_start = case
      when now() - public.ai_burst.window_start >= make_interval(secs => p_window_seconds)
      then now() else public.ai_burst.window_start end,
    count = case
      when now() - public.ai_burst.window_start >= make_interval(secs => p_window_seconds)
      then 1 else public.ai_burst.count + 1 end
  returning count <= p_max into allowed;
  return allowed;
end;
$$;

revoke all on function public.hit_ai_burst(text, integer, integer)
  from public, anon, authenticated;
