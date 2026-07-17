"use server";

import { requireAdmin } from "./admin-guard";

// Pro von Hand geben und nehmen, für Leute, die nicht über Stripe gekauft haben:
// Gewinnspiele, Beschwerden, Testkonten, Partner.
//
// Die Datenbank kennt das seit dem ersten Commit: `pro_source` ist
// ('stripe', 'migration', 'comp') — comp heißt complimentary. Und der Stripe-Webhook
// widerruft bei einer Rückerstattung ausdrücklich nur `pro_source = 'stripe'`, geschenktes
// Pro überlebt das also schon heute. Gefehlt hat nur die Verwaltung dafür.
//
// WARUM HIER SO WENIG STEHT:
// Die eigentliche Arbeit macht `set_user_pro` in der Datenbank (Migration 0038). Zwei
// Gründe, beide zählen mehr als kurzer Code hier:
//
//   - Profil ändern und Protokoll schreiben sind EINE Transaktion. Von hier aus wären es
//     zwei Aufrufe, und scheitert der zweite, hat jemand Pro ohne Protokollzeile — genau
//     das „warum hat der eigentlich Pro?", gegen das das Protokoll gebaut wurde.
//   - Die Regel „bezahltes Pro nicht anfassen" gilt dort auch für den, der später eine
//     zweite Schreibstelle baut und diese Datei nie gesehen hat.
//
// Das Gate hier ist trotzdem kein Zierrat: Es hält den Aufruf schon ab, bevor er die DB
// erreicht, und liefert dieselben Fehlernamen wie der Rest des Admins.

export type ProResult = { ok: boolean; error?: string };

/** Notiz härten wie in rechtliches/widerruf/actions: Länge kappen, Steuerzeichen raus. */
const NOTE_MAX = 200;
function cleanNote(v: string): string {
  return String(v ?? "")
    .slice(0, NOTE_MAX)
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pro schenken (`pro = true`) oder das Geschenk zurücknehmen.
 *
 * Ruft über den Session-Client auf: RLS und der Spaltenschutz-Trigger (0016) greifen
 * dadurch weiterhin. Der Service-Client wäre hier falsch — er umginge genau die Prüfungen,
 * die uns absichern.
 *
 * Fehler `stripe_pro` heißt: Der Mensch hat aktives, bezahltes Pro. Das entzieht man in
 * Stripe per Rückerstattung, nicht hier.
 */
export async function setUserPro(
  userId: string,
  pro: boolean,
  note: string,
): Promise<ProResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!UUID_RE.test(userId)) return { ok: false, error: "bad_id" };

  const { data, error } = await gate.supabase.rpc("set_user_pro", {
    target_user: userId,
    grant_pro: pro,
    grant_note: cleanNote(note),
  });

  if (error) {
    console.error("setUserPro:", error.message);
    return { ok: false, error: "db" };
  }
  // Die Funktion gibt ihren Grund als Text zurück: ok | forbidden | not_found | stripe_pro.
  return data === "ok" ? { ok: true } : { ok: false, error: String(data) };
}
