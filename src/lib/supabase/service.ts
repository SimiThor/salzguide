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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-Role-Client — NUR serverseitig verwenden (umgeht RLS). Gedacht für
// reine Server-Aufgaben wie den api_cache (Default-deny für anon/authenticated).
//
// ── EINER PRO INSTANZ, NICHT EINER PRO AUFRUF ───────────────────────────────────────────
//
// Der Name sagt „create", und genau das tat die Funktion auch: Jeder der 63 Aufrufe im Code
// baute einen kompletten neuen supabase-js-Client — mit Auth-, Storage-, Realtime- und
// Functions-Teilclient, obwohl davon nur der REST-Teil je benutzt wird. Auf einer
// Spot-Seite passiert das ein Dutzend Mal, und weggeworfen wird jeder davon sofort wieder.
// Das ist keine Katastrophe, aber es ist Arbeit für den Garbage Collector bei jedem
// einzelnen Seitenaufruf jedes Besuchers, und sie bringt nichts.
//
// WARUM DAS TEILEN UNBEDENKLICH IST: Der Client hält für unseren Gebrauch keinen Zustand.
// `persistSession: false` heisst, es gibt keine Sitzung, die zwischen zwei Anfragen hängen
// bleiben könnte, und der Service-Role-Key ist für alle Aufrufer derselbe — anders als beim
// Betrachter-Client (supabase/server.ts), der die Cookies GENAU DIESES Requests trägt und
// deshalb niemals geteilt werden darf. Jede Abfrage ist ein eigener HTTPS-Aufruf.
//
// Der Name bleibt `createServiceClient`, weil er an 63 Stellen steht und ein Umbenennen
// nichts besser machte als diesen Absatz.
let cached: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  // Nicht auf Modulebene bauen: Fehlt eine ENV, soll der Fehler beim ersten echten Zugriff
  // auftreten und nicht schon beim Importieren der Datei (das kippte sonst den Build).
  cached ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  return cached;
}
