"use server";

import { headers } from "next/headers";
import { createClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";
import { requireAdmin } from "./admin-guard";
import { verifyTurnstile } from "./turnstile";
import { sendEmail } from "./email";
import { LEGAL } from "./legal";
import { routing } from "@/i18n/routing";

// Service-Anfragen entgegennehmen. Aufgebaut wie rechtliches/widerruf/actions.ts, das
// dieselbe Aufgabe schon löst: Eingaben härten, Turnstile VOR jeder Mail, dann zustellen.
//
// WARUM TABELLE **UND** MAIL:
// Die Tabelle beantwortet „was ist offen?" — das kann eine Mail nicht. Die Mail wiederum
// erreicht Anton auch dann, wenn er tagelang nicht ins Admin schaut. Die Tabelle ist die
// Wahrheit, die Mail ist der Wecker. Scheitert die Mail, ist die Anfrage trotzdem
// gespeichert und nicht verloren.

export type SupportState = { ok: boolean; error?: string } | null;

const EMAIL_RE = /^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}$/;
const CONTROL_RE = /[\x00-\x1f\x7f]/;

// Wie in widerruf/actions: kappen, Steuerzeichen raus, trimmen. Steuerzeichen sind hier
// kein Schönheitsfehler: Die Nachricht landet in einer Mail, und CR/LF im Betreff wären
// eine Header-Injection.
function field(v: FormDataEntryValue | null, max = 500): string {
  const s = String(v ?? "");
  if (s.length > max * 2) return "";
  return s.replace(CONTROL_RE, "").trim().slice(0, max);
}

// Die Nachricht darf Zeilenumbrüche behalten — sie ist Fliesstext, kein Header.
function messageField(v: FormDataEntryValue | null, max = 4000): string {
  const s = String(v ?? "");
  if (s.length > max * 2) return "";
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, max);
}

export async function submitSupportRequest(
  _prev: SupportState,
  formData: FormData,
): Promise<SupportState> {
  const name = field(formData.get("name"), 120);
  const email = field(formData.get("email"), 254).toLowerCase();
  const message = messageField(formData.get("message"));
  const rawLocale = field(formData.get("locale"), 8);
  const locale = (routing.locales as readonly string[]).includes(rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email))
    return { ok: false, error: "email" };
  if (message.length < 10) return { ok: false, error: "message" };

  // Bot-Schutz, BEVOR irgendetwas geschrieben oder verschickt wird. Ohne das wären Tabelle
  // und Resend-Kontingent ein offener Briefkasten.
  const reqHeaders = await headers();
  const remoteip =
    reqHeaders.get("x-real-ip") ??
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(captchaToken, remoteip))) return { ok: false, error: "captcha" };

  // Angemeldet? Dann die ID mitschreiben, damit im Admin sofort klar ist, wer schreibt.
  // Der Absender bestimmt das NICHT selbst — sonst hängte sich jeder an ein fremdes Konto.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Service-Client, weil die Tabelle bewusst keine Insert-Policy hat (Migration 0039):
  // Geschrieben wird nur hier, und nur nachdem Turnstile bestanden ist.
  const { error } = await createServiceClient().from("support_requests").insert({
    user_id: user?.id ?? null,
    email,
    name: name || null,
    message,
    locale,
  });
  if (error) {
    console.error("submitSupportRequest:", error.message);
    return { ok: false, error: "db" };
  }

  // Erst speichern, dann melden. Scheitert die Mail, ist die Anfrage trotzdem da – nur der
  // Wecker fehlt. Andersherum hätten wir gemeldet, was nirgends steht.
  const sent = await sendEmail({
    to: LEGAL.email,
    subject: `Support-Anfrage von ${name || email}`,
    replyTo: email,
    text:
      `Von: ${name || "(kein Name)"} <${email}>\n` +
      `Sprache: ${locale}\n` +
      `Konto: ${user ? user.id : "nicht angemeldet"}\n\n` +
      `${message}\n\n` +
      `— Steht auch im Admin unter /admin/support.`,
  });
  if (!sent) {
    console.error("[support] Benachrichtigung nicht gesendet (RESEND_KEY prüfen). Anfrage ist gespeichert.");
  }

  return { ok: true };
}

// ── Admin ────────────────────────────────────────────────────────────────────
export type SupportResult = { ok: boolean; error?: string };

/** Anfrage auf erledigt/offen setzen. */
export async function setSupportStatus(id: string, done: boolean): Promise<SupportResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await gate.supabase
    .from("support_requests")
    .update({
      status: done ? "done" : "open",
      handled_by: done ? gate.userId : null,
      handled_at: done ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}

/**
 * Anfrage löschen. Für Art.-17-Verlangen von Leuten OHNE Konto — wer ein Konto hat,
 * dessen Anfragen gehen beim Löschen des Kontos ohnehin mit (on delete cascade).
 */
export async function deleteSupportRequest(id: string): Promise<SupportResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await gate.supabase.from("support_requests").delete().eq("id", id);
  if (error) return { ok: false, error: "db" };
  return { ok: true };
}
