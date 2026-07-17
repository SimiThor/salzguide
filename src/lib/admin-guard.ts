import "server-only";
import { createClient } from "./supabase/server";

// Die EINE Stelle, die entscheidet, ob jemand Admin ist.
//
// Vorher stand dieselbe Prüfung sechsmal fast wortgleich im Code: `assertAdmin` in
// admin-actions, tour-actions und tour-pool-actions, `requireAdmin` in event-actions und
// anchor-actions, `getAdminUserId` in admin.ts. Die Kommentare gaben es offen zu
// („Admin-Gate (wie in admin-actions)", „Admin-Gate (wie in event-actions)").
//
// Sechs Kopien einer Sicherheitsprüfung sind sechs Gelegenheiten, sie unterschiedlich zu
// machen — und bei der siebten vergisst jemand eine Zeile. Genau davor warnt das eigene
// Audit (docs/34 §D: „Admin-Check konsolidieren: 1 gemeinsamer requireAdmin()-Helper").
//
// WARUM DIE RÜCKGABE EINE UNION IST, und nicht ein Objekt mit `ok`-Flag:
// Die drei `assertAdmin`-Kopien gaben den DB-Client AUCH im Fehlerfall zurück:
//
//     if (!user) return { supabase, ok: false as const, error: "auth" };
//
// Wer danach `gate.ok` zu prüfen vergaß und direkt `gate.supabase.from(…).delete()`
// schrieb, bekam vom Compiler kein Wort. Gerettet hat nur, dass RLS in der Datenbank ein
// zweites Mal prüft — aber die Tür stand offen. Mit der Union unten gibt es `supabase`
// nur im Erfolgsfall: Wer ungeprüft zugreift, bekommt einen TYPFEHLER. Aus einer
// Konvention wird ein Zwang.
//
// WARUM DIE SESSION UND NICHT DER SERVICE-CLIENT ZURÜCKKOMMT:
// Schreibt eine Aktion mit dem Session-Client, prüft RLS in Postgres die Admin-Rolle ein
// zweites Mal (`*_admin_all`-Policies). Zwei Schlösser, unabhängig voneinander. Der
// Service-Client umgeht RLS und gehört nur dorthin, wo es keine Policy geben KANN (Cron,
// Stripe-Webhook, service-only-RPCs).

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** `auth` = nicht eingeloggt. `forbidden` = eingeloggt, aber kein Admin. */
export type AdminGateError = "auth" | "forbidden";

export type AdminGate =
  | { ok: true; supabase: ServerClient; userId: string }
  | { ok: false; error: AdminGateError };

/**
 * Wächter für Server-Actions. IMMER als erste Zeile einer mutierenden Aktion aufrufen.
 *
 * Server-Actions sind eigene POST-Endpunkte — das Layout-Guard des Admin-Bereichs schützt
 * sie NICHT. Wer eine Aktion ohne diesen Aufruf exportiert, hat sie ins offene Netz
 * gestellt.
 *
 * `getUser()` und nicht `getSession()`: getSession liest das Cookie und glaubt ihm,
 * getUser lässt das Token vom Auth-Server prüfen.
 */
export async function requireAdmin(): Promise<AdminGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { ok: false, error: "forbidden" };

  return { ok: true, supabase, userId: user.id };
}

/**
 * Die ID des angemeldeten Admins, sonst null.
 *
 * Für Seiten (Layout-Guard) und für Lesepfade, die danach bewusst den Service-Client
 * nehmen, weil ihre RPCs service-only sind (analytics-queries, ai-insights). Wer schreibt,
 * nimmt `requireAdmin` und dessen Session-Client — sonst fällt die zweite Schlossprüfung
 * durch RLS weg.
 */
export async function getAdminUserId(): Promise<string | null> {
  const gate = await requireAdmin();
  return gate.ok ? gate.userId : null;
}
