"use server";

// DSGVO-Betroffenenrechte (docs/34 §C7): Selbst-Service Datenexport (Art. 15/20)
// und Konto-Löschung (Art. 17). Lesen läuft über den Session-Client (RLS -> nur
// eigene Daten); die Löschung der auth.users-Zeile braucht den Service-Client
// (Auth-Admin-API) und kaskadiert auf alle personenbezogenen Tabellen.
import { createClient } from "./supabase/server";
import { applyNewsletter } from "./account-core";
import { deleteAccountCore } from "./account-delete";

export type MyDataExport = {
  ok: true;
  data: Record<string, unknown>;
} | { ok: false; error: string };

export async function exportMyData(): Promise<MyDataExport> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };

  // Alles über den Session-Client -> RLS liefert ausschließlich die eigenen Daten.
  const [profileRes, spotsRes, eventsRes, convRes, buyRes, appleRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "email, display_name, locale, is_pro, pro_since, newsletter_opt_in, created_at",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("saved_items").select("created_at, spots(slug)"),
    supabase.from("saved_events").select("event_id, created_at, events(title)"),
    supabase
      .from("ai_conversations")
      .select("id, title, created_at, ai_messages(role, content, created_at)")
      .order("created_at", { ascending: true }),
    // Der eigene Pro-Kauf. Gehört in den Export (Art. 15), und zwar über denselben
    // Session-Client: Die RLS-Policy „pro_purchases_read_own" (Migration 0053) gibt genau
    // eine Zeile frei, die eigene. Der Service-Client hätte hier alle gesehen.
    supabase
      .from("pro_purchases")
      .select("paid_at, email, amount_minor, currency, stripe_session_id")
      .order("paid_at", { ascending: true }),
    // Käufe aus der iOS-App (Migration 0075): ebenfalls nur die eigenen Zeilen über die
    // RLS-Policy „apple_purchases_read_own". Fehlt die Tabelle noch, bleibt data null und der
    // Export zeigt eine leere Liste, statt zu scheitern.
    supabase
      .from("apple_purchases")
      .select("original_transaction_id, product_id, environment, purchased_at, revoked_at")
      .order("purchased_at", { ascending: true }),
  ]);

  const spotRow = (r: { created_at: string; spots: unknown }) => {
    const s = Array.isArray(r.spots) ? r.spots[0] : r.spots;
    return { slug: (s as { slug?: string } | null)?.slug ?? null, savedAt: r.created_at };
  };
  const eventRow = (r: { event_id: string; created_at: string; events: unknown }) => {
    const e = Array.isArray(r.events) ? r.events[0] : r.events;
    return {
      eventId: r.event_id,
      title: (e as { title?: string } | null)?.title ?? null,
      savedAt: r.created_at,
    };
  };

  const data = {
    exportInfo: {
      account: user.email,
      note: "Alle zu deinem SalzGuide-Konto gespeicherten personenbezogenen Daten.",
    },
    profile: profileRes.data ?? null,
    savedSpots: (spotsRes.data ?? []).map(spotRow),
    savedEvents: (eventsRes.data ?? []).map(eventRow),
    aiConversations: convRes.data ?? [],
    purchases: buyRes.data ?? [],
    applePurchases: appleRes.data ?? [],
  };

  return { ok: true, data };
}

// Newsletter-Einwilligung setzen/widerrufen (DSGVO: jederzeit einfach widerrufbar).
// Session-Client + RLS -> nur die eigene Zeile; `newsletter_opt_in` ist nicht vom
// Privilegien-Trigger (0016) geschützt, ein normaler User darf es also selbst ändern.
export async function setNewsletter(
  optIn: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };

  // Der Zeitstempel und der Widerruf stehen im Kern (account-core.ts), den auch die App nutzt.
  const { error } = await applyNewsletter(supabase, user.id, optIn);
  if (error) return { ok: false, error };
  return { ok: true };
}

export async function deleteMyAccount(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  // ai_usage + auth.users (Kaskade) räumt der Kern, den auch die App-API nutzt.
  const { error } = await deleteAccountCore(user.id);
  if (error) return { ok: false, error };

  // Session-Cookie serverseitig entwerten (Konto existiert nicht mehr).
  try {
    await supabase.auth.signOut();
  } catch {
    /* egal – der User ist bereits gelöscht */
  }
  return { ok: true };
}
