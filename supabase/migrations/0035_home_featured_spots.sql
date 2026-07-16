-- Ausgewählte Spots für die Startseite („/"). Der Admin wählt in den Einstellungen ein
-- paar Plätze, die dort mit Foto gezeigt werden — statt einer Seite über schöne Orte,
-- auf der kein einziger Ort zu sehen ist.
--
-- WARUM EINE SPALTE AN spots UND KEINE SLUG-LISTE IN app_settings:
-- Die Spots werden noch gelöscht und neu angelegt (Migration der 76 von der Altseite).
-- Eine Liste von Slugs in app_settings würde danach auf Karteileichen zeigen, und die
-- Startseite zeigte still weniger Spots, ohne dass es jemandem auffällt. Eine Spalte
-- stirbt mit ihrer Zeile — das Problem kann gar nicht entstehen.
--
-- NULL = nicht auf der Startseite. 1, 2, 3 … = Reihenfolge dort.
alter table public.spots
  add column if not exists home_rank smallint;

comment on column public.spots.home_rank is
  'Position auf der Startseite (1 = erste). NULL = nicht gefeatured. Nur für is_pro = false.';

-- Nur die gefeaturedten Zeilen indizieren — es sind eine Handvoll von vielen.
create index if not exists spots_home_rank_idx
  on public.spots (home_rank)
  where home_rank is not null;

-- 🔒 Pro-Spots dürfen NIE auf der Startseite landen. Ihre Fotos verlassen den Server
-- grundsätzlich nicht (nur die Blur-Vorschau), ihre Titel werden geschwärzt — ein
-- gefeaturedter Pro-Spot wäre also entweder ein Leak oder eine leere Karte.
--
-- Das ist die DRITTE Verteidigungslinie. Die Startseiten-Abfrage filtert bereits auf
-- is_pro = false, und die Admin-Oberfläche bietet nur freie Spots an. Diese hier greift
-- für den Fall, den die anderen beiden nicht sehen: ein Spot wird gefeatured und SPÄTER
-- auf Pro gestellt. Dann räumt der Trigger die Auszeichnung selbst weg, statt sie als
-- stille Zeitbombe liegen zu lassen.
create or replace function public.clear_home_rank_on_pro()
returns trigger
language plpgsql
as $$
begin
  if new.is_pro and new.home_rank is not null then
    new.home_rank := null;
  end if;
  return new;
end;
$$;

drop trigger if exists spots_clear_home_rank_on_pro on public.spots;
create trigger spots_clear_home_rank_on_pro
  before insert or update on public.spots
  for each row
  execute function public.clear_home_rank_on_pro();

-- Bestehende Daten aufräumen, falls jemand vor dem Trigger etwas gesetzt hat.
update public.spots set home_rank = null where is_pro and home_rank is not null;
