-- Die Mail an den Beschenkten: "wir haben dir Pro freigeschaltet".
--
-- Wozu das überhaupt, wo es seit 0044 schon den Gruss in der App gibt: Der Gruss erreicht
-- nur, wer die App öffnet. Geschenktes Pro geht aber oft an Leute, die gerade gar nicht
-- damit rechnen (Gewinnspiel, Freunde, Partner) und vielleicht wochenlang nicht
-- vorbeischauen. Die Mail geht zu ihnen, der Gruss begrüsst sie, wenn sie kommen. Beides
-- zusammen, nicht doppelt: Die Mail lädt ein, das Kärtchen bestätigt.
--
-- WARUM DAS MERKMAL HIER STEHT UND NICHT IN pro_grants:
-- Naheliegend wäre die Protokolltabelle aus 0038, dort steht schliesslich jede Schenkung.
-- Sie ist aber mit Absicht append-only gebaut, ohne UPDATE- und ohne DELETE-Policy: "Ein
-- Protokoll, das man ändern kann, ist kein Protokoll, sondern eine Behauptung." Ein Feld,
-- das man nachträglich setzt, bräuchte genau die UPDATE-Policy, die dort bewusst fehlt.
-- Der Zustand "diesem Menschen wurde geschrieben" gehört ohnehin zum Menschen, nicht zum
-- Vorgang. Damit steht er hier, direkt neben pro_notice_seen_at aus 0044, das dieselbe
-- Frage für die App beantwortet.
alter table public.profiles
  add column if not exists pro_gift_mailed_at timestamptz;

comment on column public.profiles.pro_gift_mailed_at is
  'Wann dem Nutzer per Mail mitgeteilt wurde, dass wir ihm Pro geschenkt haben. NULL = noch nie. '
  'Verhindert eine zweite Mail, wenn ein Admin Pro entzieht und erneut schenkt.';

-- ANDERS ALS pro_notice_seen_at: Diese Spalte gehört in den Spaltenschutz (0016).
--
-- Bei 0044 war das Gegenteil richtig: Wer sich seinen eigenen Gruss wegklickt, hat nur eine
-- Meinung geäussert. Hier ist es umgekehrt. Wer sich pro_gift_mailed_at selbst auf NULL
-- setzen kann, kann sich bei der nächsten Schenkung eine weitere Mail schicken lassen. Das
-- ist zwar kein grosser Schaden, aber es ist unser Mailversand, den dann jemand anderes
-- auslöst — und Versand, den ein Fremder auslösen kann, ist der Anfang jedes Missbrauchs.
--
-- Der Trigger aus 0016 setzt für eingeloggte Nicht-Admins die geschützten Spalten auf ihre
-- alten Werte zurück. Service-Client (auth.uid() null), Migrationen und Admins bleiben
-- ungehindert — genau das brauchen wir, denn markiert wird mit dem Service-Client.
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
    elsif tg_op = 'INSERT' then
      new.role               := 'user';
      new.is_pro             := false;
      new.pro_since          := null;
      new.pro_source         := null;
      new.stripe_customer_id := null;
      new.pro_gift_mailed_at := null;
    end if;
  end if;
  return new;
end;
$$;
