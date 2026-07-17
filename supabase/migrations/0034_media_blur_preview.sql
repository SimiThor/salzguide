-- Vorschaubild für gesperrte Pro-Spots ("Geheimtipps").
--
-- Warum überhaupt eine eigene Datei und kein CSS-Blur auf dem Originalbild:
-- Der Bucket "spot-media" ist öffentlich. Sobald die echte Bild-URL im HTML steht,
-- ist ein CSS-Blur reine Kosmetik – Filter in den DevTools entfernen und das Foto
-- liegt offen. Deshalb bekommt der Client für gesperrte Spots NUR diese ~160px breite
-- Version. Mehr Bilddaten existieren dort schlicht nicht.
--
-- Gespeichert wird die öffentliche URL der Vorschau, NICHT das Bild selbst:
-- Als data:-URI in der Seite wären es bei ~65 gesperrten Spots ~0,6 MB HTML, und
-- Inline-Daten lassen sich nicht lazy laden. Als Datei lädt der Browser nur, was ins
-- Bild scrollt, und cacht sie danach.
--
-- Die Vorschau liegt unter previews/<eigene UUID>.webp – bewusst OHNE Bezug zum
-- Dateinamen des Originals, sonst verriete die Vorschau-URL den Pfad zum vollen Foto.
--
-- Wird beim Speichern eines Spots erzeugt (siehe lib/blur-preview.ts) und für
-- Bestandsbilder per `npm run backfill:blur` nachgezogen.
--
-- NUR für Spots. Tour-Stopps brauchen bewusst KEINE Vorschau: Dort sind Titel, Bild
-- und Position öffentliche Teaser, nur Audio-Text und MP3 sind die Pro-Ware (0029).
alter table public.media
  add column if not exists blur_url text;

comment on column public.media.blur_url is
  'Öffentliche URL der ~160px-Vorschau (previews/<uuid>.webp). Einzige Bilddaten, die gesperrte Pro-Spots an den Client liefern.';
