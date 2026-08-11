"use server";

import { headers } from "next/headers";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendEmail } from "@/lib/email";
import { LEGAL } from "@/lib/legal";
import { renderWithdrawal } from "@/lib/withdrawal-mail";
import { safeLocale } from "@/i18n/locales";

export type WithdrawalState = { ok: boolean; error?: string } | null;

const EMAIL_RE = /^[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}$/;
const CONTROL_RE = /[\x00-\x1f\x7f]/;

// Ein Formularfeld robust einlesen: kappen, trimmen, Steuerzeichen raus.
function field(v: FormDataEntryValue | null, max = 500): string {
  const s = String(v ?? "");
  if (s.length > max * 2) return "";
  return s.replace(CONTROL_RE, "").trim().slice(0, max);
}

// Online-Widerruf (EU-RL 2023/2673 / FAGG): nimmt die Widerrufserklärung entgegen und
// bestätigt den Eingang UNVERZÜGLICH auf dauerhaftem Datenträger (E-Mail) inkl. Datum/Uhrzeit.
// Zusätzlich Benachrichtigung an den Unternehmer zur Bearbeitung. Bot-Schutz via Turnstile.
export async function submitWithdrawal(
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  const name = field(formData.get("name"), 120);
  const email = field(formData.get("email"), 254).toLowerCase();
  const address = field(formData.get("address"), 300);
  const contract = field(formData.get("contract"), 200);
  const orderDate = field(formData.get("orderDate"), 60);
  const note = field(formData.get("note"), 1000);
  // Die Sprache kommt aus dem Formular und damit von aussen. safeLocale() nagelt sie fest:
  // Sie wählt die Sprachdatei der Bestätigungsmail aus, ein Fremdwert läge sonst als
  // Dateiname im dynamischen Import.
  const locale = safeLocale(field(formData.get("locale"), 8));

  // Pflichtfelder für eine gültige, zuordenbare Erklärung + Bestätigungsweg.
  if (name.length < 2) return { ok: false, error: "name" };
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email))
    return { ok: false, error: "email" };
  if (contract.length < 2) return { ok: false, error: "contract" };

  // Bot-Schutz: Token prüfen, bevor E-Mails ausgelöst werden.
  const reqHeaders = await headers();
  const remoteip =
    reqHeaders.get("x-real-ip") ??
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!(await verifyTurnstile(captchaToken, remoteip, "widerruf"))) return { ok: false, error: "captcha" };

  // Eingangszeitpunkt (Pflichtinhalt der Bestätigung). Als ISO durchgereicht, geschrieben
  // wird er erst in der Mail, in der Schreibweise des Empfängers.
  const receivedAt = new Date().toISOString();
  const receivedAtDe = new Intl.DateTimeFormat("de-AT", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(new Date(receivedAt));

  const details =
    `Name: ${name}\n` +
    `E-Mail: ${email}\n` +
    (address ? `Anschrift: ${address}\n` : "") +
    `Vertrag/Bestellung: ${contract}\n` +
    (orderDate ? `Bestellt/erhalten am: ${orderDate}\n` : "") +
    (note ? `Nachricht: ${note}\n` : "");

  // 1) Eingangsbestätigung an die/den Verbraucher:in (dauerhafter Datenträger, Pflicht).
  //    In der Sprache der Seite, auf der das Formular stand, und in unserem Mail-Rahmen
  //    (siehe lib/withdrawal-mail.ts).
  const mail = await renderWithdrawal({
    name,
    email,
    address,
    contract,
    orderDate,
    note,
    receivedAt,
    locale,
  });
  const confirmation = await sendEmail({
    to: email,
    subject: mail.subject,
    replyTo: LEGAL.email,
    text: mail.text,
    html: mail.html,
  });

  // 2) Benachrichtigung an den Unternehmer zur Bearbeitung (Antwort geht an den Kunden).
  //    Bleibt nackter Text und bleibt deutsch: Sie geht an uns, nicht an einen Kunden. Eine
  //    Meldung an den eigenen Schreibtisch braucht kein Design und keine dreizehn Sprachen, sie
  //    muss vollständig und schnell lesbar sein.
  await sendEmail({
    to: LEGAL.email,
    subject: `Neuer Widerruf eingegangen – ${name}`,
    replyTo: email,
    text: `Eingang: ${receivedAtDe}\nSprache: ${locale}\n\n${details}`,
  });

  // Die Widerrufserklärung ist mit der Absendung wirksam – auch wenn unsere
  // Bestätigungsmail (noch) nicht zugestellt werden konnte, gilt der Widerruf als eingegangen.
  if (!confirmation) {
    console.error("[widerruf] Bestätigungsmail nicht gesendet (RESEND_KEY/Domain prüfen)", {
      email,
    });
  }
  return { ok: true };
}
