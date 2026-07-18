-- Ein Willkommensgruss für JEDEN Weg zu Pro, nicht nur für den Umzug.
--
-- Ausgangslage: Es gibt drei Wege, wie jemand Pro bekommt (Enum pro_source seit 0001):
--   'stripe'    -> selbst gekauft, der Webhook schaltet frei
--   'migration' -> auf der alten Plattform gekauft, Sammel-Import aus 0040
--   'comp'      -> von uns geschenkt, per set_user_pro() aus dem Admin (0038)
--
-- Erzählt wurde es dem Menschen aber nur auf zwei davon, und beide Male wackelig:
--   'stripe'    hing an ?checkout=success in der URL -> beim Neuladen wieder da
--   'migration' hatte migration_notice_seen_at, wurde aber in auth/callback markiert,
--               BEVOR der Gruss gezeigt wurde -> Tab zu und er ist für immer weg
--   'comp'      bekam gar nichts. Wer Pro geschenkt bekam, musste es selbst merken.
--
-- Das Wissen "diesem Menschen wurde von seinem Pro erzählt" hat mit der Herkunft nichts
-- zu tun. Deshalb wird die Spalte nicht kopiert, sondern umbenannt: eine Spalte, eine
-- Bedeutung. Der Zeitpunkt der Alt-Käufer bleibt dabei erhalten, wer seinen Gruss schon
-- gesehen hat, bekommt ihn nicht nochmal.
--
-- REIHENFOLGE BEIM AUSROLLEN: erst Code, dann diese Migration. Der neue Code liest die
-- Spalte nur noch über getPendingProNotice()/dismissProNotice() und verträgt es, wenn sie
-- kurz noch anders heisst (beide fangen Fehler ab und zeigen dann eben keinen Gruss).
-- Andersherum liefe der alte auth/callback-Code kurz gegen eine Spalte, die es nicht mehr
-- gibt. Ein verpasster Gruss ist ärgerlich, ein kaputter Login wäre schlimmer.
alter table public.profiles
  rename column migration_notice_seen_at to pro_notice_seen_at;

comment on column public.profiles.pro_notice_seen_at is
  'Wann dem Nutzer einmalig gezeigt wurde, dass sein Pro aktiv ist (egal ob gekauft, '
  'übernommen oder geschenkt). NULL = steht noch aus. Wird erst gesetzt, wenn er den '
  'Hinweis WEGGEKLICKT hat, nicht schon beim Anzeigen.';

-- Bewusst weiterhin NICHT im Spaltenschutz (0016), gleiche Begründung wie in 0041:
-- Wer sich das selbst setzt, hat nur seinen eigenen Gruss weggeklickt. Das ist kein
-- Angriff, das ist eine Meinung. Genau deshalb reicht der normalen RLS-Policy
-- "profiles_update_own" ein schlichtes UPDATE aus der Server Action.

-- Nur-Pro-Zeilen mit offenem Gruss sind die einzigen, die je gesucht werden. Ein
-- Teilindex darauf bleibt winzig und schrumpft von selbst, sobald die Grüsse raus sind.
create index if not exists profiles_pro_notice_pending_idx
  on public.profiles (id)
  where is_pro and pro_notice_seen_at is null;
