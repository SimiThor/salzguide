-- Einfache Key-Value-Einstellungen für die Seite (z.B. das Profilbild des KI-Chats
-- „Toni"). Öffentlich LESBAR (die Avatar-URL ist nicht sensibel und muss im Chat
-- für alle sichtbar sein); GESCHRIEBEN wird ausschließlich serverseitig über den
-- Service-Client (Admin-Action) -> kein Insert/Update-Policy. Erweiterbar für
-- weitere, unkritische Site-Einstellungen.
create table if not exists public.app_settings (
  key         text        primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Jeder darf lesen (anon + authenticated) -> der Chat-Avatar ist für alle sichtbar.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select using (true);

-- KEIN Insert/Update/Delete-Policy -> nur der Service-Client (service_role, bypasst
-- RLS) schreibt. So kann kein normaler Nutzer Einstellungen verändern.
