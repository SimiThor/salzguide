-- ============================================================================
-- SalzGuide, Migration 0073: Höchstens eine Standard-Merkliste je Nutzer
--
-- WARUM: getOrCreateDefaultList liest die Standardliste und legt sie an, wenn es keine gibt.
-- Das sind zwei Schritte ohne Sperre. Schicken zwei Anfragen eines neuen Nutzers gleichzeitig
-- los (Web-Herz und App-PUT, oder die App wiederholt eine Anfrage), legen beide eine Liste
-- an, und der Nutzer hat danach zwei Standardlisten. Mit maybeSingle() schlägt jede spätere
-- Abfrage dann fehl, und die Merkliste wirkt leer.
--
-- GEPRÜFT am 23.10.2026 in Produktion (nur lesend): 16 Nutzer, jeder genau eine
-- Standardliste, 0 Doppelte. Der Index lässt sich also ohne Bereinigung anlegen.
--
-- Der Code ist mit UND ohne diesen Index robust (liest mit order/limit, fängt den Fehler 23505
-- beim Anlegen ab). Der Index macht die Regel zusätzlich in der Datenbank verbindlich.
--
-- Idempotent und ohne Datenverlust. Wer vor dem Einspielen Doppelte hat, bekommt eine klare
-- Meldung statt eines unverständlichen Index-Fehlers.
-- ============================================================================

do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select user_id
    from public.saved_lists
    where is_default
    group by user_id
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception
      'Migration 0073 abgebrochen: % Nutzer haben mehr als eine Standard-Merkliste. Erst bereinigen (Listen zusammenführen, is_default bei den überzähligen auf false), dann erneut einspielen.',
      dup_count;
  end if;
end
$$;

create unique index if not exists saved_lists_one_default
  on public.saved_lists (user_id)
  where is_default;
