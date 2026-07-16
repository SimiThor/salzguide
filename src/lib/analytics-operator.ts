// Betreiber-Erkennung für die Analytics (docs/34 §H): der EINGELOGGTE Admin (wir)
// zählt NICHT als Besucher. Nur echte Nutzer werden gemessen — anonyme Besucher UND
// echte eingeloggte Kunden. Ausgeschlossen wird ausschließlich die Betreiber-Rolle
// (role='admin'). Client-Variante für die cookieless Beacons (Pageview/Event-Link):
// getSession() liest lokal (kein Netzwerk); nur wenn überhaupt eine Session existiert,
// wird die eigene Rolle gelesen (RLS erlaubt Selbst-Read). Ergebnis pro Load gecacht.
import { createClient } from "@/lib/supabase/client";

let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

export function isOperatorClient(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const supabase = createClient();
      // Lokaler Session-Check (kein Netzwerk): anonyme Besucher (die Mehrheit)
      // sind sofort "kein Betreiber" und werden normal gezählt.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        cached = false;
        return false;
      }
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
      cached = (data as { role?: string } | null)?.role === "admin";
      return cached;
    } catch {
      cached = false;
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
