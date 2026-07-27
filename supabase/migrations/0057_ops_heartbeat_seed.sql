-- ═══════════════════════════════════════════════════════════════════════════════════════
--  Die Uhr für den Totmannschalter anwerfen.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- WAS 0056 OFFEN GELASSEN HAT, und es ist ausgerechnet der Fall, der eingetreten ist:
--
-- `reportOverdueJobs()` vergleicht `now()` mit `last_run_at`. Gibt es zu einem Job noch GAR
-- KEINE Zeile, gibt es auch nichts zu vergleichen — und die Entscheidung in ops.ts lautete
-- bewusst „keine Zeile = nicht überfällig", damit direkt nach dem Einspielen der Migration
-- kein Fehlalarm losgeht.
--
-- Der blinde Fleck daran: Ein Job, der noch NIE gelaufen ist, hat für immer keine Zeile. Er
-- kann damit auch für immer nicht überfällig werden. Der Wächter hätte also genau den
-- Zustand nie gemeldet, den er entdecken soll: „läuft seit jeher nicht".
--
-- Und genau das lag vor. Am 27.07.2026 kam heraus, dass die wöchentliche Event-Recherche nie
-- automatisch lief — `CRON_SECRET` war in Vercel nicht gesetzt, die Cron-Route gab jedes Mal
-- 401 zurück, und weil ein 401 nichts schreibt, sah niemand etwas. Aufgefallen ist es nur,
-- weil Anton bemerkt hat, dass die Eventliste am Montagvormittag noch leer war.
--
-- DIE SAAT LÖST DAS, ohne den Fehlalarm zurückzuholen: Jeder bekannte Job bekommt JETZT einen
-- Zeitstempel. Die Frist läuft ab dem Einspielen dieser Migration. Meldet sich ein Job
-- innerhalb seiner Frist nicht (36 Stunden für den täglichen, zehn Tage für den wöchentlichen,
-- siehe OPS_JOBS in lib/ops-events.ts), ist er überfällig — auch wenn er es noch nie war.
--
-- `last_ok_at` bleibt bewusst NULL: Es hat ja noch kein erfolgreicher Lauf stattgefunden.
-- Die Admin-Seite liest genau das und zeigt „noch nie erfolgreich" statt eines grünen
-- „läuft", das hier gelogen wäre.
--
-- `on conflict do nothing`: Ein echter Lauf, der schon geschrieben hat, wird NICHT
-- überschrieben. Die Migration lässt sich damit gefahrlos zweimal einspielen.

insert into public.ops_heartbeats (job, last_run_at, last_ok_at, ok, detail)
values
  -- Die Schlüssel müssen zu OPS_JOBS in src/lib/ops-events.ts passen. Steht dort ein Job,
  -- der hier fehlt, wird er erst nach seinem ersten echten Lauf überwacht.
  ('cleanup', now(), null, true, jsonb_build_object('quelle', 'saat')),
  ('events',  now(), null, true, jsonb_build_object('quelle', 'saat'))
on conflict (job) do nothing;
