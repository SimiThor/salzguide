-- ============================================================================
-- SalzGuide, Migration 0065: Kostprobe je Audio-Punkt
--
-- WARUM: Die Radrunde macht die ersten Stopps gratis und ab dem dritten
-- kostenpflichtig (docs/40). Bis jetzt sah der Gast am ersten bezahlten Spot ein
-- graues Schloss, wo eben noch der Play-Knopf war. Ein Schloss sagt nein. Es sagt
-- nicht, was es kostet und was danach kommt, und es sieht aus wie eine Strafe.
--
-- Stattdessen bekommt jeder Punkt eine KOSTPROBE von rund 20 Sekunden. Gesperrt
-- sieht damit aus wie angefangen, nicht wie zugesperrt.
--
-- WARUM EINE EIGENE DATEI UND KEIN ABSCHNEIDEN: Wer die Volldatei ausliefert und
-- nach 20 Sekunden stoppt, hat kein Gate gebaut, sondern eine Bitte. Die Datei
-- liegt dann komplett im Browser. Die Kostprobe ist deshalb ein eigenes Objekt im
-- privaten tour-audio-Bucket, und nur DIESES wird für einen gesperrten Stopp
-- signiert.
--
-- Und sie ist nicht der abgeschnittene Anfang, sondern ein eigener Text. Bei einem
-- Schnitt endet der Ton mitten im Satz. Ein eigener Text kann dort aufhören, wo es
-- gerade spannend wird, und das ist der ganze Zweck.
--
-- Idempotent, kein Datenverlust. Bestehende Zeilen bekommen NULL, und ohne
-- Kostprobe verhält sich alles wie bisher.
-- ============================================================================

alter table public.tour_point_audio
  add column if not exists teaser_url  text,
  add column if not exists teaser_text text,
  add column if not exists teaser_sec  integer;

comment on column public.tour_point_audio.teaser_url is
  'OBJEKT-PFAD der Kostprobe im privaten tour-audio-Bucket. Das EINZIGE Audio, das fuer einen gesperrten Stopp signiert wird. Nie die Volldatei.';
comment on column public.tour_point_audio.teaser_text is
  'Der gesprochene Text der Kostprobe, rund 20 Sekunden. Eigener Text, kein Ausschnitt: Er darf aufhoeren, wo es spannend wird.';
comment on column public.tour_point_audio.teaser_sec is
  'Laenge der Kostprobe in Sekunden. Nur fuer die Anzeige.';
