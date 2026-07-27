import "server-only";
import { createClient } from "./supabase/server";
import { logOps, opsSubject } from "./ops";

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
  return gate(true);
}

/**
 * Die Prüfung selbst. `loud` entscheidet, ob eine Zurückweisung Alarm auslöst.
 *
 * WARUM DIESER SCHALTER EXISTIERT, und warum er kein Kompromiss ist:
 * Dieselbe Prüfung bewacht zwei sehr verschiedene Dinge. Eine SERVER-ACTION erreicht man nur,
 * indem man ihren POST-Endpunkt von Hand aufruft — es gibt keinen Knopf dorthin, wenn man
 * kein Admin ist. Eine SEITE erreicht man, indem man „/admin" in die Adresszeile tippt, und
 * das macht früher oder später jeder neugierige Nutzer einmal.
 *
 * Beides gleich laut zu behandeln hiesse, entweder den ersten Fall zu verschlafen oder beim
 * zweiten grundlos geweckt zu werden. Der Neugierige läuft deshalb über eine Schwelle
 * (admin_page_denied, siehe Katalog), der Direktaufruf sofort.
 */
async function gate(loud: boolean): Promise<AdminGate> {
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
  if (profile?.role !== "admin") {
    // ═══════════════════════════════════════════════════════════════════════════════
    //  DER EINE FALL, DER IM NORMALBETRIEB NIE VORKOMMT
    // ═══════════════════════════════════════════════════════════════════════════════
    //
    // Wichtig ist der Unterschied zu `auth` oben, und deshalb wird NUR hier gemeldet:
    //
    //   auth       Niemand angemeldet. Passiert dauernd und harmlos — eine Session läuft
    //              ab, während ein Formular offen steht. Das ist Alltag, kein Vorfall.
    //   forbidden  Jemand IST angemeldet, hat aber keine Admin-Rolle. Bei einer Server-Action
    //              heisst das: Er hat ihren POST-Endpunkt von Hand aufgerufen, denn einen
    //              Knopf dorthin gibt es für ihn nicht. Das ist entweder ein Sicherheitstest
    //              oder ein übernommenes Konto, und beides will man am selben Tag wissen.
    //              Genau dieses Signal meint OWASP A09 mit „alert on privilege escalation".
    //
    // Die Nutzer-ID kommt PSEUDONYM ins Log, obwohl wir sie hier im Klartext haben: Das Log
    // ist keine Personenakte. Zum Wiedererkennen („schon wieder derselbe") reicht der Hash,
    // und wer die Zeile im Ernstfall auflösen muss, findet den Menschen über den Zeitpunkt
    // in Supabase.
    await logOps(loud ? "admin_forbidden" : "admin_page_denied", {
      message: loud
        ? "Angemeldeter Nutzer ohne Admin-Rolle hat eine Admin-Aktion aufgerufen."
        : "Angemeldeter Nutzer ohne Admin-Rolle hat eine Admin-Seite geöffnet.",
      subject: opsSubject("user", user.id),
      group: loud ? "admin:forbidden" : "admin:page",
    });
    return { ok: false, error: "forbidden" };
  }

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
  // `false` = leise: Wer hier abgewiesen wird, hat eine SEITE geöffnet, nicht geschrieben.
  // Siehe die Begründung an `gate()`.
  const result = await gate(false);
  return result.ok ? result.userId : null;
}
