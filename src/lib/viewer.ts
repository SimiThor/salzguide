import { cache } from "react";
import { createClient } from "./supabase/server";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  WER SCHAUT GERADE ZU? Eine Antwort, ein Roundtrip pro Aufruf — statt einem pro Frage.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// DAS PROBLEM, das der Proxy (src/proxy.ts) für sich schon gelöst hat und der App-Code nicht:
// `auth.getUser()` fragt für JEDEN Aufruf über das Netz beim Auth-Server nach, ob das Token
// gültig ist. In den Logs vom 18.07.2026 waren das 415 Anfragen auf /auth/v1/user in 30
// Minuten — und zwar bevor irgendeine Seite rendern konnte. Der Proxy stellte daraufhin auf
// getClaims() um. Im App-Code blieb getUser() an 33 Stellen stehen, teils MEHRFACH pro
// Seitenaufruf: Die Entdecken-Karte fragte dreimal (viewerCanSeePro, die Seite selbst,
// getSavedSlugs) — drei Netz-Roundtrips, um dreimal dieselbe Frage zu beantworten.
//
// WAS getClaims() ANDERS MACHT: Es holt die Session (frischt abgelaufene Tokens weiter auf,
// niemand wird ausgesperrt) und prüft die Signatur danach LOKAL gegen den öffentlichen
// Schlüssel des Projekts. Das geht, weil dieses Projekt asymmetrisch signiert (ES256). Bei
// einem symmetrischen Secret fällt die Bibliothek von selbst auf den Server-Weg zurück, das
// bliebe also korrekt. Sicherheit: gleichwertig, beide prüfen kryptografisch.
//
// ── WANN TROTZDEM getUser() ─────────────────────────────────────────────────────────────
//
// Die lokale Prüfung sagt „dieses Token war gültig, als es ausgestellt wurde, und ist noch
// nicht abgelaufen". Sie sieht NICHT, dass eine Sitzung serverseitig zurückgezogen wurde
// (Konto gelöscht, Abmeldung überall, Rechte entzogen) — das merkt sie erst, wenn das Token
// abläuft. Daraus folgt die Regel dieser App:
//
//   LESEN, was ohnehin öffentlich ist  ->  currentUserId() (lokal, kein Roundtrip)
//   HANDELN im Namen des Nutzers       ->  auth.getUser() (Auth-Server fragen)
//
// Also: Karte, Spot-Seite, Merk-Häkchen, Pro-Sichtbarkeit lokal. Admin-Wächter, Konto
// löschen, Kauf, Server-Actions, die etwas schreiben, weiterhin über den Auth-Server. Der
// Unterschied kostet dort einen Roundtrip, aber dort passiert er auch nur einmal und nicht
// bei jedem Seitenaufruf jedes Besuchers.

/**
 * Die ID des angemeldeten Betrachters, oder null.
 *
 * `cache()` von React: pro Request genau EINMAL, egal wie viele Stellen fragen. Genau das
 * war der eigentliche Kostentreiber — nicht die einzelne Frage, sondern dass sie mehrfach
 * gestellt wurde.
 */
export const currentUserId = cache(async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    // Kein Token, kaputtes Token, Auth nicht erreichbar -> ausgeloggt behandeln. Eine
    // öffentliche Seite muss auch dann rendern, wenn die Anmeldung gerade hakt.
    return null;
  }
});

/** Ist überhaupt jemand angemeldet? Nur ein lesbarer Name für den Normalfall. */
export async function isLoggedIn(): Promise<boolean> {
  return (await currentUserId()) !== null;
}
