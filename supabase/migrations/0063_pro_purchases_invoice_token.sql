-- Der Rechnungs-Schlüssel für die Kaufbestätigungsmail.
--
-- Die Mail verlinkt auf /pro/rechnung?token=…, und diese Route löst den Kauf beim Klick
-- live bei Stripe auf (hosted_invoice_url bzw. receipt_url). Der Schlüssel dafür ist
-- BEWUSST ein eigenes Token und nicht die stripe_session_id: Die Session-ID ist der
-- Schlüssel zum Auto-Login (siehe Kopf von app/[locale]/pro/aktivieren/route.ts) und darf
-- nicht dauerhaft in einer Mail stehen, die weitergeleitet oder aus dem Verlauf geöffnet
-- wird. Dieses Token kann genau eines: die eigene Rechnung zeigen.
--
-- Der Default füllt auch alle Alt-Käufe. Deren Mails sind zwar ohne Link raus, aber der
-- Support kann so für jede bestehende Zeile einen Rechnungslink von Hand bauen.
alter table public.pro_purchases
  add column if not exists invoice_token uuid not null default gen_random_uuid();

comment on column public.pro_purchases.invoice_token is
  'Schlüssel des Rechnungslinks in der Kaufbestätigungsmail. Die Route /pro/rechnung '
  'schlägt ihn hier nach und fragt erst DANN bei Stripe an (kein offener Proxy). '
  'Beim Kauf erzeugt die App das Token selbst (recordPurchase); der Default ist der '
  'Backfill für Käufe von vor dieser Migration.';

-- Unique, weil das Token eine Zeile eindeutig bezeichnen muss; der Index ist zugleich
-- der Suchpfad der Route.
create unique index if not exists pro_purchases_invoice_token_key
  on public.pro_purchases (invoice_token);
