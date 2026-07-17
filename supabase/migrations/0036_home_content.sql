-- Texte und Medien der Startseite („/"), pflegbar im Admin statt im Code.
--
-- WARUM: Bis hierher lagen die Texte in messages/de.json und die Bilder in einer
-- TypeScript-Datei. Jede Änderung an der meistbesuchten Seite brauchte also einen
-- Entwickler und ein Deployment. Eine Startseite, für die man jemanden fragen muss, wird
-- nicht gepflegt.
--
-- WARUM EINE ZEILE UND NICHT app_settings: app_settings ist Key-Value über `text`. Die
-- Startseite braucht drei zusammenhängende JSONB-Blöcke plus eine Versionsmarke, und die
-- müssen ZUSAMMEN geschrieben werden: Texte und ihr source_hash dürfen nie auseinander-
-- laufen, sonst gelten Übersetzungen als aktuell, die es nicht sind.
--
-- WARUM NICHT ÜBER next-intl: Die Texte könnten in messages/* gemerged werden, dann müsste
-- aber i18n/request.ts bei JEDEM Seitenaufruf der ganzen App in die DB schauen, wegen einer
-- Seite, die sich selten ändert. Stattdessen liest die Startseite selbst und reicht die
-- Texte als Props durch (siehe src/lib/home-content.ts). Der Umbau bleibt damit auf die
-- Startseite beschränkt.
create table if not exists public.home_content (
  -- Genau EINE Zeile. Der Check macht eine zweite unmöglich, statt sich darauf zu
  -- verlassen, dass niemand eine anlegt.
  id           smallint    primary key default 1 check (id = 1),

  -- Deutsche Quelle: { "heroTitle": "…", "heroSubtitle": "…" }. Welche Keys, steht in
  -- src/lib/home-fields.ts (HOME_KEYS) — nicht hier, damit es EINE Quelle bleibt.
  texts        jsonb       not null default '{}'::jsonb,

  -- Übersetzungen: { "en": { "heroTitle": "…" }, "it": { … } }. Ein Objekt pro Sprache,
  -- wie bei den Events (spots nutzen dagegen eigene Zeilen).
  translations jsonb       not null default '{}'::jsonb,

  -- Hash von `texts` zum Zeitpunkt der Übersetzung. Weicht er vom aktuellen Hash ab, sind
  -- die Übersetzungen veraltet und der Admin zeigt das an. Gleiche Mechanik wie
  -- spots.source_hash und events.source_hash (siehe src/lib/spot-hash.ts).
  source_hash  text,

  -- Bilder und Videos: { "heroPortrait": { "src": "…", "alt": "…", "width": …, … } }.
  -- Sprach-unabhängig, deshalb NICHT in translations.
  media        jsonb       not null default '{}'::jsonb,

  updated_at   timestamptz not null default now()
);

comment on table public.home_content is
  'Texte + Medien der Startseite, eine Zeile. Keys: src/lib/home-fields.ts. Lesen: src/lib/home-content.ts.';

alter table public.home_content enable row level security;

-- Jeder darf lesen: Die Startseite ist öffentlich, und der Inhalt ist genau das, was ohnehin
-- jeder Besucher sieht. Nichts hiervon ist sensibel.
drop policy if exists home_content_public_read on public.home_content;
create policy home_content_public_read on public.home_content
  for select using (true);

-- KEIN Insert/Update/Delete-Policy -> nur der Service-Client (service_role, bypasst RLS)
-- schreibt, und der läuft ausschliesslich in der Admin-Action hinter dem Rollen-Guard.
-- Gleiches Muster wie app_settings (Migration 0023).

-- Die eine Zeile anlegen, damit die Lese-Schicht sie nie vermissen muss. Leer ist in
-- Ordnung: Solange `texts` leer ist, fällt die Startseite auf messages/de.json zurück
-- (siehe home-content.ts). Es geht also nichts kaputt, bevor jemand etwas eingetragen hat.
insert into public.home_content (id) values (1) on conflict (id) do nothing;
