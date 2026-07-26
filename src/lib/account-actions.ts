"use server";

// DSGVO-Betroffenenrechte (docs/34 §C7): Selbst-Service Datenexport (Art. 15/20)
// und Konto-Löschung (Art. 17). Lesen läuft über den Session-Client (RLS -> nur
// eigene Daten); die Löschung der auth.users-Zeile braucht den Service-Client
// (Auth-Admin-API) und kaskadiert auf alle personenbezogenen Tabellen.
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";

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
  const [profileRes, spotsRes, eventsRes, convRes, buyRes] = await Promise.all([
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

  // Der Zeitstempel MUSS mitgeführt werden. Art. 7 Abs. 1 DSGVO verlangt, dass wir eine
  // Einwilligung nachweisen können, und „ja" ohne „seit wann" ist kein Nachweis. Vorher
  // schrieb dieser Schalter nur das Ja/Nein: Wer sich hier eintrug, stand danach mit
  // newsletter_opt_in = true und newsletter_opt_in_at = null in der Tabelle — genau die
  // Zeile, die im Streitfall nichts belegt.
  //
  // Beim Widerruf zurück auf null: Der Zeitpunkt gehört zu einer BESTEHENDEN Einwilligung.
  // Bleibt er stehen, sieht ein Widerruf später aus wie eine gültige Zustimmung von damals.
  const { error } = await supabase
    .from("profiles")
    .update({
      newsletter_opt_in: optIn,
      newsletter_opt_in_at: optIn ? new Date().toISOString() : null,
    })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteMyAccount(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth" };
  const userId = user.id;

  const service = createServiceClient();

  // ai_usage hängt per Text-Subject (kein FK) am User -> explizit entfernen.
  await service.from("ai_usage").delete().eq("subject", `u:${userId}`);

  // auth.users löschen -> on delete cascade räumt profiles, saved_lists/-items,
  // saved_events, ai_conversations/-messages restlos ab.
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };

  // Session-Cookie serverseitig entwerten (Konto existiert nicht mehr).
  try {
    await supabase.auth.signOut();
  } catch {
    /* egal – der User ist bereits gelöscht */
  }
  return { ok: true };
}
