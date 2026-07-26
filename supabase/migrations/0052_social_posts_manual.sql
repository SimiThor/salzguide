-- Instagram-Kacheln von Hand pflegen, statt sie bei Meta abzuholen.
--
-- WARUM DER RÜCKBAU: Migration 0051 hat den automatischen Weg gebaut (Meta-App, Token,
-- nächtlicher Abgleich, Bilder spiegeln). Er funktionierte, aber der Einstieg liegt bei
-- Meta: App anlegen, Anwendungsfall wählen, Konto verbinden, Token erzeugen, alle 60 Tage
-- hoffen, dass der Cron ihn erneuert. Diese Einrichtung ist nicht zu finden, wenn man sie
-- einmal im Jahr braucht, und sie ändert sich mit jeder Meta-Umstellung. Für sechs Bilder
-- ist das der falsche Handel.
--
-- Der neue Weg hat KEINE Abhängigkeit nach draussen: Anton lädt im Admin das Bild hoch und
-- fügt den Link zum Beitrag ein. Nichts läuft ab, nichts muss erneuert werden, und die
-- Auswahl ist bewusst statt „die letzten sechs, auch wenn eines eine Umfrage war".
--
-- Für die Besucher ändert sich nichts: Die Section liest weiter genau diese Tabelle, die
-- Bilder liegen weiter in unserem eigenen Speicher, es gibt weiter keinen Meta-Kontakt im
-- Browser und deshalb weiter keinen Einwilligungs-Banner.

-- Der Token wird nicht mehr gebraucht. Eine Tabelle, die ein Geheimnis tragen KANN, aber
-- keinen Zweck mehr hat, ist ein Risiko ohne Gegenwert: Sie überlebt jeden Rückbau im Code
-- und irgendwann trägt jemand wieder etwas ein.
drop table if exists public.social_accounts;

-- social_posts wird neu angelegt statt umgebaut, und zwar weil die Tabelle NACHWEISLICH LEER
-- ist (0051 ist von heute, es lief nie ein Abgleich). Sechs alter-table-Schritte hintereinander
-- wären schwerer zu lesen als die Endform, und beim Lesen dieser Datei will man wissen, wie die
-- Tabelle AUSSIEHT, nicht wie sie einmal aussah.
drop table if exists public.social_posts;

create table public.social_posts (
  -- Eigene Kennung. Vorher stand hier die Instagram-Media-ID; die gibt es ohne API nicht
  -- mehr, und eine fremde Kennung als Primärschlüssel war ohnehin nur für den Abgleich nötig.
  id         uuid        primary key default gen_random_uuid(),

  -- Ziel beim Antippen: der Beitrag auf instagram.com. Geprüft wird beim Speichern
  -- (nur instagram.com, siehe addSocialPost in src/lib/social-actions.ts).
  permalink  text        not null,

  -- Das Bild in unserem Bucket `spot-media` (Unterordner social/), hochgeladen im Admin und
  -- dort bereits auf 1080px WebP gerechnet. NIEMALS eine Instagram-URL: die sind signiert,
  -- laufen nach Stunden ab und wären ein fremder Host im Browser des Besuchers.
  image_url  text        not null,

  -- Masse des Bildes. Ohne sie müsste next/image raten und das Layout springt beim Laden.
  width      integer     not null check (width  > 0),
  height     integer     not null check (height > 0),

  -- Reel? Dann liegt ein Play-Zeichen über der Kachel. Wird beim Speichern aus dem Link
  -- ABGELEITET (/reel/ oder /reels/), nicht abgefragt: ein Häkchen weniger im Formular.
  is_reel    boolean     not null default false,

  -- Bildbeschreibung für Screenreader. Optional; fehlt sie, nimmt die Section einen
  -- neutralen Satz aus den Übersetzungen (Social.postAlt).
  alt        text,

  -- Reihenfolge, 0 = erste Kachel. Der Admin verschiebt mit Pfeilen; die Section zeigt die
  -- ersten SOCIAL_FEED_SIZE (6).
  position   integer     not null default 0,

  created_at timestamptz not null default now()
);

comment on table public.social_posts is
  'Instagram-Kacheln der Startseite/Über-uns, im Admin gepflegt (Einstellungen -> Instagram-'
  'Kacheln). Schreiben: src/lib/social-actions.ts (nur hinter requireAdmin). Lesen: '
  'src/lib/social-feed.ts. Kein Meta-Zugriff, weder im Browser noch am Server.';

create index if not exists social_posts_position_idx on public.social_posts (position);

alter table public.social_posts enable row level security;

-- Jeder darf lesen: Das sind unsere öffentlichen Instagram-Beiträge, öffentlicher geht es
-- nicht. Kein Insert/Update/Delete-Policy -> nur der Service-Client schreibt, und der läuft
-- ausschliesslich in den Admin-Actions hinter dem Rollen-Guard. Gleiches Muster wie
-- home_content (0036) und app_settings (0023).
drop policy if exists social_posts_public_read on public.social_posts;
create policy social_posts_public_read on public.social_posts
  for select using (true);
