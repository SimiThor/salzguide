-- ============================================================================
-- SalzGuide, Migration 0072: Gespeicherte Runden nur für Pro, Kontoadresse gesperrt
--
-- Zwei Regeln, die bisher nur im Code standen oder gar nicht, wandern in die Datenbank.
-- Beide aus demselben Grund: Die Tabelle ist per RLS direkt erreichbar, und eine Regel, die
-- nur die App kennt, gilt nur für die App.
--
-- Idempotent, kein Datenverlust, darf jederzeit vor dem Code rein: Der normale Weg
-- (generateTour) speichert ohnehin nur für Pro, und die App schreibt profiles.email nie.
-- ============================================================================


-- ── 1. user_tours: Anlegen nur für Pro (oder Admin) ────────────────────────────
--
-- WARUM: Der Lesepfad (getUserTourDetail) vertraut einer gespeicherten Runde und gibt ihre
-- ersten Stopps frei. Wer eine Zeile anlegen darf, bestimmt also mit, was freigegeben wird.
-- Bauen war schon immer Pro (generateTour), Speichern bisher nicht: 0028 prüfte nur, dass
-- die Zeile dem eigenen Konto gehört. Die Server-Action saveUserTour prüft Pro jetzt selbst;
-- diese Policy hält dieselbe Regel für jeden anderen Weg in die Tabelle.
--
-- Pro heisst hier dasselbe wie in viewerCanSeePro(): is_pro ODER Admin. is_pro_user() (0017)
-- und is_admin() (0001) sind SECURITY DEFINER, lesen profiles also ohne RLS-Rekursion.
--
-- Nur der Insert ändert sich. Lesen und Löschen bleiben beim Eigentümer, auch wenn Pro
-- später endet: Seine Runden gehören ihm weiter, gesperrt wird beim Ansehen (0028). Eine
-- UPDATE-Policy gibt es nicht, der Insert ist der einzige Schreibweg.
drop policy if exists "user_tours_insert_own" on public.user_tours;
create policy "user_tours_insert_own" on public.user_tours
  for insert to authenticated
  with check (auth.uid() = user_id and (public.is_pro_user() or public.is_admin()));


-- ── 2. profiles.email: in den Spaltenschutz (0016/0045) ──────────────────────
--
-- WARUM: Die Kontoadresse gehört Supabase Auth (auth.users), profiles.email ist ihre Kopie,
-- angelegt von handle_new_user. Auf die Kopie verlässt sich mehr, als man ihr ansieht:
-- pro-purchase.ts verknüpft Gast-Käufe über sie (findProfileByEmail) und nimmt an, dass sie
-- sich nie ändert; Kauf- und Geschenk-Mails gehen an sie. Die App hat keinen E-Mail-Wechsel
-- und schreibt die Spalte nie. Die RLS-Policy "profiles_update_own" kennt aber keinen
-- Spaltenschutz, also konnte jeder eingeloggte Nutzer sie auf eine beliebige Adresse setzen.
--
-- UPDATE: die alte Adresse bleibt, wie bei den anderen geschützten Spalten.
-- INSERT: die Adresse kommt aus auth.users, nie aus der Anfrage. Im Normalfall legt
-- handle_new_user das Profil an, dort ist auth.uid() null und der Schutz greift gar nicht.
-- Legt ein Nutzer seine Zeile selbst an (profiles_insert_own erlaubt das), bekommt er
-- trotzdem nur seine eigene Adresse. Die Funktion ist SECURITY DEFINER und darf auth.users
-- lesen.
--
-- BEWUSST NICHT GESCHÜTZT: newsletter_opt_in, newsletter_opt_in_at, locale,
-- pro_notice_seen_at. Die schreibt die App selbst mit dem Session-Client
-- (setNewsletter, auth/callback, locale-actions, pro-notice-actions). Der Trigger meldet
-- keinen Fehler, er setzt still zurück: Ein Feld zu viel in dieser Liste, und der
-- Newsletter-Schalter wäre kaputt, ohne dass es irgendwo rot wird.
--
-- Übernommen aus 0045, VOLLSTÄNDIG, neu sind nur die beiden email-Zeilen. Der Trigger
-- profiles_protect_columns (0016) bleibt, er ruft diese Funktion auf.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'UPDATE' then
      new.role               := old.role;
      new.is_pro             := old.is_pro;
      new.pro_since          := old.pro_since;
      new.pro_source         := old.pro_source;
      new.stripe_customer_id := old.stripe_customer_id;
      new.pro_gift_mailed_at := old.pro_gift_mailed_at;
      new.email              := old.email;
    elsif tg_op = 'INSERT' then
      new.role               := 'user';
      new.is_pro             := false;
      new.pro_since          := null;
      new.pro_source         := null;
      new.stripe_customer_id := null;
      new.pro_gift_mailed_at := null;
      new.email              := (select u.email from auth.users u where u.id = new.id);
    end if;
  end if;
  return new;
end;
$$;
