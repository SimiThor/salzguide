-- Alles rund um den Umzug von der alten WordPress-Plattform: der Hinweis am Login, die
-- einmalige Begrüssung nach dem Login, und die Ankündigungs-Mail.
--
-- WARUM ES KEINE ERKENNUNG AN DER E-MAIL GIBT, und das ist die wichtigste Zeile hier:
-- Naheliegend wäre, beim Login zu prüfen, ob die eingegebene Adresse ein Alt-Käufer ist,
-- und DANN einen Hinweis zu zeigen. Das wäre ein Orakel: Jeder könnte beliebige Adressen
-- eintippen und erfährt „ist diese Person zahlender SalzGuide-Kunde?". Ergebnis wäre eine
-- abfragbare Kundenliste und eine perfekte Phishing-Vorlage („dein Pro läuft ab") an Leute,
-- von denen der Angreifer WEISS, dass sie zahlen.
--
-- Der Login verrät heute nichts: bekannte und unbekannte Adresse bekommen dieselbe Antwort
-- und brauchen gleich lang (nachgemessen). Diese Eigenschaft geben wir nicht auf.
--
-- Stattdessen: derselbe Hinweis für ALLE (app_settings unten), und das Persönliche erst
-- NACH dem Login — da hat der Mensch bewiesen, dass ihm die Adresse gehört, und ein Orakel
-- ist unmöglich.

-- ── 1) Die einmalige Begrüssung ──────────────────────────────────────────────
-- Wann jemandem gesagt wurde, dass sein Pro übernommen ist. NULL = noch nie.
--
-- Bewusst NICHT im Spaltenschutz (0016): Wer sich das selbst setzt, hat nur seine eigene
-- Begrüssung weggeklickt. Das ist kein Angriff, das ist eine Meinung.
alter table public.profiles
  add column if not exists migration_notice_seen_at timestamptz;

comment on column public.profiles.migration_notice_seen_at is
  'Wann dem Nutzer einmalig gezeigt wurde, dass sein Pro von der alten Plattform übernommen ist. NULL = steht noch aus.';

-- ── 2) Die Ankündigungs-Mail ─────────────────────────────────────────────────
-- Wann die Ankündigung an diese Adresse rausging. NULL = noch nicht.
--
-- Das ist der Grund, warum ein zweiter Klick auf „Senden" niemanden doppelt anschreibt:
-- Verschickt wird nur an Zeilen mit announced_at IS NULL, und markiert wird JEDE einzeln,
-- direkt nach ihrem Versand. Bricht der Lauf in der Mitte ab, schickt der nächste genau
-- den Rest — nicht alles nochmal. Bei 100 zahlenden Kunden ist „aus Versehen zweimal
-- angeschrieben" kein Schönheitsfehler, sondern der erste Eindruck der neuen Plattform.
alter table public.pro_migrations
  add column if not exists announced_at timestamptz;

comment on column public.pro_migrations.announced_at is
  'Wann die Umzugs-Ankündigung an diese Adresse ging. NULL = noch nicht. Verhindert Doppel-Mails.';

create index if not exists pro_migrations_announced_idx
  on public.pro_migrations (announced_at);

-- ── 3) Der Schalter für den Login-Hinweis ────────────────────────────────────
-- Kein neues System: app_settings (Migration 0023) macht genau das schon, ist öffentlich
-- lesbar (der Hinweis ist ohnehin für alle sichtbar) und nur für Admins beschreibbar.
--
-- Standard 'off': Ein Hinweis, der ungefragt live geht, sobald jemand die Migration
-- einspielt, wäre genau die Art Überraschung, die man im Login nicht will. Anton schaltet
-- ihn ein, wenn die Ankündigung raus ist — und in ein paar Monaten wieder aus, ohne dass
-- jemand Code anfassen muss.
insert into public.app_settings (key, value)
values ('relaunch_notice', 'off')
on conflict (key) do nothing;
