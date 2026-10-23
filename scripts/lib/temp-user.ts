// Wegwerf-Konto für Prüf-Skripte, die als eingeloggter Nutzer gegen einen laufenden Server
// und das echte Supabase prüfen müssen (scripts/app-api-check.ts, Browser-Screenshots).
//
// WAS PASSIERT: Ein Konto mit einer eindeutigen Adresse `app-api-check+<zeit>-<zufall>@example.com`
// wird per Admin-API angelegt (Mail-Adresse bestätigt, es geht KEINE Mail raus), über einen
// Magic-Link-Token gegen eine echte Sitzung getauscht (auch dabei geht keine Mail raus: der
// Token kommt direkt aus generateLink) und am Ende wieder gelöscht.
//
// NEBENWIRKUNGEN (geprüft in supabase/migrations und src/):
//  - Trigger on_auth_user_created -> handle_new_user (0054) legt die profiles-Zeile an und
//    sucht offene pro_purchases/pro_migrations zu dieser Adresse. example.com mit einem
//    einmaligen Suffix trifft nichts: kein Pro, kein Kauf wird eingelöst.
//  - Kein Webhook, kein pg_net, kein Auth-Hook im Repo. Das Setzen von is_pro/role löst nur
//    reset_pro_notices (0046, nur beim Verlust von Pro) und den Spaltenschutz (0016/0072) aus.
//    Letzterer lässt den Service-Key durch, weil dort auth.uid() null ist.
//  - Pro-Willkommens-/Geschenk-Mails gehen nur aus der App (pro_gift_mailed_at), nie aus der DB.
//
// SICHERHEIT: Löschen und Ändern geht ausschliesslich für Konten, deren Adresse mit
// `app-api-check+` beginnt und auf `@example.com` endet.
import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export type TempUser = { id: string; email: string; session: Session };

const PREFIX = "app-api-check+";
const SUFFIX = "@example.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt (.env.local geladen?)`);
  return v;
}

function isTempEmail(email: string | undefined | null): boolean {
  return !!email && email.startsWith(PREFIX) && email.endsWith(SUFFIX);
}

export function serviceClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Nur ein echtes "nicht gefunden" heisst "weg". Jeder andere Fehler (Netz, 5xx, Rate-Limit) darf
// nie als "geloescht" durchgehen, sonst meldet das Skript "ja", obwohl das Konto noch existiert.
function isNotFound(error: { status?: number; code?: string }): boolean {
  return error.status === 404 || error.code === "user_not_found";
}

/** Wirft, wenn die ID nicht zu einem Wegwerf-Konto gehört oder die Abfrage scheitert. Gibt false zurück, wenn es das Konto nicht (mehr) gibt. */
async function guardTempId(svc: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await svc.auth.admin.getUserById(id);
  if (error) {
    if (isNotFound(error)) return false;
    throw new Error(`getUserById fehlgeschlagen: ${error.message}`);
  }
  if (!data?.user) return false;
  if (!isTempEmail(data.user.email)) {
    throw new Error("Sicherung: Konto ist kein Wegwerf-Konto (app-api-check+...@example.com), Abbruch.");
  }
  return true;
}

export async function createTempUser(): Promise<TempUser> {
  const svc = serviceClient();
  const rand = Math.random().toString(36).slice(2, 10);
  const email = `${PREFIX}${Date.now()}-${rand}${SUFFIX}`;

  const created = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`createUser fehlgeschlagen: ${created.error?.message ?? "kein Nutzer"}`);
  }
  const id = created.data.user.id;

  try {
    const link = await svc.auth.admin.generateLink({ type: "magiclink", email });
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) {
      throw new Error(`generateLink fehlgeschlagen: ${link.error?.message ?? "kein Token"}`);
    }

    let session: Session | null = null;
    let lastError = "";
    for (const type of ["magiclink", "email"] as const) {
      const res = await anonClient().auth.verifyOtp({ token_hash: hashed, type });
      if (res.data?.session) {
        session = res.data.session;
        break;
      }
      lastError = res.error?.message ?? "keine Sitzung";
    }
    if (!session) throw new Error(`verifyOtp fehlgeschlagen: ${lastError}`);
    return { id, email, session };
  } catch (e) {
    // Halb angelegt ist schlimmer als gar nicht: sofort wieder weg.
    await deleteTempUser(id).catch(() => false);
    throw e;
  }
}

