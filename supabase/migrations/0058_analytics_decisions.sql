-- Analytics v4 (docs/34 §H): zwei Auswertungen, die es bisher nicht gab, weil das Dashboard
-- nach DATENQUELLEN gegliedert war und nicht nach den Fragen, die es beantworten soll.
--
-- 1. SEITENARTEN. `analytics_breakdown` kannte Quelle, Gerät, Sprache, Land und die
--    UTM-Felder, aber nicht `kind`. Die Frage „wohin geht die Aufmerksamkeit eigentlich"
--    war damit nicht zu stellen. Sie lohnt sich erst, seit `classifyPath` die Bereiche
--    wirklich trennt (bis 07/2026 lagen Touren, /pro, /ueber-uns und /support alle
--    zusammen in „other").
--
-- 2. AUFRUFE UND MERKUNGEN JE SPOT IN EINER ZEILE. Beides gab es schon, aber als zwei
--    getrennte Top-8-Listen. Die entscheidende Zahl steht jedoch NICHT in einer der
--    beiden Listen, sondern zwischen ihnen: Ein Spot mit 700 Aufrufen und 5 Merkungen
--    wird gefunden und überzeugt nicht (Bild? Text? fehlende Angaben?). Einer mit 90
--    Aufrufen und 40 Merkungen überzeugt und wird nicht gefunden. Das eine ist eine
--    Überarbeitung, das andere eine Verlinkung, und aus zwei nebeneinanderliegenden
--    Balkenlisten liest das niemand heraus.

-- ── 1. Seitenarten in die Whitelist ─────────────────────────────────────────
-- Gleiche Signatur wie 0020 -> CREATE OR REPLACE ersetzt sauber, es entsteht KEIN zweites
-- Overload (der Fehler aus 0020/0021, siehe dort).
create or replace function public.analytics_breakdown(
  p_column text, p_from timestamptz, p_to timestamptz, p_limit int,
  p_locale text default null, p_country text default null, p_device text default null,
  p_source text default null, p_campaign text default null
)
returns table(label text, cnt bigint)
language plpgsql stable as $$
begin
  if p_column not in ('source', 'device', 'locale', 'country', 'utm_source', 'utm_campaign', 'kind') then
    raise exception 'invalid column';
  end if;
  return query execute format(
    'select coalesce(%I, ''(unbekannt)'') as label, count(*)::bigint as cnt
       from public.analytics_events
      where created_at >= $1 and created_at < $2 and type = ''pageview''
        and ($5 is null or locale = $5) and ($6 is null or country = $6)
        and ($7 is null or device = $7) and ($8 is null or source = $8)
        and ($9 is null or utm_campaign = $9)
      group by 1 order by 2 desc limit $3',
    p_column
  ) using p_from, p_to, p_limit, p_column, p_locale, p_country, p_device, p_source, p_campaign;
end $$;

-- ── 2. Aufrufe UND Merkungen je Spot ────────────────────────────────────────
--
-- Sortiert nach Aufrufen, nicht nach der Merk-Quote: Eine Quote aus drei Aufrufen ist
-- Rauschen und stünde sonst ganz oben. Wer sie bewerten will, braucht erst genug Aufrufe;
-- die Reihenfolge liefert also die Kandidaten, die Quote die Einordnung.
--
-- Nur Spots MIT Aufrufen (having > 0): Ein Spot, der im Zeitraum nur gemerkt wurde (etwa
-- aus der Merkliste heraus), hat keine Quote, die etwas aussagen würde.
--
-- Quelle/Kampagne sind bewusst KEINE Parameter: Sie hängen nur an Seitenaufrufen, nie an
-- Merkungen. Ein Filter darauf würde die Merkungen-Spalte auf null zwingen und damit genau
-- die falsche Null erzeugen, die im Dashboard gerade abgeschafft wurde.
create or replace function public.analytics_spot_performance(
  p_from timestamptz, p_to timestamptz, p_limit int,
  p_locale text default null, p_country text default null, p_device text default null
)
returns table(target text, views bigint, saves bigint)
language sql stable as $$
  select target,
    count(*) filter (where type = 'pageview')::bigint as views,
    count(*) filter (where type = 'spot_save')::bigint as saves
  from public.analytics_events
  where created_at >= p_from and created_at < p_to
    and target is not null
    and (type = 'spot_save' or (type = 'pageview' and kind = 'spot'))
    and (p_locale is null or locale = p_locale)
    and (p_country is null or country = p_country)
    and (p_device is null or device = p_device)
  group by target
  having count(*) filter (where type = 'pageview') > 0
  order by 2 desc
  limit p_limit;
$$;

-- Nur der Service-Client (serverseitig, admin-geprüft) darf die RPC aufrufen.
revoke all on function public.analytics_spot_performance(timestamptz, timestamptz, int, text, text, text)
  from public, anon, authenticated;
