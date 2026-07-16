-- Winzige Blur-Vorschau für gesperrte Pro-Spots ("Geheimtipps").
--
-- Warum in der DB und nicht per CSS-Blur auf dem Originalbild:
-- Der Bucket "spot-media" ist öffentlich. Sobald die echte Bild-URL im HTML steht,
-- ist ein CSS-Blur reine Kosmetik – Filter in den DevTools entfernen und das Foto
-- liegt offen. Deshalb bekommt der Client für gesperrte Spots NUR diese ~48px breite
-- Version als data:-URI. Mehr Bilddaten existieren dort schlicht nicht.
--
-- Format: "data:image/webp;base64,..." – wenige hundert Byte bis ~1,3 kB, geht direkt
-- in die Seiten-Payload (kein zusätzlicher Request, sofort sichtbar, kein Layout-Sprung).
-- Wird beim Speichern eines Spots erzeugt (siehe lib/blur-preview.ts) und für
-- Bestandsbilder per `npm run backfill:blur` nachgezogen.
--
-- NUR für Spots. Tour-Stopps brauchen bewusst KEINE Vorschau: Dort sind Titel, Bild
-- und Position öffentliche Teaser, nur Audio-Text und MP3 sind die Pro-Ware (0029).
alter table public.media
  add column if not exists blur_data_url text;

comment on column public.media.blur_data_url is
  'Winzige (~48px) WebP-Vorschau als data:-URI. Einzige Bilddaten, die gesperrte Pro-Spots an den Client liefern.';
