-- Unsere neuesten Instagram-Beiträge auf der eigenen Seite, ohne Meta im Browser.
--
-- WARUM ZWEI TABELLEN UND NICHT app_settings:
-- `social_posts` ist eine Liste mit Massen und Reihenfolge, `social_accounts` trägt ein
-- ECHTES GEHEIMNIS (den Zugangs-Token). app_settings ist öffentlich lesbar (Migration 0023,
-- die Startseite und der Toni-Avatar lesen daraus) — ein Token dort wäre für jeden Besucher
-- mit dem anon-Key abrufbar. Deshalb liegt er in einer eigenen Tabelle, die GAR KEINE
-- Lese-Policy hat: dort kommt ausschliesslich der Service-Client hin.
--
-- WARUM DIE BILDER NICHT VON INSTAGRAM KOMMEN (der ganze Punkt dieser Migration):
-- Ein Instagram-Embed oder ein fremdes Widget lädt Meta-Skripte in den Browser des
-- Besuchers, setzt Cookies und braucht damit eine Einwilligung samt Banner (§ 165 Abs. 3
-- TKG). Wir holen die Beiträge stattdessen serverseitig, rechnen die Bilder auf unser
-- Format und legen sie in unseren eigenen Bucket. Für den Browser ist ein
-- Instagram-Beitrag danach ein Bild wie jedes Spot-Foto: kein fremder Host, kein Cookie,
-- kein Banner. Steht so auch in der Datenschutzerklärung (Punkt 3m) — wer hier auf ein
-- Embed umbaut, macht diese Aussage zu einer Falschangabe.
--
-- AUFBEWAHRUNG: Es liegen immer nur die Beiträge, die gerade angezeigt werden. Was aus dem
-- Feed verschwindet (gelöscht, archiviert, nachgerückt), verschwindet beim nächsten Abgleich
-- auch hier samt Datei. Das ist die Auskunftspflicht aus den Meta-Plattformbedingungen
-- („Daten aktuell halten") und gleichzeitig Datensparsamkeit.

create table if not exists public.social_posts (
  -- Die Instagram-Media-ID. Als Primärschlüssel, damit ein zweiter Abgleich denselben
  -- Beitrag ERKENNT und nicht ein zweites Mal spiegelt (sonst läge nach einer Woche
  -- siebenmal dasselbe Bild im Bucket).
  id          text        primary key,

  -- Ziel beim Antippen: der Beitrag auf instagram.com.
  permalink   text        not null,

  -- UNSERE Kopie im Bucket `spot-media` (Unterordner social/). Niemals eine
  -- Instagram-URL: die sind signiert und laufen nach Stunden ab, die Kacheln wären dann
  -- leer. Ausserdem wäre es wieder ein fremder Host im Browser.
  image_url   text        not null,

  -- Masse der Kopie. Ohne sie müsste next/image raten und das Layout springt beim Laden.
  width       integer     not null check (width  > 0),
  height      integer     not null check (height > 0),

  -- Reel/Video? Dann liegt oben das Standbild (thumbnail_url) und die Kachel bekommt ein
  -- Play-Zeichen. Videos selbst spiegeln wir NICHT: viele Megabyte für eine Kachel, die
  -- ohnehin nach Instagram führt.
  is_video    boolean     not null default false,

  -- Nur für Screenreader und als Ersatztext, wenn ein Bild nicht lädt. Wird NICHT
  -- angezeigt: Die Section zeigt Bilder, keine Bildtexte (siehe SocialSection.tsx).
  caption     text,

  -- Wann der Beitrag auf Instagram veröffentlicht wurde.
  taken_at    timestamptz not null,

  -- Reihenfolge im Feed, 0 = neuester. Eigene Spalte statt „order by taken_at":
  -- Instagram liefert die Reihenfolge, und die muss nicht der Zeit folgen (angepinnte
  -- Beiträge stehen vorn).
  position    integer     not null,

  -- Wann WIR die Kopie angelegt haben (fürs Aufräumen und die Fehlersuche).
  created_at  timestamptz not null default now()
);

comment on table public.social_posts is
  'Gespiegelte Instagram-Beiträge für die Startseite/Über-uns. Schreiben: src/lib/social-sync.ts '
  '(nur Service-Client, Cron/Admin). Lesen: src/lib/social-feed.ts.';

create index if not exists social_posts_position_idx on public.social_posts (position);

alter table public.social_posts enable row level security;

-- Jeder darf lesen: Das sind unsere öffentlichen Instagram-Beiträge. Öffentlicher geht es
-- nicht. Kein Insert/Update/Delete-Policy -> nur der Service-Client schreibt, gleiches
-- Muster wie home_content (0036) und app_settings (0023).
drop policy if exists social_posts_public_read on public.social_posts;
create policy social_posts_public_read on public.social_posts
  for select using (true);

-- ── Zugangsdaten + Zustand des Abgleichs ────────────────────────────────────────────────
create table if not exists public.social_accounts (
  -- 'instagram' heute. Eine Zeile pro Plattform, damit TikTok später nichts umbauen muss.
  provider           text        primary key,

  -- GEHEIM. Long-lived Token von Meta, gilt 60 Tage und wird beim Abgleich erneuert, lange
  -- bevor er abläuft (siehe social-sync.ts). Deshalb steht er in der DB und nicht nur in
  -- der ENV: Eine Umgebungsvariable kann sich zur Laufzeit nicht selbst erneuern.
  access_token       text        not null,

  -- Wann der Token abläuft. Der Abgleich erneuert ihn ab 30 Tagen Restlaufzeit; der Admin
  -- zeigt das Datum, damit ein stehengebliebener Cron auffällt, BEVOR der Token stirbt.
  token_expires_at   timestamptz,

  -- Zustand des letzten Laufs, nur für die Anzeige im Admin.
  last_sync_at       timestamptz,
  last_error         text,
  updated_at         timestamptz not null default now()
);

comment on table public.social_accounts is
  'ENTHÄLT EIN GEHEIMNIS (access_token). Nur Service-Client, niemals im Browser, niemals in '
  'einer Server-Komponente ohne Admin-Guard. Der Admin liest ausschliesslich '
  'token_expires_at/last_sync_at/last_error (siehe getSocialStatus in src/lib/social-feed.ts).';

alter table public.social_accounts enable row level security;

-- ABSICHTLICH KEINE EINZIGE POLICY: Damit ist die Tabelle für anon UND für angemeldete
-- Nutzer vollständig unsichtbar (RLS ohne Policy verweigert alles). Nur der Service-Client
-- (service_role, bypasst RLS) kommt hinein, und der läuft ausschliesslich im Cron hinter
-- CRON_SECRET und in der Admin-Action hinter dem Rollen-Guard.
