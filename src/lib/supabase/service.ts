// "NIEMALS in Client-Components importieren" stand hier vorher als Kommentar. Ein
// Kommentar ist eine Bitte: Er hält niemanden auf, der die Datei versehentlich aus einer
// "use client"-Datei importiert — und dann läge der Service-Role-Key, der JEDE
// RLS-Policy umgeht, im Browser-Bundle. Für jeden lesbar, mit vollem Zugriff auf alle
// Daten aller Nutzer.
//
// `server-only` macht daraus einen BUILD-Fehler. Von allen heiklen Dateien war das hier
// ausgerechnet die einzige ohne diesen Riegel (email.ts, turnstile.ts, api-cache.ts,
// settings.ts, home-content.ts haben ihn). blur-preview.ts verzichtet bewusst darauf,
// damit scripts/backfill-blur.ts sie laden kann — für service.ts gibt es keinen solchen
// Grund: Kein Skript importiert sie, alle bauen ihren eigenen Client.
import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-Role-Client — NUR serverseitig verwenden (umgeht RLS). Gedacht für
// reine Server-Aufgaben wie den api_cache (Default-deny für anon/authenticated).
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
