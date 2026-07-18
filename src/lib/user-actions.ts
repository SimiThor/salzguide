"use server";

import { requireAdmin } from "./admin-guard";
import { createServiceClient } from "./supabase/service";
import { emailEnabled, sendEmail } from "./email";
import { LEGAL } from "./legal";
import { PRO_GIFT_SUBJECT, renderProGiftMail, renderProGiftText } from "./pro-gift-mail";

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

/**
 * Was mit der Mail an den Beschenkten passiert ist. Bewusst zurückgemeldet statt still
 * geschluckt: Der Admin drückt einen Knopf und soll wissen, ob der Mensch jetzt Post hat.
 * Ein „geschenkt!", das die Mail verschweigt, führt genau zu der Frage, die niemand
 * beantworten kann: „hat der das eigentlich mitbekommen?"
 */
export type ProMailState =
  /** Raus und vermerkt. */
  | "sent"
  /** Resend hat nicht angenommen. Pro gilt trotzdem, die Mail kann man erneut anstossen. */
  | "failed"
  /** Wurde schon einmal geschrieben (Pro entzogen und neu geschenkt). */
  | "already"
  /** Konto ohne E-Mail-Adresse. */
  | "no_address"
  /** Kein RESEND_KEY gesetzt, z.B. lokal. */
  | "disabled";

export type ProResult = { ok: boolean; error?: string; mail?: ProMailState };

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
  sendMail = false,
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
  if (data !== "ok") return { ok: false, error: String(data) };

  // Nur beim Schenken, nie beim Entziehen. Und nur, wenn der Haken gesetzt war: Testkonten
  // bekommen sonst Post, und die erste Mail, die man bereut, ist die an sich selbst.
  if (!pro || !sendMail) return { ok: true };
  return { ok: true, mail: await mailProGift(userId) };
}

/**
 * Schreibt dem Beschenkten. Wirft nie: Das Pro ist zu diesem Zeitpunkt schon vergeben, und
 * eine gescheiterte Mail darf daraus keinen gescheiterten Vorgang machen.
 *
 * Reihenfolge wie beim Umzugs-Versand: erst senden, dann vermerken. Andersherum wäre eine
 * Mail, die Resend nicht annimmt, für immer als verschickt markiert.
 *
 * `set_user_pro` taugt als Auslöser nicht allein: Sie liefert auch dann 'ok', wenn der
 * Mensch längst Pro hatte und gar nichts passiert ist (Migration 0038). Die verlässliche
 * Bremse ist deshalb `pro_gift_mailed_at` — die Bedingung steckt im UPDATE selbst, damit
 * zwei gleichzeitige Klicks nicht zwei Mails ergeben.
 */
async function mailProGift(userId: string): Promise<ProMailState> {
  try {
    if (!emailEnabled()) return "disabled";

    // Service-Client: Die Adresse kommt aus der Datenbank, nicht aus dem Browser. Was der
    // Client schickt, ist eine Behauptung — und eine Mail an eine behauptete Adresse zu
    // schicken, wäre ein offener Versandweg für jeden, der die Aktion aufrufen darf.
    const svc = createServiceClient();
    const { data } = await svc
      .from("profiles")
      .select("email, pro_gift_mailed_at")
      .eq("id", userId)
      .maybeSingle();

    if (!data?.email) return "no_address";
    if (data.pro_gift_mailed_at) return "already";

    const ok = await sendEmail({
      to: data.email,
      subject: PRO_GIFT_SUBJECT,
      replyTo: LEGAL.email,
      text: renderProGiftText(),
      html: renderProGiftMail(),
    });
    if (!ok) return "failed";

    const { error } = await svc
      .from("profiles")
      .update({ pro_gift_mailed_at: new Date().toISOString() })
      .eq("id", userId)
      .is("pro_gift_mailed_at", null);
    if (error) {
      // Mail ist raus, Vermerk fehlt. Laut loggen statt still schlucken, sonst schriebe
      // die nächste Schenkung ein zweites Mal.
      console.error("mailProGift: nicht vermerkt", userId, error.message);
    }
    return "sent";
  } catch (e) {
    console.error("mailProGift:", e);
    return "failed";
  }
}
