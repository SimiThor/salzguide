-- Der Gruss gilt pro Pro-ZEITRAUM, nicht einmal im Leben.
--
-- Der Fehler, den das behebt: 0044 und 0045 merken sich "diesem Menschen wurde von seinem
-- Pro erzählt" und haben das nie wieder zurückgenommen. Wer Pro verlor und später erneut
-- bekam, erfuhr es kein zweites Mal. Aufgefallen ist es beim Entziehen und Neu-Schenken im
-- Admin, aber es ist kein Testfall-Problem:
--
--   * geschenktes Pro wird zurückgenommen und ein Jahr später wieder vergeben
--   * jemand lässt sich den Kauf erstatten und kauft später neu
--
-- In beiden Fällen ist "dein Pro ist da" eine wahre und NEUE Auskunft. Sie zu verschweigen,
-- weil man sie vor einem Jahr schon einmal gegeben hat, ist schlicht falsch.
--
-- WARUM ALS TRIGGER UND NICHT IM ANWENDUNGSCODE:
-- `is_pro` wird an drei Stellen geschrieben — set_user_pro() (Admin, 0038), der
-- Stripe-Webhook beim Kauf und derselbe Webhook bei der Rückerstattung. Ein Zurücksetzen in
-- jede einzelne zu bauen heisst, dass die vierte Schreibstelle es vergisst. Der Trigger gilt
-- für alle, auch für die, die es noch nicht gibt.
--
-- BEIDE Merkmale werden zurückgesetzt, denn beide beantworten dieselbe Frage: "haben wir
-- DIESES Pro angekündigt?" Wenn das Pro endet, endet auch die Geschichte. Für die Mail
-- bleibt der Haken "Mail schicken" im Admin die Kontrolle im Einzelfall — wer zum Testen
-- entzieht und neu schenkt, nimmt ihn heraus. Innerhalb EINES Zeitraums bremst weiterhin
-- die Bedingung im UPDATE (siehe pro-notice-actions.ts und user-actions.ts), ein zweiter
-- Klick löst also nach wie vor nichts aus.
create or replace function public.reset_pro_notices()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Nur der Übergang "hatte Pro" -> "hat kein Pro mehr". Ein UPDATE, das is_pro nur
  -- erwähnt ohne es zu ändern, lässt die Merkmale in Ruhe.
  if old.is_pro and not new.is_pro then
    new.pro_notice_seen_at := null;
    new.pro_gift_mailed_at := null;
  end if;
  return new;
end;
$$;

-- REIHENFOLGE DER BEFORE-TRIGGER, und die ist hier kein Zufall:
-- Postgres feuert BEFORE-Trigger in alphabetischer Reihenfolge ihres Namens.
-- "profiles_protect_columns" (0016) läuft damit VOR "profiles_reset_pro_notices".
--
-- Genau so muss es sein: Der Spaltenschutz setzt für eingeloggte Nicht-Admins is_pro auf
-- den alten Wert zurück. Versucht also ein normaler Nutzer, sich selbst Pro zu entziehen,
-- um sich einen neuen Gruss zu erschleichen, ist danach old.is_pro = new.is_pro und die
-- Bedingung unten greift gar nicht erst. Nur Admin, Service-Client und Migrationen kommen
-- durch — also genau die, die Pro wirklich entziehen dürfen.
drop trigger if exists profiles_reset_pro_notices on public.profiles;
create trigger profiles_reset_pro_notices
  before update of is_pro on public.profiles
  for each row execute function public.reset_pro_notices();

comment on function public.reset_pro_notices() is
  'Setzt pro_notice_seen_at und pro_gift_mailed_at zurück, sobald jemand sein Pro verliert. '
  'Damit gilt der Willkommensgruss je Pro-Zeitraum statt einmal im Leben.';

-- Der Kommentar aus 0045 stimmt jetzt nicht mehr: Er versprach ausdrücklich, dass KEINE
-- zweite Mail rausgeht, wenn ein Admin entzieht und erneut schenkt. Genau das tut sie ab
-- hier wieder, und zwar mit Absicht. Ein Spaltenkommentar, der das Gegenteil behauptet,
-- ist schlimmer als gar keiner.
comment on column public.profiles.pro_gift_mailed_at is
  'Wann dem Nutzer per Mail mitgeteilt wurde, dass wir ihm Pro geschenkt haben. NULL = noch nie. '
  'Wird zurückgesetzt, sobald er sein Pro verliert (0046) -> gilt je Pro-Zeitraum. Innerhalb '
  'eines Zeitraums verhindert es die zweite Mail.';

comment on column public.profiles.pro_notice_seen_at is
  'Wann dem Nutzer einmalig gezeigt wurde, dass sein Pro aktiv ist (egal ob gekauft, '
  'übernommen oder geschenkt). NULL = steht noch aus. Wird gesetzt, wenn er den Hinweis '
  'WEGGEKLICKT hat, und zurückgesetzt, sobald er sein Pro verliert (0046).';