export async function setProfile(
  id: string,
  patch: { is_pro?: boolean; role?: "user" | "admin" },
): Promise<void> {
  const svc = serviceClient();
  if (!(await guardTempId(svc, id))) throw new Error("Wegwerf-Konto existiert nicht (mehr).");
  const { error } = await svc.from("profiles").update(patch).eq("id", id);
  if (error) throw new Error(`profiles-Update fehlgeschlagen: ${error.message}`);
}

/** Cookie-Header, wie ihn die Web-App für diese Sitzung erwartet (inkl. gestückelter Cookies). */
export async function webCookieHeader(session: Session): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => [],
        setAll: (list) => {
          for (const c of list) {
            if (c.value) jar.set(c.name, c.value);
            else jar.delete(c.name);
          }
        },
      },
    },
  );
  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new Error(`setSession fehlgeschlagen: ${error.message}`);
  // Die Bibliothek schreibt die Cookies aus einem Ereignis-Callback, kurz warten.
  await new Promise((r) => setTimeout(r, 100));
  if (jar.size === 0) throw new Error("Keine Sitzungs-Cookies erzeugt.");
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** Löscht das Konto und bestätigt, dass es weg ist. */
export async function deleteTempUser(id: string): Promise<boolean> {
  const svc = serviceClient();
  const exists = await guardTempId(svc, id);
  if (!exists) return true;
  const del = await svc.auth.admin.deleteUser(id);
  if (del.error) return false;
  const after = await svc.auth.admin.getUserById(id);
  if (after.error) {
    if (isNotFound(after.error)) return true;
    throw new Error(`Loesch-Bestaetigung fehlgeschlagen: ${after.error.message}`);
  }
  return !after.data?.user;
}

/** Raeumt liegengebliebene Wegwerf-Konten frueherer Laeufe ab (nur Muster PREFIX...SUFFIX, aelter als 1 Stunde). Gibt die Anzahl zurueck. */
export async function sweepTempUsers(): Promise<number> {
  const svc = serviceClient();
  // Nur Konten ab 1 Stunde: Ein parallel laufender Lauf behaelt sein frisches Konto.
  const cutoff = Date.now() - 60 * 60_000;
  const ids: string[] = [];
  for (let page = 1; ; ) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers fehlgeschlagen: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (isTempEmail(u.email) && Date.parse(u.created_at) < cutoff) ids.push(u.id);
    }
    // nextPage ist die verlaessliche Quelle; die Laengenpruefung gilt nur, wenn sie fehlt.
    const next = "nextPage" in data ? data.nextPage : undefined;
    if (typeof next === "number" && next > page) page = next;
    else if (next === undefined && users.length >= 1000) page++;
    else break;
  }
  let count = 0;
  for (const id of ids) {
    // deleteTempUser prueft das Muster erneut (guardTempId) und bestaetigt die Loeschung.
    if (!(await deleteTempUser(id))) throw new Error("Sweep: Loeschen nicht bestaetigt.");
    count++;
  }
  return count;
}

/** Eine frische Wegwerf-Adresse OHNE Konto (für Prüfungen, die das Konto erst erzeugen lassen). */
export function newTempEmail(): string {
  return `${PREFIX}new-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${SUFFIX}`;
}

/**
 * Löscht das Konto zu einer Wegwerf-Adresse, falls es eines gibt, und bestätigt es.
 * Gibt true zurück, wenn danach keines mehr existiert (auch wenn nie eines angelegt wurde).
 * Die Muster-Sicherung gilt wie überall: Fremde Adressen werden nie angefasst.
 */
export async function deleteTempUserByEmail(email: string): Promise<boolean> {
  if (!isTempEmail(email)) throw new Error("Sicherung: keine Wegwerf-Adresse, Abbruch.");
  const svc = serviceClient();
  for (let page = 1; ; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers fehlgeschlagen: ${error.message}`);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return deleteTempUser(hit.id);
    if (data.users.length < 1000) return true;
  }
}
